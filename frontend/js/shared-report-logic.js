// Pure logic for the WhatsApp shared-report client - no Firebase imports,
// so it can run under plain Node for tests (frontend/js/test/*.test.js)
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

export const MESSAGES = {
  invalid_link: "This report link is invalid.",
  revoked: "This report link is no longer active.",
  expired: "This report link has expired. Please contact KhunTest Lab.",
  payment_pending: "Your payment is pending. Please clear your payment to view and download the report."
};
