// WhatsApp delivery - deliberately modular (spec section 12).
//
// Two modes, chosen per laboratory in Lab Settings > WhatsApp:
//
//   "click-to-chat"  Opens wa.me with the message pre-filled. Works today, on
//                    every plan, with no Meta approval and no secrets in the
//                    browser. A human presses send.
//   "cloud-api"      Posts to backend/whatsapp endpoint, which holds the Meta
//                    token server-side and sends automatically.
//
// Nothing here ever holds a token: a WhatsApp Cloud API token in client
// JavaScript would be readable by every visitor. If cloud-api is selected but
// the backend is not deployed, send() falls back to click-to-chat and says so
// rather than silently failing.
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { settingsDoc, getLabId } from "./tenant.js";
import { logAudit, AUDIT } from "./audit.js";

const DEFAULTS = {
  enabled: true,
  mode: "click-to-chat",
  reportReadyTemplate:
    "Dear {{patientName}},\nYour diagnostic report from {{labName}} is ready.\nDownload your report here:\n{{reportLink}}\nThank you.",
  bookingConfirmTemplate:
    "Dear {{patientName}},\nYour booking {{bookingId}} at {{labName}} is confirmed for {{date}}.\nThank you.",
  paymentReminderTemplate:
    "Dear {{patientName}},\nA balance of ₹{{balance}} is pending on bill {{bookingId}} at {{labName}}.\nThank you.",
  collectionAssignedTemplate:
    "Dear {{patientName}},\n{{executiveName}} from {{labName}} will collect your sample on {{date}}.\nContact: {{executivePhone}}",
  // {{items}} is the itemised test list, built by sendBill below.
  billTemplate:
    "*{{labName}}*\n{{billHeading}}\n\nBill No: {{bookingId}}\nPatient: {{patientName}}\nDate: {{date}}\n\n{{items}}\n"
    + "Subtotal: Rs {{subtotal}}\n{{discountLine}}*Total: Rs {{totalAmount}}*\nPaid: Rs {{paidAmount}}\n{{balanceLine}}\n"
    + "Thank you."
};

export async function loadWhatsAppSettings(labId = getLabId()) {
  try {
    const snap = await getDoc(settingsDoc("whatsapp", labId));
    return snap.exists() ? { ...DEFAULTS, ...snap.data() } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

/** {{placeholder}} substitution. Unknown placeholders resolve to empty. */
export function fillTemplate(template, values = {}) {
  return String(template || "").replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => String(values[key] ?? ""));
}

/** Indian numbers are stored as 10 digits; wa.me needs the country code. */
export function toWaNumber(phone) {
  const d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith("91")) return d;
  if (d.length === 11 && d.startsWith("0")) return `91${d.slice(1)}`;
  return d;
}

export function chatUrl(phone, message) {
  const number = toWaNumber(phone);
  if (!number) throw new Error("This contact has no usable WhatsApp number.");
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

/**
 * Send a message. Returns {delivered, mode, url, message} - `delivered` is
 * true only for cloud-api; click-to-chat merely opens the compose window, so
 * the caller must not claim the patient received anything.
 */
export async function sendWhatsApp({ phone, message, kind = "manual", entityId = "", labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  if (settings.enabled === false) {
    return { delivered: false, mode: "disabled", message, url: "", note: "WhatsApp is turned off for this laboratory." };
  }

  if (settings.mode === "cloud-api") {
    try {
      const response = await fetch("/api/lab/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labId, to: toWaNumber(phone), message, kind, entityId })
      });
      if (response.ok) {
        logAudit(AUDIT.REPORT_SHARED, { entityType: kind, entityId, summary: `WhatsApp sent to ${phone}` });
        return { delivered: true, mode: "cloud-api", message, url: "" };
      }
      console.warn("WhatsApp Cloud API rejected the send; falling back to click-to-chat.", response.status);
    } catch (err) {
      console.warn("WhatsApp Cloud API unreachable; falling back to click-to-chat.", err?.message);
    }
  }

  const url = chatUrl(phone, message);
  window.open(url, "_blank", "noopener");
  logAudit(AUDIT.REPORT_SHARED, { entityType: kind, entityId, summary: `WhatsApp compose opened for ${phone}` });
  return {
    delivered: false, mode: "click-to-chat", url, message,
    note: "WhatsApp opened with the message ready - press send in WhatsApp to deliver it."
  };
}

// ---------- prepared messages ----------

export async function sendReportReady({ report, branding, reportLink, labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  const message = fillTemplate(settings.reportReadyTemplate, {
    patientName: report.patientName,
    labName: branding.labName,
    reportLink,
    billNo: report.billNo,
    reportDate: report.reportingDate
  });
  return sendWhatsApp({ phone: report.whatsapp || report.phone, message, kind: "report", entityId: report.reportId, labId });
}

export async function sendBookingConfirmation({ booking, branding, labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  const message = fillTemplate(settings.bookingConfirmTemplate, {
    patientName: booking.patientName,
    labName: branding.labName,
    bookingId: booking.bookingId,
    date: booking.scheduledAt || "your selected slot",
    amount: booking.totalAmount
  });
  return sendWhatsApp({ phone: booking.whatsapp || booking.phone, message, kind: "booking", entityId: booking.bookingId, labId });
}

export async function sendPaymentReminder({ booking, branding, labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  const message = fillTemplate(settings.paymentReminderTemplate, {
    patientName: booking.patientName,
    labName: branding.labName,
    bookingId: booking.bookingId,
    balance: booking.balanceDue
  });
  return sendWhatsApp({ phone: booking.whatsapp || booking.phone, message, kind: "payment", entityId: booking.bookingId, labId });
}

export async function sendCollectionAssigned({ request, branding, labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  const message = fillTemplate(settings.collectionAssignedTemplate, {
    patientName: request.patientName,
    labName: branding.labName,
    executiveName: request.assignedToName,
    executivePhone: request.assignedToPhone,
    date: request.scheduledAt || "the scheduled slot"
  });
  return sendWhatsApp({ phone: request.phone, message, kind: "homeCollection", entityId: request.requestId, labId });
}

/** Itemised bill as a WhatsApp message, addressed from the laboratory. */
export async function sendBill({ booking, branding, labId = getLabId() }) {
  const settings = await loadWhatsAppSettings(labId);
  const rupees = (n) => Number(n || 0).toLocaleString("en-IN");

  const items = (booking.tests || [])
    .map((t, i) => `${i + 1}. ${t.name} - Rs ${rupees(t.price)}`)
    .join("\n");

  const balance = Number(booking.balanceDue || 0);
  const message = fillTemplate(settings.billTemplate, {
    labName: branding.labName,
    billHeading: balance > 0 ? "Bill (payment pending)" : "Payment receipt",
    bookingId: booking.billNo || booking.bookingId,
    patientName: booking.patientName,
    date: booking.dayKey || new Date().toLocaleDateString("en-IN"),
    items: items || "(no tests listed)",
    subtotal: rupees(booking.subtotal),
    discountLine: Number(booking.discount) > 0 ? `Discount: Rs ${rupees(booking.discount)}\n` : "",
    totalAmount: rupees(booking.totalAmount),
    paidAmount: rupees(booking.paidAmount),
    balanceLine: balance > 0 ? `*Balance due: Rs ${rupees(balance)}*` : "Fully paid."
  });

  return sendWhatsApp({
    phone: booking.whatsapp || booking.phone,
    message, kind: "bill", entityId: booking.bookingId, labId
  });
}
