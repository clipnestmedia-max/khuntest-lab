
const express = require("express");
const pool = require("../db");
const auth = require("../middlewares/auth");

const router = express.Router();

function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function safePatient(row = {}) {
  return {
    id: row.id || row.patient_id || null,
    name: row.name || row.patient_name || "",
    phone: row.phone || "",
    email: row.email || "",
    role: "patient"
  };
}

function patientMatchWhere(alias = "") {
  const prefix = alias ? `${alias}.` : "";
  return `(
    ${prefix}email = ?
    OR RIGHT(REPLACE(REPLACE(REPLACE(${prefix}phone, '+', ''), ' ', ''), '-', ''), 10) = ?
    OR ${prefix}patient_id = ?
  )`;
}

router.get("/me", auth("patient"), async (req, res) => {
  const email = String(req.user.email || "").trim().toLowerCase();
  const phone = normalizeIndianPhone(req.user.phone);
  const [rows] = await pool.query(
    `SELECT id, name, phone, email
     FROM patients
     WHERE email = ?
        OR RIGHT(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), 10) = ?
        OR id = ?
     LIMIT 1`,
    [email, phone, req.user.patient_id || req.user.id || 0]
  );

  const patient = rows[0] || {
    id: req.user.patient_id || req.user.id,
    name: req.user.name || "",
    phone: req.user.phone || "",
    email
  };

  res.json({ success: true, patient: safePatient(patient) });
});

router.get("/profile", auth("patient"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM patients WHERE email=? LIMIT 1", [req.user.email]);
  res.json(rows[0] || null);
});

router.get("/bookings", auth("patient"), async (req, res) => {
  const phone = normalizeIndianPhone(req.user.phone);
  const [rows] = await pool.query(
    `SELECT * FROM bookings
     WHERE ${patientMatchWhere("")}
        OR patient_id IN (SELECT id FROM patients WHERE email=?)
     ORDER BY created_at DESC`,
    [req.user.email, phone, req.user.patient_id || req.user.id || 0, req.user.email]
  );
  res.json(rows);
});

router.get("/reports", auth("patient"), async (req, res) => {
  const phone = normalizeIndianPhone(req.user.phone);
  const [rows] = await pool.query(
    `SELECT r.*, b.booking_code, b.patient_name, b.phone 
     FROM reports r 
     JOIN bookings b ON b.id=r.booking_id 
     WHERE ${patientMatchWhere("b")}
        OR b.patient_id IN (SELECT id FROM patients WHERE email=?)
     ORDER BY r.created_at DESC`,
    [req.user.email, phone, req.user.patient_id || req.user.id || 0, req.user.email]
  );
  res.json(rows);
});

router.get("/reports/:billNo", auth("patient"), async (req, res) => {
  const phone = normalizeIndianPhone(req.user.phone);
  const [bookings] = await pool.query(
    `SELECT * FROM bookings
     WHERE bill_no = ?
       AND (${patientMatchWhere("")}
            OR patient_id IN (SELECT id FROM patients WHERE email=?))
     LIMIT 1`,
    [req.params.billNo, req.user.email, phone, req.user.patient_id || req.user.id || 0, req.user.email]
  );

  if (!bookings.length) {
    return res.status(403).json({
      success: false,
      message: "You are not allowed to view this report."
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

  res.json({ success: true, booking, results });
});

router.get("/payments", auth("patient"), async (req, res) => {
  const phone = normalizeIndianPhone(req.user.phone);
  const [rows] = await pool.query(
    `SELECT p.*, b.booking_code FROM payments p 
     JOIN bookings b ON b.id=p.booking_id 
     WHERE ${patientMatchWhere("b")}
        OR b.patient_id IN (SELECT id FROM patients WHERE email=?)
     ORDER BY p.created_at DESC`,
    [req.user.email, phone, req.user.patient_id || req.user.id || 0, req.user.email]
  );
  res.json(rows);
});

module.exports = router;
