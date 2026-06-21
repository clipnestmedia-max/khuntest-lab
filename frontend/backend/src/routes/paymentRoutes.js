
const express = require("express");
const crypto = require("crypto");
const pool = require("../db");
const { createRazorpayOrder } = require("../services/razorpayService");

const router = express.Router();

router.post("/razorpay/create-order", async (req, res) => {
  try {
    const { bookingId, amount } = req.body;
    const order = await createRazorpayOrder(Number(amount), "KTL_" + bookingId);

    await pool.query(
      "INSERT INTO payments (booking_id,razorpay_order_id,amount,payment_method,status) VALUES (?,?,?,?, 'Created')",
      [bookingId, order.id, amount, "Razorpay"]
    );

    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.post("/razorpay/verify", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET || "")
      .update(body)
      .digest("hex");

    if (expected !== razorpay_signature && process.env.RAZORPAY_KEY_SECRET) {
      return res.status(400).json({ message: "Invalid payment signature" });
    }

    await pool.query(
      "UPDATE payments SET razorpay_payment_id=?, status='Paid' WHERE razorpay_order_id=?",
      [razorpay_payment_id, razorpay_order_id]
    );

    res.json({ message: "Payment verified" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
