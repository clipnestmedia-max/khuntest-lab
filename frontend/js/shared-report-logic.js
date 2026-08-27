// Pure logic for the WhatsApp shared-report client - no Firebase imports,
// so it can run under plain Node for tests (tests/)
// as well as in the browser via shared-report.js.
const MIN_TOKEN_HEX_LENGTH = 32; // 128 bits minimum; we issue 256-bit (64 hex chars)
const MAX_TOKEN_HEX_LENGTH = 128;
const TOKEN_HEX_PATTERN = /^[a-f0-9]+$/;

export function isValidTokenFormat(token) {
  if (typeof token !== "string") return false;
  const value = token.trim();
  if (value.length < MIN_TOKEN_HEX_LENGTH || value.length > MAX_TOKEN_HEX_LENGTH) return false;
  return TOKEN_HEX_PATTERN.test(value);
}

export async function hashTokenHex(rawToken) {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value === "number") return value;
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed.getTime();
}

export function shareState(share, now = Date.now()) {
  if (share.revoked === true || share.enabled === false) return "revoked";
  const expiresAt = toMillis(share.expiresAt);
  if (expiresAt !== null && expiresAt <= now) return "expired";
  return "active";
}

// Mirrors firestore.rules' reportShareReportReleased() - only used here to
// pick the right pending-state message client-side; the actual access
// decision is always re-checked live by that rule, this hint can go stale
// (e.g. a Final report reverted to Draft after being shared) without ever
// granting access it shouldn't.
//
// Returns true only when the share doc has a *recorded* hint that
// positively says the report isn't released yet. Shares created before
// reportStatusHint existed (or any other reason the field is missing) have
// no hint at all - treat that as "unknown", not "not released", and let
// the live reportShareResults read decide, otherwise every pre-existing
// share link would wrongly show "Report Not Ready".
export function isExplicitlyNotReleasedHint(statusHint) {
  const status = String(statusHint || "").trim().toLowerCase();
  if (!status) return false;
  return !["released", "final", "completed"].includes(status);
}

export const MESSAGES = {
  invalid_link: "This report link is invalid.",
  revoked: "This report link is no longer active.",
  expired: "This report link has expired. Please contact {{labName}} for a new link.",
  not_released: "Your report is still under review.",
  payment_pending: "Your payment is pending. Please clear your payment to view and download the report."
};

/** Fill {{labName}} (and any other token) into a MESSAGES string. */
export function message(state, values = {}) {
  return String(MESSAGES[state] || MESSAGES.invalid_link)
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, key) => String(values[key] ?? "the laboratory"));
}
