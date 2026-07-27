
const express = require("express");
const multer = require("multer");
const path = require("path");
const pool = require("../db");
const auth = require("../middlewares/auth");
const { makeCode } = require("../utils/ids");
const { sendWhatsAppText, sendWhatsAppDocument } = require("../services/whatsappService");
const {
  generateTestInterpretation,
  normalizeMasterTest
} = require("../../../shared/interpretation-engine.js");

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || "uploads";
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, Date.now() + "_" + safe);
  }
});
const upload = multer({ storage });

router.get("/dashboard", auth("admin"), async (req, res) => {
  const [[bookingStats]] = await pool.query("SELECT COUNT(*) total_bookings, COALESCE(SUM(gross_total),0) total_revenue FROM bookings");
  const [[patientStats]] = await pool.query("SELECT COUNT(*) total_patients FROM patients");
  const [[reportStats]] = await pool.query("SELECT COUNT(*) total_reports FROM reports WHERE status='Released'");
  res.json({ ...bookingStats, ...patientStats, ...reportStats });
});

router.get("/bookings", auth("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM bookings ORDER BY created_at DESC");
  res.json(rows);
});

router.get("/bookings/:id", auth("admin"), async (req, res) => {
  const [[booking]] = await pool.query("SELECT * FROM bookings WHERE id=?", [req.params.id]);
  if (!booking) return res.status(404).json({ message: "Booking not found" });
  const [tests] = await pool.query("SELECT * FROM booking_tests WHERE booking_id=?", [req.params.id]);
  for (const t of tests) {
    const [values] = await pool.query("SELECT * FROM report_values WHERE booking_test_id=? ORDER BY sort_order", [t.id]);
    t.values = values;
  }
  booking.tests = tests;
  res.json(booking);
});

router.put("/bookings/:id/status", auth("admin"), async (req, res) => {
  const { status, fieldBoyName, reportingDate } = req.body;
  await pool.query("UPDATE bookings SET status=COALESCE(?,status), field_boy_name=COALESCE(?,field_boy_name), reporting_date=COALESCE(?,reporting_date) WHERE id=?",
    [status || null, fieldBoyName || null, reportingDate || null, req.params.id]);
  res.json({ message: "Booking updated" });
});

