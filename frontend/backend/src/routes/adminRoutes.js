
const express = require("express");
const multer = require("multer");
const path = require("path");
const pool = require("../db");
const auth = require("../middlewares/auth");
const { makeCode } = require("../utils/ids");
const { sendWhatsAppText, sendWhatsAppDocument } = require("../services/whatsappService");

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

Your KhunTest Lab report is ready.

Bill No: ${booking.bill_no}
Booking ID: ${booking.booking_code}

Thank you,
KhunTest Lab`;

      providerResponse = await sendWhatsAppDocument(to, report.file_url, report.file_name || "KhunTest_Report.pdf", caption);
    } else {
      const msg =
`Dear ${booking.patient_name},

Your KhunTest Lab report is ready.

Bill No: ${booking.bill_no}
Booking ID: ${booking.booking_code}

Please contact KhunTest Lab to collect/download your report.

Thank you,
KhunTest Lab`;
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
