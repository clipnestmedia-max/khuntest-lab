// Pure value formatting and normalisation. NO imports, by design.
//
// Splitting these out of data/helpers.js means the report templates, the
// receipt and the flagging logic can render with no Firebase app initialised —
// so a template can be previewed, printed and unit-tested on its own. Anything
// that needs Firestore lives in data/helpers.js, which re-exports this file so
// existing callers are unaffected.

export function cleanEmail(value) { return String(value || "").trim().toLowerCase(); }

export function digits(value) { return String(value || "").replace(/\D/g, ""); }

/** Last 10 digits, which is how Indian mobile numbers are matched throughout. */
export function normalizePhone(value) {
  const d = digits(value);
  return d.length < 10 ? "" : d.slice(-10);
}

export function normalizeName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

export function titleCase(value) {
  return String(value || "").trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export function toNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function rupees(value) {
  return `₹${toNumber(value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Firestore Timestamp | Date | ISO string -> Date | null */
export function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function toMillis(value) { return toDate(value)?.getTime() || 0; }

/** Local (not UTC) YYYY-MM-DD - report dates must match the lab's own day. */
export function dateKey(value = new Date()) {
  const d = toDate(value) || new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function formatDate(value) {
  const d = toDate(value);
  if (!d) return "";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTime(value) {
  const d = toDate(value);
  if (!d) return "";
  return `${formatDate(d)} ${d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

/** Strip undefined - Firestore rejects them, and they hide real bugs. */
export function clean(object) {
  const out = {};
  Object.entries(object || {}).forEach(([key, value]) => {
    if (value !== undefined) out[key] = value;
  });
  return out;
}

export function chunk(list, size = 10) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function sortByDateDesc(rows, field = "createdAt") {
  return [...rows].sort((a, b) => toMillis(b[field]) - toMillis(a[field]));
}

/**
 * Search tokens for a document. Firestore has no substring search, so the
 * data layer stores an array of lowercase prefixes and words that
 * array-contains can match. Keeps global search fast without a search server.
 */
export function buildSearchTokens(...values) {
  const tokens = new Set();
  values.filter(Boolean).forEach((value) => {
    const text = String(value).toLowerCase().trim();
    if (!text) return;
    tokens.add(text);
    text.split(/[\s,./-]+/).filter((w) => w.length > 1).forEach((word) => {
      tokens.add(word);
      // Prefixes let "rah" match "rahul" without a full-text engine.
      for (let i = 2; i <= Math.min(word.length, 12); i += 1) tokens.add(word.slice(0, i));
    });
  });
  return Array.from(tokens).slice(0, 250);
}

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
