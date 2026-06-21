const nodemailer = require("nodemailer");

function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
}

async function sendOtpEmail(to, otp) {
  const transporter = getTransporter();

  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to,
    subject: "KhunTest Lab Password Reset OTP",
    html: `
      <div style="font-family:Arial,sans-serif;">
        <h2>KhunTest Lab</h2>
        <p>Your password reset OTP is:</p>
        <h1 style="letter-spacing:4px;">${otp}</h1>
        <p>This OTP is valid for 10 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
      </div>
    `
  });
}

module.exports = {
  sendOtpEmail
};
