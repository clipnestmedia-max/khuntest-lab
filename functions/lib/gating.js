const crypto = require("crypto");

const MIN_TOKEN_HEX_LENGTH = 32; // 128 bits minimum, we issue 256-bit (64 hex chars) tokens
const MAX_TOKEN_HEX_LENGTH = 128;
const TOKEN_HEX_PATTERN = /^[a-f0-9]+$/;

function isValidTokenFormat(token) {
  if (typeof token !== "string") return false;
  const value = token.trim();
  if (value.length < MIN_TOKEN_HEX_LENGTH || value.length > MAX_TOKEN_HEX_LENGTH) return false;
  return TOKEN_HEX_PATTERN.test(value);
}

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken), "utf8").digest("hex");
}

function isReportReleased(report) {
  const status = String(report?.reportStatus || report?.status || "").trim().toLowerCase();
  return ["released", "final", "completed"].includes(status);
}

function isReportPaymentCleared({ booking, report }) {
  const status = String(
    booking?.paymentStatus ||
    report?.paymentStatus ||
    ""
  ).trim().toLowerCase();

  // An explicit Paid/Completed status (or isPaid flag) must unlock the
  // report on its own, even if balanceDue/dueAmount is stale - mirrors
  // firestore.rules' reportShareBookingPaid(), which is what's actually
  // live in production (see functions/README.md). Admin's saveBookingEdit()
  // writes paymentStatus from a dropdown without always re-zeroing balance,
  // so requiring both would leave an already-"Paid" report stuck showing
  // Payment Pending.
  const explicitlyPaid = (
    booking?.isPaid === true ||
    report?.isPaid === true ||
    status === "paid" ||
    status === "completed" ||
    status === "payment completed"
  );
  if (explicitlyPaid) return true;

  const balanceRaw = booking?.balanceDue ?? booking?.dueAmount ?? report?.balanceDue ?? report?.dueAmount ?? 0;
  const balance = Number(balanceRaw);
  const explicitlyUnpaid = ["pending", "partial", "failed"].includes(status);

  return !explicitlyUnpaid && Number.isFinite(balance) && balance <= 0;
}

function paymentSummary({ booking, report }) {
  const status = booking?.paymentStatus || report?.paymentStatus || "Pending";
  const balanceDue = Number(booking?.balanceDue ?? booking?.dueAmount ?? report?.balanceDue ?? 0);
  return {
    status: String(status || "Pending"),
    balanceDue: Number.isFinite(balanceDue) ? balanceDue : 0
  };
}

function isShareUsable(share, now = Date.now()) {
  if (!share) return { ok: false, reason: "invalid_link" };
  if (share.revoked === true) return { ok: false, reason: "revoked" };
  if (share.enabled === false) return { ok: false, reason: "revoked" };
  const expiresAt = toMillis(share.expiresAt);
  if (expiresAt !== null && expiresAt <= now) return { ok: false, reason: "expired" };
  return { ok: true };
}

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

module.exports = {
  isValidTokenFormat,
  hashToken,
  isReportReleased,
  isReportPaymentCleared,
  paymentSummary,
  isShareUsable,
  toMillis,
  MIN_TOKEN_HEX_LENGTH,
  MAX_TOKEN_HEX_LENGTH
};