router.post("/bookings/:id/report-values", auth("admin"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { tests } = req.body;
    if (!Array.isArray(tests)) return res.status(400).json({ message: "tests array required" });

    await conn.beginTransaction();

    for (const test of tests) {
      let bookingTestId = test.booking_test_id;

      if (!bookingTestId && test.test_code) {
        const [rows] = await conn.query("SELECT id FROM booking_tests WHERE booking_id=? AND test_code=? LIMIT 1", [req.params.id, test.test_code]);
        if (rows.length) bookingTestId = rows[0].id;
      }

      if (!bookingTestId) continue;

      await conn.query("DELETE FROM report_values WHERE booking_test_id=?", [bookingTestId]);

      for (let i = 0; i < (test.values || []).length; i++) {
        const v = test.values[i];
        await conn.query(
          "INSERT INTO report_values (booking_test_id,parameter_name,normal_value,finding,unit,comment,sort_order) VALUES (?,?,?,?,?,?,?)",
          [bookingTestId, v.parameter_name, v.normal_value || "", v.finding || "", v.unit || "", v.comment || "", i + 1]
        );
      }

      await conn.query("UPDATE booking_tests SET status='Provisional' WHERE id=?", [bookingTestId]);
    }

    await conn.query("UPDATE bookings SET status='Provisional', reporting_date=COALESCE(reporting_date,NOW()) WHERE id=?", [req.params.id]);

    await conn.commit();
    res.json({ message: "Report values saved" });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

router.post("/bookings/:id/report-upload", auth("admin"), upload.single("report"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Report file required" });

    const publicBase = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 5000}`;
    const fileUrl = `${publicBase}/uploads/${req.file.filename}`;
    const reportNo = makeCode("RPT");

    await pool.query(
      "INSERT INTO reports (booking_id,report_no,file_name,file_url,status,released_at) VALUES (?,?,?,?, 'Released', NOW())",
      [req.params.id, reportNo, req.file.originalname, fileUrl]
    );

    await pool.query("UPDATE bookings SET status='Released', reporting_date=NOW() WHERE id=?", [req.params.id]);
    await pool.query("UPDATE booking_tests SET status='Released' WHERE booking_id=?", [req.params.id]);

    res.json({ message: "Report uploaded and released", reportNo, fileUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/bookings/:id/release-report", auth("admin"), async (req, res) => {
  try {
    const reportNo = makeCode("RPT");
    await pool.query(
      "INSERT INTO reports (booking_id,report_no,file_name,file_url,status,released_at) VALUES (?,?,?,?,'Released',NOW())",
      [req.params.id, reportNo, `report-${reportNo}.pdf`, req.body.fileUrl || ""]
    );

    await pool.query("UPDATE bookings SET status='Released', reporting_date=NOW() WHERE id=?", [req.params.id]);
    await pool.query("UPDATE booking_tests SET status='Released' WHERE booking_id=?", [req.params.id]);

    res.json({ message: "Report released", reportNo });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/bookings/:id/send-whatsapp-report", auth("admin"), async (req, res) => {
  try {
    const [[booking]] = await pool.query("SELECT * FROM bookings WHERE id=?", [req.params.id]);
    if (!booking) return res.status(404).json({ message: "Booking not found" });

    const [[report]] = await pool.query("SELECT * FROM reports WHERE booking_id=? ORDER BY id DESC LIMIT 1", [req.params.id]);

    const to = req.body.whatsapp || booking.whatsapp || booking.phone;
    if (!to) return res.status(400).json({ message: "Customer WhatsApp number not found" });

    let providerResponse;

    if (report && report.file_url) {
      const caption =
`Dear ${booking.patient_name},

Your KHUNTEST LABS report is ready.

Bill No: ${booking.bill_no}
Booking ID: ${booking.booking_code}

Thank you,
KHUNTEST LABS`;

      providerResponse = await sendWhatsAppDocument(to, report.file_url, report.file_name || "KHUNTEST_LABS_Report.pdf", caption);
    } else {
      const msg =
`Dear ${booking.patient_name},

Your KHUNTEST LABS report is ready.

Bill No: ${booking.bill_no}
Booking ID: ${booking.booking_code}

Please contact KHUNTEST LABS to collect/download your report.

Thank you,
KHUNTEST LABS`;
      providerResponse = await sendWhatsAppText(to, msg);
    }

    await pool.query(
      "INSERT INTO notifications (booking_id,patient_phone,channel,message,status,provider_response) VALUES (?,?,?,?,?,?)",
      [req.params.id, to, "WhatsApp", "Report sent to WhatsApp", "Sent", JSON.stringify(providerResponse)]
    );

    res.json({ message: "WhatsApp report notification sent", providerResponse });
  } catch (err) {
    await pool.query(
      "INSERT INTO notifications (booking_id,patient_phone,channel,message,status,provider_response) VALUES (?,?,?,?,?,?)",
      [req.params.id, req.body.whatsapp || "", "WhatsApp", "Report sending failed", "Failed", err.message]
    ).catch(() => {});
    res.status(500).json({ message: err.message });
  }
});

router.get("/tests", auth("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM tests ORDER BY category,test_name");
  res.json(rows);
});

router.post("/tests", auth("admin"), async (req, res) => {
  const { test_code, test_name, category, sample, report_time, price_inr, parameters } = req.body;
  await pool.query("INSERT INTO tests (test_code,test_name,category,sample,report_time,price_inr) VALUES (?,?,?,?,?,?)",
    [test_code, test_name, category || "", sample || "", report_time || "", price_inr || 0]);

  if (Array.isArray(parameters)) {
    for (let i = 0; i < parameters.length; i++) {
      const p = parameters[i];
      await pool.query("INSERT INTO test_parameters (test_code,parameter_name,normal_value,unit,sort_order) VALUES (?,?,?,?,?)",
        [test_code, p.parameter_name, p.normal_value || "", p.unit || "", i + 1]);
    }
  }

  res.json({ message: "Test added" });
});

function masterRow(row = {}) {
  return {
    id: row.id,
    code: row.test_code,
    testCode: row.test_code,
    displayName: row.display_name,
    shortName: row.short_name,
    department: row.department,
    category: row.category,
    sampleType: row.sample_type,
    method: row.method,
    analyzer: row.analyzer,
    resultType: row.result_type,
    decimalPlaces: row.decimal_places,
    defaultUnit: row.default_unit,
    allowedUnits: row.allowed_units ? JSON.parse(row.allowed_units) : [],
    generalInterpretation: row.general_interpretation || "",
    clinicalNotes: row.clinical_notes || "",
    recommendation: row.recommendation || "",
    reportComment: row.report_comment || "",
    criticalValueEnabled: Boolean(row.critical_value_enabled),
    autoFlagEnabled: row.auto_flag_enabled !== 0,
    autoInterpretationEnabled: row.auto_interpretation_enabled !== 0,
    showMethodOnReport: row.show_method_on_report !== 0,
    showSampleOnReport: row.show_sample_on_report !== 0,
    showInterpretationOnReport: row.show_interpretation_on_report !== 0,
    showClinicalNotesOnReport: row.show_clinical_notes_on_report !== 0,
    displayOrder: row.display_order,
    status: row.status,
    version: row.version
  };
}

function rangeRow(row = {}) {
  return {
    id: row.id,
    label: row.label,
    gender: row.gender,
    minimumAgeDays: row.minimum_age_days,
    maximumAgeDays: row.maximum_age_days,
    pregnancyStatus: row.pregnancy_status,
    trimester: row.trimester,
    method: row.method,
    unit: row.unit,
    lowerLimit: row.lower_limit === null ? null : Number(row.lower_limit),
    upperLimit: row.upper_limit === null ? null : Number(row.upper_limit),
    lowerInclusive: row.lower_inclusive !== 0,
    upperInclusive: row.upper_inclusive !== 0,
    textRange: row.text_range || "",
    priority: row.priority,
    enabled: row.enabled !== 0,
    version: row.version
  };
}

function ruleRow(row = {}) {
  return {
    id: row.id,
    name: row.name,
    resultType: row.result_type,
    operator: row.operator,
    minimumValue: row.minimum_value === null ? null : Number(row.minimum_value),
    maximumValue: row.maximum_value === null ? null : Number(row.maximum_value),
    qualitativeValue: row.qualitative_value || "",
    gender: row.gender,
    minimumAgeDays: row.minimum_age_days,
    maximumAgeDays: row.maximum_age_days,
    pregnancyStatus: row.pregnancy_status,
    method: row.method,
    unit: row.unit,
    flag: row.flag,
    severity: row.severity,
    interpretation: row.interpretation || "",
    clinicalNote: row.clinical_note || "",
    recommendation: row.recommendation || "",
    priority: row.priority,
    enabled: row.enabled !== 0,
    version: row.version
  };
}

async function auditMaster(conn, testId, testCode, fieldChanged, oldValue, newValue, user, reason = "") {
  await conn.query(
    "INSERT INTO test_master_audit (test_master_id,test_code,field_changed,old_value,new_value,changed_by,version,reason) VALUES (?,?,?,?,?,?,COALESCE((SELECT version FROM test_master_configs WHERE id=?),1),?)",
    [testId || null, testCode || "", fieldChanged, JSON.stringify(oldValue || null), JSON.stringify(newValue || null), user?.email || user?.id || "", testId || null, reason]
  );
}

router.get("/test-master", auth("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM test_master_configs ORDER BY display_order, display_name");
  res.json(rows.map(masterRow));
});

router.get("/test-master/:id", auth("admin"), async (req, res) => {
  const [[test]] = await pool.query("SELECT * FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
  if (!test) return res.status(404).json({ message: "Test master not found" });
  const [ranges] = await pool.query("SELECT * FROM test_reference_ranges WHERE test_master_id=? ORDER BY priority DESC,id", [test.id]);
  const [rules] = await pool.query("SELECT * FROM test_interpretation_rules WHERE test_master_id=? ORDER BY priority DESC,id", [test.id]);
  res.json({ ...masterRow(test), referenceRanges: ranges.map(rangeRow), interpretationRules: rules.map(ruleRow) });
});

router.post("/test-master", auth("admin"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const test = normalizeMasterTest(req.body);
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO test_master_configs
      (test_code,display_name,short_name,department,category,sample_type,method,analyzer,result_type,decimal_places,default_unit,allowed_units,general_interpretation,clinical_notes,recommendation,report_comment,critical_value_enabled,auto_flag_enabled,auto_interpretation_enabled,show_method_on_report,show_sample_on_report,show_interpretation_on_report,show_clinical_notes_on_report,display_order,status,version,created_by,updated_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [test.code, test.displayName, test.shortName, test.department, test.category, test.sampleType, test.method, test.analyzer, test.resultType, test.decimalPlaces || null, test.defaultUnit, JSON.stringify(test.allowedUnits || []), test.generalInterpretation, test.clinicalNotes, test.recommendation, test.reportComment, test.criticalValueEnabled ? 1 : 0, test.autoFlagEnabled ? 1 : 0, test.autoInterpretationEnabled ? 1 : 0, test.showMethodOnReport ? 1 : 0, test.showSampleOnReport ? 1 : 0, test.showInterpretationOnReport ? 1 : 0, test.showClinicalNotesOnReport ? 1 : 0, test.displayOrder, test.status, test.version, req.user?.email || req.user?.id || "", req.user?.email || req.user?.id || ""]
    );
    await auditMaster(conn, result.insertId, test.code, "create", null, test, req.user, req.body.reason || "");
    await conn.commit();
    res.status(201).json({ id: result.insertId, ...test });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

router.put("/test-master/:id", auth("admin"), async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const [[existing]] = await conn.query("SELECT * FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
    if (!existing) return res.status(404).json({ message: "Test master not found" });
    const patch = normalizeMasterTest({ ...masterRow(existing), ...req.body, code: req.body.code || req.body.testCode || existing.test_code });
    await conn.beginTransaction();
    await conn.query(
      `UPDATE test_master_configs SET display_name=?,short_name=?,department=?,category=?,sample_type=?,method=?,analyzer=?,result_type=?,decimal_places=?,default_unit=?,allowed_units=?,general_interpretation=?,clinical_notes=?,recommendation=?,report_comment=?,critical_value_enabled=?,auto_flag_enabled=?,auto_interpretation_enabled=?,show_method_on_report=?,show_sample_on_report=?,show_interpretation_on_report=?,show_clinical_notes_on_report=?,display_order=?,status=?,version=version+1,updated_by=? WHERE id=?`,
      [patch.displayName, patch.shortName, patch.department, patch.category, patch.sampleType, patch.method, patch.analyzer, patch.resultType, patch.decimalPlaces || null, patch.defaultUnit, JSON.stringify(patch.allowedUnits || []), patch.generalInterpretation, patch.clinicalNotes, patch.recommendation, patch.reportComment, patch.criticalValueEnabled ? 1 : 0, patch.autoFlagEnabled ? 1 : 0, patch.autoInterpretationEnabled ? 1 : 0, patch.showMethodOnReport ? 1 : 0, patch.showSampleOnReport ? 1 : 0, patch.showInterpretationOnReport ? 1 : 0, patch.showClinicalNotesOnReport ? 1 : 0, patch.displayOrder, patch.status, req.user?.email || req.user?.id || "", existing.id]
    );
    await auditMaster(conn, existing.id, existing.test_code, "update", masterRow(existing), patch, req.user, req.body.reason || "");
    await conn.commit();
    res.json({ id: existing.id, ...patch, version: Number(existing.version || 1) + 1 });
  } catch (err) {
    await conn.rollback();
    res.status(500).json({ message: err.message });
  } finally {
    conn.release();
  }
});

router.delete("/test-master/:id", auth("admin"), async (req, res) => {
  await pool.query("UPDATE test_master_configs SET status='archived' WHERE id=? OR test_code=?", [req.params.id, req.params.id]);
  res.json({ message: "Test master archived" });
});

router.get("/test-master/:id/reference-ranges", auth("admin"), async (req, res) => {
  const [[test]] = await pool.query("SELECT id FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
  if (!test) return res.status(404).json({ message: "Test master not found" });
  const [rows] = await pool.query("SELECT * FROM test_reference_ranges WHERE test_master_id=? ORDER BY priority DESC,id", [test.id]);
  res.json(rows.map(rangeRow));
});

router.post("/test-master/:id/reference-ranges", auth("admin"), async (req, res) => {
  const [[test]] = await pool.query("SELECT * FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
  if (!test) return res.status(404).json({ message: "Test master not found" });
  const r = req.body;
  const [result] = await pool.query(
    "INSERT INTO test_reference_ranges (test_master_id,label,gender,minimum_age_days,maximum_age_days,pregnancy_status,trimester,method,unit,lower_limit,upper_limit,lower_inclusive,upper_inclusive,text_range,priority,enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [test.id, r.label || "", r.gender || "all", r.minimumAgeDays ?? null, r.maximumAgeDays ?? null, r.pregnancyStatus || "all", r.trimester || null, r.method || "", r.unit || "", r.lowerLimit ?? null, r.upperLimit ?? null, r.lowerInclusive === false ? 0 : 1, r.upperInclusive === false ? 0 : 1, r.textRange || "", r.priority || 0, r.enabled === false ? 0 : 1]
  );
  res.status(201).json({ id: result.insertId, ...r });
});

router.put("/reference-ranges/:rangeId", auth("admin"), async (req, res) => {
  const r = req.body;
  await pool.query(
    "UPDATE test_reference_ranges SET label=?,gender=?,minimum_age_days=?,maximum_age_days=?,pregnancy_status=?,trimester=?,method=?,unit=?,lower_limit=?,upper_limit=?,lower_inclusive=?,upper_inclusive=?,text_range=?,priority=?,enabled=?,version=version+1 WHERE id=?",
    [r.label || "", r.gender || "all", r.minimumAgeDays ?? null, r.maximumAgeDays ?? null, r.pregnancyStatus || "all", r.trimester || null, r.method || "", r.unit || "", r.lowerLimit ?? null, r.upperLimit ?? null, r.lowerInclusive === false ? 0 : 1, r.upperInclusive === false ? 0 : 1, r.textRange || "", r.priority || 0, r.enabled === false ? 0 : 1, req.params.rangeId]
  );
  res.json({ message: "Reference range updated" });
});

router.delete("/reference-ranges/:rangeId", auth("admin"), async (_req, res) => {
  await pool.query("UPDATE test_reference_ranges SET enabled=0 WHERE id=?", [_req.params.rangeId]);
  res.json({ message: "Reference range disabled" });
});

router.get("/test-master/:id/interpretation-rules", auth("admin"), async (req, res) => {
  const [[test]] = await pool.query("SELECT id FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
  if (!test) return res.status(404).json({ message: "Test master not found" });
  const [rows] = await pool.query("SELECT * FROM test_interpretation_rules WHERE test_master_id=? ORDER BY priority DESC,id", [test.id]);
  res.json(rows.map(ruleRow));
});

router.post("/test-master/:id/interpretation-rules", auth("admin"), async (req, res) => {
  const [[test]] = await pool.query("SELECT * FROM test_master_configs WHERE id=? OR test_code=? LIMIT 1", [req.params.id, req.params.id]);
  if (!test) return res.status(404).json({ message: "Test master not found" });
  const r = req.body;
  const [result] = await pool.query(
    "INSERT INTO test_interpretation_rules (test_master_id,name,result_type,operator,minimum_value,maximum_value,qualitative_value,gender,minimum_age_days,maximum_age_days,pregnancy_status,method,unit,flag,severity,interpretation,clinical_note,recommendation,priority,enabled) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [test.id, r.name || "", r.resultType || "numeric", r.operator || "between", r.minimumValue ?? null, r.maximumValue ?? null, r.qualitativeValue || "", r.gender || "all", r.minimumAgeDays ?? null, r.maximumAgeDays ?? null, r.pregnancyStatus || "all", r.method || "", r.unit || "", r.flag || "", r.severity || "", r.interpretation || "", r.clinicalNote || "", r.recommendation || "", r.priority || 0, r.enabled === false ? 0 : 1]
  );
  res.status(201).json({ id: result.insertId, ...r });
});

router.put("/interpretation-rules/:ruleId", auth("admin"), async (req, res) => {
  const r = req.body;
  await pool.query(
    "UPDATE test_interpretation_rules SET name=?,result_type=?,operator=?,minimum_value=?,maximum_value=?,qualitative_value=?,gender=?,minimum_age_days=?,maximum_age_days=?,pregnancy_status=?,method=?,unit=?,flag=?,severity=?,interpretation=?,clinical_note=?,recommendation=?,priority=?,enabled=?,version=version+1 WHERE id=?",
    [r.name || "", r.resultType || "numeric", r.operator || "between", r.minimumValue ?? null, r.maximumValue ?? null, r.qualitativeValue || "", r.gender || "all", r.minimumAgeDays ?? null, r.maximumAgeDays ?? null, r.pregnancyStatus || "all", r.method || "", r.unit || "", r.flag || "", r.severity || "", r.interpretation || "", r.clinicalNote || "", r.recommendation || "", r.priority || 0, r.enabled === false ? 0 : 1, req.params.ruleId]
  );
  res.json({ message: "Interpretation rule updated" });
});

router.delete("/interpretation-rules/:ruleId", auth("admin"), async (req, res) => {
  await pool.query("UPDATE test_interpretation_rules SET enabled=0 WHERE id=?", [req.params.ruleId]);
  res.json({ message: "Interpretation rule disabled" });
});

router.post("/interpretation/preview", auth("admin"), async (req, res) => {
  const result = generateTestInterpretation(req.body);
  res.json(result);
});

router.post("/reports/:reportId/regenerate-interpretations", auth("admin"), async (_req, res) => {
  res.status(202).json({
    message: "Regeneration preview endpoint accepted. Finalized historical reports are not silently changed; apply amendments through the report amendment workflow."
  });
});

router.get("/staff", auth("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM staff ORDER BY name");
  res.json(rows);
});

router.post("/staff", auth("admin"), async (req, res) => {
  const { name, phone, role } = req.body;
  await pool.query("INSERT INTO staff (name,phone,role) VALUES (?,?,?)", [name, phone || "", role || "Field Boy"]);
  res.json({ message: "Staff added" });
});

router.get("/revenue-summary", auth("admin"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE(created_at) date, COUNT(*) bookings, SUM(gross_total) gross, SUM(discount) discount, SUM(balance_due) due
     FROM bookings GROUP BY DATE(created_at) ORDER BY date DESC LIMIT 30`
  );
  res.json(rows);
});

router.get("/notifications", auth("admin"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100");
  res.json(rows);
});

module.exports = router;
