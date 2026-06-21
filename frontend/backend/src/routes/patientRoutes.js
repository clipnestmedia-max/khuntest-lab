
const express = require("express");
const pool = require("../db");
const auth = require("../middlewares/auth");

const router = express.Router();

router.get("/profile", auth("patient"), async (req, res) => {
  const [rows] = await pool.query("SELECT * FROM patients WHERE email=? LIMIT 1", [req.user.email]);
  res.json(rows[0] || null);
});

router.get("/bookings", auth("patient"), async (req, res) => {
  const [rows] = await pool.query(
    "SELECT * FROM bookings WHERE email=? OR patient_id IN (SELECT id FROM patients WHERE email=?) ORDER BY created_at DESC",
    [req.user.email, req.user.email]
  );
  res.json(rows);
});

router.get("/reports", auth("patient"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT r.*, b.booking_code, b.patient_name, b.phone 
     FROM reports r 
     JOIN bookings b ON b.id=r.booking_id 
     WHERE b.email=? OR b.patient_id IN (SELECT id FROM patients WHERE email=?)
     ORDER BY r.created_at DESC`,
    [req.user.email, req.user.email]
  );
  res.json(rows);
});

router.get("/payments", auth("patient"), async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, b.booking_code FROM payments p 
     JOIN bookings b ON b.id=p.booking_id 
     WHERE b.email=? OR b.patient_id IN (SELECT id FROM patients WHERE email=?)
     ORDER BY p.created_at DESC`,
    [req.user.email, req.user.email]
  );
  res.json(rows);
});

module.exports = router;
