
const axios = require("axios");

function cleanIndianPhone(phone) {
  if (!phone) return "";
  let p = String(phone).replace(/\D/g, "");
  if (p.length === 10) p = "91" + p;
  return p;
}

async function sendWhatsAppText(to, body) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v20.0";

  if (!token || !phoneNumberId) {
    return {
      demo: true,
      status: "not_sent",
      message: "WhatsApp credentials missing. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env"
    };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: cleanIndianPhone(to),
    type: "text",
    text: { preview_url: true, body }
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

async function sendWhatsAppDocument(to, documentUrl, filename, caption) {
  const token = process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const version = process.env.WHATSAPP_API_VERSION || "v20.0";

  if (!token || !phoneNumberId) {
    return {
      demo: true,
      status: "not_sent",
      message: "WhatsApp credentials missing. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID in .env"
    };
  }

  const url = `https://graph.facebook.com/${version}/${phoneNumberId}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: cleanIndianPhone(to),
    type: "document",
    document: {
      link: documentUrl,
      filename: filename || "KhunTest_Report.pdf",
      caption: caption || "Your KhunTest Lab report is ready."
    }
  };

  const response = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    }
  });

  return response.data;
}

module.exports = {
  sendWhatsAppText,
  sendWhatsAppDocument,
  cleanIndianPhone
};
