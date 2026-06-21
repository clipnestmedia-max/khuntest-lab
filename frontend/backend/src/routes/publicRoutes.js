const express = require("express");
const pool = require("../db");
const { makeCode } = require("../utils/ids");

const router = express.Router();

/* =========================
   GET ALL TESTS
   Current DB columns:
   tests: id, name, category, price, report_time, is_active
   test_parameters: test_id, parameter_name, normal_value, unit, sort_order
========================= */
router.get("/tests", async (req, res) => {
  try {
    const [tests] = await pool.query(`
      SELECT 
        id,
        name,
        category,
        price,
        report_time,
        is_active,
        id AS test_code,
        name AS test_name,
        price AS price_inr
      FROM tests
      WHERE is_active = 1
      ORDER BY category, name
    `);

    for (const t of tests) {
      try {
        const [params] = await pool.query(`
          SELECT 
            parameter_name,
            normal_value,
            unit,
            sort_order
          FROM test_parameters
          WHERE test_id = ?
          ORDER BY sort_order, id
        `, [t.id]);

        t.parameters = params;
      } catch (paramErr) {
        console.error("Parameter load error:", paramErr.message);
        t.parameters = [];
      }
    }

    res.json(tests);
  } catch (err) {
    console.error("GET /tests error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

/* =========================
   GET PACKAGES
   Safe route. If package table issue, returns empty list.
========================= */
router.get("/packages", async (req, res) => {
  try {
    const [packages] = await pool.query(`
      SELECT * FROM packages 
      WHERE is_active = 1 
      ORDER BY price_inr
    `);

    res.json(packages.map(p => ({
      ...p,
      tests: []
    })));
  } catch (err) {
    console.error("GET /packages error:", err.message);
    res.json([]);
  }
});

/* =========================
   CREATE BOOKING
   Saves patient entry to MySQL.
========================= */
router.post("/bookings", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    await conn.beginTransaction();

    const {
      patientName,
      patientAge,
      patientGender,
      phone,
      whatsapp,
      email,
      address,
      bookingType,
      rateType,
      refDoctor,
      tests,
      paymentMode
    } = req.body;

    if (!patientName || !phone || !Array.isArray(tests) || !tests.length) {
      return res.status(400).json({
        success: false,
        message: "Patient name, phone and tests are required"
      });
    }

    let patientId = null;

    const [patientRows] = await conn.query(
      "SELECT * FROM patients WHERE phone = ? LIMIT 1",
      [phone]
    );

    if (patientRows.length) {
      patientId = patientRows[0].id;
    } else {
      const [patientResult] = await conn.query(
        `INSERT INTO patients 
        (name, age, gender, phone, whatsapp, email, address)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          patientName,
          patientAge || "",
          patientGender || "",
          phone,
          whatsapp || phone,
          email || "",
          address || ""
        ]
      );

      patientId = patientResult.insertId;
    }

    let grossTotal = 0;
    const fullTests = [];

    for (const testValue of tests) {
      const [rows] = await conn.query(
        `SELECT 
          id,
          name,
          category,
          price,
          report_time,
          id AS test_code,
          name AS test_name,
          price AS price_inr
        FROM tests
        WHERE id = ? OR name = ?
        LIMIT 1`,
        [testValue, testValue]
      );

      if (rows.length) {
        grossTotal += Number(rows[0].price || 0);
        fullTests.push(rows[0]);
      }
    }

    if (!fullTests.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "Selected tests not found in database"
      });
    }

    const bookingCode = makeCode("KTB");
    const billNo = String(Date.now()).slice(-6);
    const balanceDue = paymentMode === "Pay Later" ? grossTotal : 0;

    const [bookingResult] = await conn.query(
      `INSERT INTO bookings 
      (
        booking_code,
        bill_no,
        remote_no,
        patient_id,
        patient_name,
        patient_age,
        patient_gender,
        phone,
        whatsapp,
        email,
        address,
        booking_type,
        rate_type,
        pathology_name,
        ref_doctor,
        admission_date,
        collection_date,
        reporting_date,
        status,
        gross_total,
        cash_received,
        card_received,
        online_received,
        discount,
        balance_due,
        remarks
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), 'Pending', ?, 0, 0, 0, 0, ?, '')`,
      [
        bookingCode,
        billNo,
        "0",
        patientId,
        patientName,
        patientAge || "",
        patientGender || "",
        phone,
        whatsapp || phone,
        email || "",
        address || "",
        bookingType || "Centre Visit",
        rateType || "General",
        "BN-MAIN",
        refDoctor || "",
        grossTotal,
        balanceDue
      ]
    );

    for (const t of fullTests) {
      await conn.query(
        `INSERT INTO booking_tests 
        (booking_id, test_code, test_name, price_inr, status)
        VALUES (?, ?, ?, ?, 'Pending')`,
        [
          bookingResult.insertId,
          String(t.id),
          t.name,
          Number(t.price || 0)
        ]
      );
    }

    await conn.commit();

    res.json({
      success: true,
      message: "Booking created successfully",
      bookingId: bookingResult.insertId,
      bookingCode,
      billNo,
      grossTotal,
      balanceDue
    });

  } catch (err) {
    await conn.rollback();

    console.error("POST /bookings error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    conn.release();
  }
});

/* =========================
   GET ALL BOOKINGS
   Same data on all devices.
========================= */
router.get("/bookings", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        b.*,
        bt.id AS booking_test_id,
        bt.test_code,
        bt.test_name,
        bt.price_inr,
        bt.status AS test_status
      FROM bookings b
      LEFT JOIN booking_tests bt ON bt.booking_id = b.id
      ORDER BY b.id DESC
    `);

    const map = {};

    for (const r of rows) {
      if (!map[r.id]) {
        map[r.id] = {
          id: r.id,
          booking_code: r.booking_code,
          bill_no: r.bill_no,
          remote_no: r.remote_no,
          patient_id: r.patient_id,
          patient_name: r.patient_name,
          patient_age: r.patient_age,
          patient_gender: r.patient_gender,
          phone: r.phone,
          whatsapp: r.whatsapp,
          email: r.email,
          address: r.address,
          booking_type: r.booking_type,
          rate_type: r.rate_type,
          pathology_name: r.pathology_name,
          ref_doctor: r.ref_doctor,
          co_name: r.co_name,
          field_boy_name: r.field_boy_name,
          associate_lab: r.associate_lab,
          admission_date: r.admission_date,
          collection_date: r.collection_date,
          reporting_date: r.reporting_date,
          status: r.status,
          gross_total: Number(r.gross_total || 0),
          cash_received: Number(r.cash_received || 0),
          card_received: Number(r.card_received || 0),
          online_received: Number(r.online_received || 0),
          discount: Number(r.discount || 0),
          balance_due: Number(r.balance_due || 0),
          remarks: r.remarks,
          created_at: r.created_at,
          tests: []
        };
      }

      if (r.test_name) {
        map[r.id].tests.push({
          booking_test_id: r.booking_test_id,
          id: r.test_code,
          test_code: r.test_code,
          name: r.test_name,
          test_name: r.test_name,
          price: Number(r.price_inr || 0),
          price_inr: Number(r.price_inr || 0),
          status: r.test_status || "Pending"
        });
      }
    }

    res.json(Object.values(map));
  } catch (err) {
    console.error("GET /bookings error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});



/* =========================
   SAVE RELEASED REPORT RESULTS
========================= */
router.post("/reports/save", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { billNo, results } = req.body;

    if (!billNo || !Array.isArray(results) || !results.length) {
      return res.status(400).json({
        success: false,
        message: "billNo and results are required"
      });
    }

    await conn.beginTransaction();

    const [bookings] = await conn.query(
      "SELECT * FROM bookings WHERE bill_no = ? LIMIT 1",
      [billNo]
    );

    if (!bookings.length) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    const booking = bookings[0];

    await conn.query(
      "DELETE FROM report_results WHERE booking_id = ?",
      [booking.id]
    );

    for (const r of results) {
      await conn.query(
        `INSERT INTO report_results
        (booking_id, bill_no, test_name, parameter_name, finding, unit, normal_value, comment, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Reported')`,
        [
          booking.id,
          billNo,
          r.testName || "",
          r.parameterName || "",
          r.finding || "",
          r.unit || "",
          r.normalValue || "",
          r.comment || ""
        ]
      );
    }

    await conn.query(
      "UPDATE bookings SET status = 'Reported', reporting_date = NOW() WHERE id = ?",
      [booking.id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: "Report saved and released",
      billNo,
      totalResults: results.length
    });

  } catch (err) {
    await conn.rollback();
    console.error("POST /reports/save error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    conn.release();
  }
});

/* =========================
   GET REPORT BY BILL NO
========================= */
router.get("/reports/:billNo", async (req, res) => {
  try {
    const billNo = req.params.billNo;

    const [bookings] = await pool.query(
      "SELECT * FROM bookings WHERE bill_no = ? LIMIT 1",
      [billNo]
    );

    if (!bookings.length) {
      return res.status(404).json({
        success: false,
        message: "Booking not found"
      });
    }

    const booking = bookings[0];

    const [results] = await pool.query(
      `SELECT *
       FROM report_results
       WHERE booking_id = ?
       ORDER BY id ASC`,
      [booking.id]
    );

    res.json({
      success: true,
      booking,
      results
    });

  } catch (err) {
    console.error("GET /reports/:billNo error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});


module.exports = router;
// Save generated report permanently
router.post("/reports/save", async (req, res) => {
  try {
    const { billNo, patientName, testName, results } = req.body;

    if (!billNo || !results || !Array.isArray(results)) {
      return res.status(400).json({
        success: false,
        message: "billNo and results required"
      });
    }

    await db.query("DELETE FROM report_results WHERE bill_no = ?", [billNo]);

    for (const r of results) {
      await db.query(
        `INSERT INTO report_results 
        (bill_no, patient_name, test_name, parameter_name, result_value, normal_value, unit, comment)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          billNo,
          patientName || "",
          testName || "",
          r.parameterName || r.parameter_name || "",
          r.resultValue || r.result_value || "",
          r.normalValue || r.normal_value || "",
          r.unit || "",
          r.comment || ""
        ]
      );
    }

    await db.query(
      "UPDATE bookings SET status = 'Reported', report_status = 'Reported' WHERE bill_no = ?",
      [billNo]
    );

    res.json({
      success: true,
      message: "Report saved permanently"
    });
  } catch (err) {
    console.error("Save report error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Get report by bill number
router.get("/reports/:billNo", async (req, res) => {
  try {
    const billNo = req.params.billNo;

    const [bookingRows] = await db.query(
      "SELECT * FROM bookings WHERE bill_no = ? LIMIT 1",
      [billNo]
    );

    const [resultRows] = await db.query(
      "SELECT * FROM report_results WHERE bill_no = ? ORDER BY id ASC",
      [billNo]
    );

    res.json({
      success: true,
      booking: bookingRows[0] || null,
      results: resultRows
    });
  } catch (err) {
    console.error("Get report error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});
