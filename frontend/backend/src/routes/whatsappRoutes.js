const express = require("express");
const router = express.Router();
const axios = require("axios");

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const API_VERSION = process.env.WHATSAPP_API_VERSION || "v25.0";

function cleanPhone(phone) {
  let p = String(phone || "").replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return p;
}

router.post("/send-test", async (req, res) => {
  try {
    const { phone, message } = req.body;

    if (!phone || !message) {
      return res.status(400).json({
        success: false,
        message: "phone and message required"
      });
    }

    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone(phone),
      type: "text",
      text: {
        preview_url: false,
        body: message
      }
    };

    const result = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json({
      success: true,
      result: result.data
    });
  } catch (err) {
    console.error("WhatsApp error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: err.response?.data?.error?.message || err.message,
      error: err.response?.data || null
    });
  }
});
router.post("/send-report-ready", async (req, res) => {
  try {
    const { phone, patientName, billNo } = req.body;

    if (!phone || !patientName || !billNo) {
      return res.status(400).json({
        success: false,
        message: "phone, patientName and billNo required"
      });
    }

    const reportLink = `${process.env.PUBLIC_BASE_URL || "http://187.127.176.246"}/report.html?bill=${billNo}`;

    const message =
`Dear ${patientName},

Your KhunTest Lab report is ready.

Report Link:
${reportLink}

Please click the link to view/download your report.

Regards,
KhunTest Lab`;

    const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

    const payload = {
      messaging_product: "whatsapp",
      to: cleanPhone(phone),
      type: "text",
      text: {
        preview_url: true,
        body: message
      }
    };

    const result = await axios.post(url, payload, {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });

    res.json({
      success: true,
      result: result.data,
      reportLink
    });
  } catch (err) {
    console.error("WhatsApp report error:", err.response?.data || err.message);

    res.status(500).json({
      success: false,
      message: err.response?.data?.error?.message || err.message,
      error: err.response?.data || null
    });
  }
});
module.exports = router;
