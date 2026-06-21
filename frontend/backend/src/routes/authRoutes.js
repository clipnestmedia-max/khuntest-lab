const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { sendOtpEmail } = require("../services/emailService");

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      patient_id: user.patient_id || null
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d"
    }
  );
}

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Register user: admin/patient
router.post("/register", async (req, res) => {
  try {
    const { name, email, phone, password, role, patient_id } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required"
      });
    }

    const finalRole = role === "admin" ? "admin" : "patient";

    const [existing] = await pool.query(
      "SELECT id FROM users WHERE email = ? LIMIT 1",
      [email]
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: "Email already registered"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users 
      (name, email, phone, password_hash, role, patient_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name || "",
        email,
        phone || "",
        passwordHash,
        finalRole,
        patient_id || null
      ]
    );

    res.json({
      success: true,
      message: "User registered successfully",
      userId: result.insertId
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Login
router.post("/login", async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password required"
      });
    }

    let query = "SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1";
    const params = [email];

    const [rows] = await pool.query(query, params);

    if (!rows.length) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const user = rows[0];

    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "Invalid login panel"
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);

    if (!ok) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password"
      });
    }

    const token = createToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        patient_id: user.patient_id
      }
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Forgot password: send OTP
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email required"
      });
    }

    let sql = "SELECT * FROM users WHERE email = ? AND is_active = 1 LIMIT 1";
    const [rows] = await pool.query(sql, [email]);

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "No account found with this email"
      });
    }

    const user = rows[0];

    if (role && user.role !== role) {
      return res.status(403).json({
        success: false,
        message: "This email is not registered for this panel"
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(
      `INSERT INTO password_reset_otps
      (user_id, email, otp_hash, expires_at)
      VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, email, otpHash]
    );

    await sendOtpEmail(email, otp);

    res.json({
      success: true,
      message: "OTP sent to email"
    });
  } catch (err) {
    console.error("Forgot password error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Verify OTP only
router.post("/verify-otp", async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        message: "Email and OTP required"
      });
    }

    const [rows] = await pool.query(
      `SELECT * FROM password_reset_otps
       WHERE email = ? AND is_used = 0 AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );

    if (!rows.length) {
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found"
      });
    }

    const otpRow = rows[0];
    const ok = await bcrypt.compare(otp, otpRow.otp_hash);

    if (!ok) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    res.json({
      success: true,
      message: "OTP verified"
    });
  } catch (err) {
    console.error("Verify OTP error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
});

// Reset password
router.post("/reset-password", async (req, res) => {
  const conn = await pool.getConnection();

  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Email, OTP and new password required"
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters"
      });
    }

    await conn.beginTransaction();

    const [otpRows] = await conn.query(
      `SELECT * FROM password_reset_otps
       WHERE email = ? AND is_used = 0 AND expires_at > NOW()
       ORDER BY id DESC
       LIMIT 1`,
      [email]
    );

    if (!otpRows.length) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "OTP expired or not found"
      });
    }

    const otpRow = otpRows[0];
    const ok = await bcrypt.compare(otp, otpRow.otp_hash);

    if (!ok) {
      await conn.rollback();
      return res.status(400).json({
        success: false,
        message: "Invalid OTP"
      });
    }

    const newHash = await bcrypt.hash(newPassword, 10);

    await conn.query(
      "UPDATE users SET password_hash = ? WHERE id = ?",
      [newHash, otpRow.user_id]
    );

    await conn.query(
      "UPDATE password_reset_otps SET is_used = 1 WHERE id = ?",
      [otpRow.id]
    );

    await conn.commit();

    res.json({
      success: true,
      message: "Password reset successful"
    });
  } catch (err) {
    await conn.rollback();

    console.error("Reset password error:", err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  } finally {
    conn.release();
  }
});

module.exports = router;
