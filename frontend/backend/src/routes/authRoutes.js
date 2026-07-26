const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("../db");
const { sendOtpEmail } = require("../services/emailService");

const router = express.Router();

function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function normalizeLoginIdentifier(value) {
  const cleaned = String(value || "").trim();
  const digits = cleaned.replace(/\D/g, "");
  if (/^\+?91[\s-]?\d{10}$/.test(cleaned.replace(/\s|-/g, ""))) return digits.slice(-10);
  if (/^\d{10}$/.test(digits)) return digits;
  return cleaned.toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    patient_id: user.patient_id
  };
}

async function findActiveUserByIdentifier(identifier, role = null) {
  const normalized = normalizeLoginIdentifier(identifier);
  const phone = normalizeIndianPhone(normalized);
  const params = [];
  const clauses = [];

  if (normalized.includes("@")) {
    clauses.push("LOWER(email) = ?");
    params.push(normalized);
  }

  if (phone) {
    const phoneCandidates = [
      phone,
      "0" + phone,
      "91" + phone,
      "+91" + phone,
      "+91 " + phone,
      phone.replace(/(\d{5})(\d{5})/, "$1 $2"),
      phone.replace(/(\d{5})(\d{5})/, "$1-$2")
    ];
    clauses.push("(phone IN (?) OR RIGHT(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), 10) = ?)");
    params.push(phoneCandidates, phone);
  }

  if (!clauses.length) return null;

  let sql = `SELECT * FROM users WHERE is_active = 1 AND (${clauses.join(" OR ")})`;
  if (role) {
    sql += " AND role = ?";
    params.push(role);
  }
  sql += " LIMIT 1";

  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

function createToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
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
async function registerHandler(req, res) {
  try {
    const { name, email, phone, password, role, patient_id } = req.body;
    const finalRole = role === "admin" ? "admin" : "patient";
    const normalizedPhone = normalizeIndianPhone(phone);
    const cleanEmail = String(email || "").trim().toLowerCase();
    const finalEmail = cleanEmail || (finalRole === "patient" && normalizedPhone ? `${normalizedPhone}@patients.khuntest.local` : "");

    if (!finalEmail || !password) {
      return res.status(400).json({
        success: false,
        message: finalRole === "patient" ? "Mobile number and password required" : "Email and password required"
      });
    }

    const [existing] = await pool.query(
      `SELECT id FROM users
       WHERE email = ?
          OR (? <> '' AND RIGHT(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), 10) = ?)
       LIMIT 1`,
      [finalEmail, normalizedPhone, normalizedPhone]
    );

    if (existing.length) {
      return res.status(409).json({
        success: false,
        message: finalRole === "patient" ? "This mobile number is already registered. Please log in." : "Email already registered"
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const [result] = await pool.query(
      `INSERT INTO users 
      (name, email, phone, password_hash, role, patient_id)
      VALUES (?, ?, ?, ?, ?, ?)`,
      [
        name || "",
        finalEmail,
        normalizedPhone || phone || "",
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
}

router.post("/register", registerHandler);

// Login
async function loginHandler(req, res) {
  try {
    const { email, phone, identifier, password, role } = req.body;
    const loginIdentifier = identifier || phone || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({
        success: false,
        message: "Mobile number/email and password required"
      });
    }

    const user = await findActiveUserByIdentifier(loginIdentifier, role || null);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Mobile number/email or password is incorrect."
      });
    }

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
        message: "Mobile number/email or password is incorrect."
      });
    }

    const token = createToken(user);

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: publicUser(user),
      patient: user.role === "patient" ? publicUser(user) : undefined
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({
      success: false,
      message: err.message
    });
  }
}

router.post("/login", loginHandler);

router.post("/patient/login", (req, res) => {
  req.body = { ...req.body, role: "patient" };
  return loginHandler(req, res);
});

router.post("/patient/register", (req, res) => {
  req.body = { ...req.body, role: "patient" };
  return registerHandler(req, res);
});

// Forgot password: send OTP
router.post("/forgot-password", async (req, res) => {
  try {
    const { email, phone, identifier, role } = req.body;
    const loginIdentifier = identifier || phone || email;

    if (!loginIdentifier) {
      return res.status(400).json({
        success: false,
        message: "Mobile number or email required"
      });
    }

    const user = await findActiveUserByIdentifier(loginIdentifier, role || null);

    if (!user || !user.email || user.email.endsWith("@patients.khuntest.local")) {
      return res.json({
        success: true,
        message: "If an account exists, password reset instructions will be sent."
      });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);

    await pool.query(
      `INSERT INTO password_reset_otps
      (user_id, email, otp_hash, expires_at)
      VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))`,
      [user.id, user.email, otpHash]
    );

    await sendOtpEmail(user.email, otp);

    res.json({
      success: true,
      message: "If an account exists, password reset instructions will be sent."
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
