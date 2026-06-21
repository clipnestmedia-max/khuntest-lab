
const Razorpay = require("razorpay");

function getRazorpay() {
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
  });
}

async function createRazorpayOrder(amountInRupees, receipt) {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return {
      demo: true,
      id: "demo_order_" + Date.now(),
      amount: amountInRupees * 100,
      currency: "INR",
      receipt
    };
  }

  const razorpay = getRazorpay();
  return razorpay.orders.create({
    amount: Math.round(amountInRupees * 100),
    currency: "INR",
    receipt
  });
}

module.exports = { createRazorpayOrder };
