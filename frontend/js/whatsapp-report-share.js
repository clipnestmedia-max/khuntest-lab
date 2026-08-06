// Admin-only module: creates/reuses/revokes secure WhatsApp report-share
// tokens and builds the WhatsApp message. Used from admin-dashboard.html.
//
// Security model: the raw token is never written to Firestore (only its
// SHA-256 hash, which also doubles as the reportShares document ID, so a
// client must already know the exact unguessable id to get() it - no query,
// no enumeration - see frontend/firestore.rules). The sanitized report
// content lives in a second collection (reportShareResults, same id) whose
// rule re-checks the linked booking's payment status live on every read, so
// a link starts working the moment admin marks payment Paid with no new
// token needed. There is no Cloud Function in this flow (this project's GCP
// APIs for Cloud Functions/Cloud Build aren't enabled yet) - everything here
// talks to Firestore directly, gated entirely by firestore.rules.
//
// Because the raw token can't be recovered from Firestore once written,
// this module caches it in this admin browser's localStorage purely as a
// UX convenience for repeat "Copy Link"/"Share on WhatsApp" clicks. If that
// cache is gone (different device, cleared storage), the caller should fall
// back to Regenerate Link - see getOrCreateShareForReport()'s `reused` /
// `rawToken` fields.
import { auth, db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { hashTokenHex } from "./shared-report-logic.js";

const SHARE_COLLECTION = "reportShares";
const RESULTS_COLLECTION = "reportShareResults";
const TOKEN_BYTES = 32; // 256 bits of randomness, well above the 128-bit minimum
const CACHE_KEY = "khuntest_share_token_cache_v1";

// Mirrors functions/lib/sanitize.js's allowlist - only what report.html
// needs to render, never Firebase UIDs, internal ids, or contact info.
const SHARE_REPORT_FIELDS = [
  "billNo", "patientName", "age", "gender", "refBy", "doctor",
  "collectionDate", "registeredDate", "reportingDate", "reportStatus", "status",
  "tests", "selectedTests", "reportItems", "results", "reportResults",
  "esrFirstHour", "esrSecondHour"
];
const SHARE_DATE_FIELDS = ["collectionDate", "registeredDate", "reportingDate", "releasedAt", "createdAt"];

function toIsoOrValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value ?? "";
}

function sanitizeReportForShare(report) {
  const sanitized = {};
  SHARE_REPORT_FIELDS.forEach((field) => {
    if (report[field] !== undefined) sanitized[field] = report[field];
  });
  SHARE_DATE_FIELDS.forEach((field) => {
    if (sanitized[field] !== undefined) sanitized[field] = toIsoOrValue(sanitized[field]);
  });
  if (report.releasedAt !== undefined) sanitized.releasedAt = toIsoOrValue(report.releasedAt);
  if (report.createdAt !== undefined) sanitized.createdAt = toIsoOrValue(report.createdAt);
  return sanitized;
}

export function generateSecureShareToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export { hashTokenHex };

function readCache() {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch (_err) { return {}; }
}

function writeCache(cache) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (_err) {}
}

function cacheToken(reportId, shareId, rawToken) {
  const cache = readCache();
  cache[reportId] = { shareId, rawToken, cachedAt: Date.now() };
  writeCache(cache);
}

function cachedTokenFor(reportId, shareId) {
  const entry = readCache()[reportId];
  return entry && entry.shareId === shareId ? entry.rawToken : null;
}

function clearCachedToken(reportId) {
  const cache = readCache();
  delete cache[reportId];
  writeCache(cache);
}

async function findActiveShare(reportId) {
  const q = query(
    collection(db, SHARE_COLLECTION),
    where("reportId", "==", reportId),
    where("enabled", "==", true),
    where("revoked", "==", false),
    limit(5)
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docs = snap.docs.slice().sort((a, b) => (b.data().createdAt?.toMillis?.() || 0) - (a.data().createdAt?.toMillis?.() || 0));
  return docs[0];
}

async function findAnyShare(reportId) {
  const q = query(collection(db, SHARE_COLLECTION), where("reportId", "==", reportId), limit(20));
  const snap = await getDocs(q);
  return snap.docs;
}

// Resolves the canonical reports/{id} document for a share request.
//
// The reports collection is normally keyed by billNo (see admin-dashboard.html
// upsertReport()), but that's only true the first time a report is created.
// If a report is later re-saved after its booking's bill number changed,
// upsertReport() updates the *existing* document (found by querying the
// billNo field) rather than moving it to a new doc id - so the document id
// can permanently diverge from the current billNo. report.html's
// getReportByBillNo() already tolerates this with a billNo-field query
// fallback; this mirrors that so "Share on WhatsApp" is exactly as
// resilient as View/Print instead of failing with "report not found"
// whenever a report's id and billNo have drifted apart.
export async function resolveReportDoc(reportId, billNo) {
  const directSnap = await getDoc(doc(db, "reports", reportId));
  if (directSnap.exists()) return directSnap;
  if (!billNo) return directSnap;

  const byString = await getDocs(query(collection(db, "reports"), where("billNo", "==", String(billNo)), limit(2)));
  if (byString.size === 1) return byString.docs[0];
  if (byString.size > 1) {
    throw new Error("Multiple reports found for this bill number. Please contact support.");
  }

  const numericBill = Number(billNo);
  if (String(billNo).trim() !== "" && Number.isFinite(numericBill)) {
    const byNumber = await getDocs(query(collection(db, "reports"), where("billNo", "==", numericBill), limit(2)));
    if (byNumber.size === 1) return byNumber.docs[0];
    if (byNumber.size > 1) {
      throw new Error("Multiple reports found for this bill number. Please contact support.");
    }
  }

  return directSnap;
}

async function createShare({ reportId, bookingId, billNo }) {
  if (!reportId) throw new Error("reportId is required to create a share link.");
  if (!bookingId) {
    // The shared-link payment check (firestore.rules reportShareBookingPaid)
    // re-reads bookings/{bookingId} live on every access - without a real
    // booking id it can never confirm payment, so the link would be stuck
    // showing "payment pending" forever regardless of actual payment
    // status. Fail loudly here instead of writing a share that can never
    // work - see admin-dashboard.html's renderReportsPanel() for where a
    // wrong/missing bookingId (e.g. billNo used as a stand-in) got fixed.
    throw new Error(`Cannot create a share link: report ${billNo || reportId} has no linked booking id.`);
  }

  console.info("Share request identifiers", { reportId, billNo: billNo || "", bookingId });

  const [reportSnap, bookingSnap] = await Promise.all([
    resolveReportDoc(reportId, billNo),
    getDoc(doc(db, "bookings", bookingId)).catch(() => null)
  ]);
  if (!reportSnap.exists()) {
    throw new Error(
      billNo
        ? "Report could not be found in Firestore for the supplied report ID or bill number."
        : "Cannot create a share link: report not found."
    );
  }
  const canonicalReportId = reportSnap.id;
  if (canonicalReportId !== reportId) {
    console.info("Share request resolved report via billNo fallback", { requestedReportId: reportId, canonicalReportId, billNo });
  }
  if (!bookingSnap || !bookingSnap.exists()) {
    throw new Error(`Cannot create a share link: linked booking ${bookingId} was not found.`);
  }
  const report = reportSnap.data();
  const booking = bookingSnap.data();

  const rawToken = generateSecureShareToken();
  const tokenHash = await hashTokenHex(rawToken);

  await setDoc(doc(db, SHARE_COLLECTION, tokenHash), {
    reportId: String(canonicalReportId || ""),
    bookingId: String(bookingId || ""),
    billNo: String(billNo || ""),
    tokenHash,
    enabled: true,
    revoked: false,
    expiresAt: null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser?.uid || "",
    lastAccessedAt: null,
    accessCount: 0,
    // Denormalized display-only copy of payment state, kept in sync by
    // syncSharePaymentHint() whenever admin edits the booking - the actual
    // access decision is re-checked live against the booking by
    // firestore.rules on every read, this is only for the payment-pending
    // card's "Balance Due" line so it doesn't need a live read of its own
    // (which an anonymous visitor isn't allowed anyway).
    paymentStatusHint: booking.paymentStatus || "",
    balanceDueHint: Number(booking.balanceDue ?? booking.dueAmount ?? 0)
  });

  await setDoc(doc(db, RESULTS_COLLECTION, tokenHash), sanitizeReportForShare(report));

  cacheToken(canonicalReportId, tokenHash, rawToken);
  return { shareId: tokenHash, rawToken, reused: false, canonicalReportId };
}

/**
 * Call after any write that changes a booking's payment fields, so already-
 * issued share links reflect the new balance without needing a live read
 * (anonymous shared-link visitors can't read bookings/{bookingId} directly).
 * Safe to call for bookings that have no share yet - it's then a no-op.
 */
export async function syncSharePaymentHint(bookingId, { paymentStatus, balanceDue, dueAmount } = {}) {
  if (!bookingId) return;
  const q = query(collection(db, SHARE_COLLECTION), where("bookingId", "==", String(bookingId)), where("enabled", "==", true), limit(10));
  const snap = await getDocs(q).catch((err) => {
    console.warn("Failed to look up shares for payment hint sync", err);
    return { docs: [] };
  });
  await Promise.all(snap.docs.map((d) => updateDoc(doc(db, SHARE_COLLECTION, d.id), {
    paymentStatusHint: paymentStatus || "",
    balanceDueHint: Number(balanceDue ?? dueAmount ?? 0)
  }).catch((err) => console.warn("Failed to sync share payment hint", d.id, err))));
}

/**
 * Returns the active share for a report, creating one if none exists.
 * `rawToken` is only present when we just created it or still have it
 * cached locally - callers must handle `rawToken === null` (existing share,
 * but the link can't be reconstructed on this device) by offering Regenerate.
 */
export async function getOrCreateShareForReport({ reportId, bookingId, billNo }) {
  if (!reportId) throw new Error("reportId is required to create a share link.");
  // Resolve to the canonical report doc id *before* checking for an existing
  // share - otherwise a caller passing a stale id (e.g. billNo when the
  // report doc has since diverged from it) would never find the share
  // filed under the canonical id and would create a fresh duplicate on
  // every click. See resolveReportDoc() for why ids can diverge.
  const reportSnap = await resolveReportDoc(reportId, billNo);
  if (!reportSnap.exists()) {
    throw new Error(
      billNo
        ? "Report could not be found in Firestore for the supplied report ID or bill number."
        : "Cannot create a share link: report not found."
    );
  }
  const canonicalReportId = reportSnap.id;
  const existing = await findActiveShare(canonicalReportId);
  if (existing) {
    const rawToken = cachedTokenFor(canonicalReportId, existing.id);
    return { shareId: existing.id, rawToken, reused: true, share: existing.data() };
  }
  return createShare({ reportId: canonicalReportId, bookingId, billNo });
}

export async function getShareStatus(reportId) {
  if (!reportId) return "not_created";
  const existing = await findActiveShare(reportId);
  if (existing) return "active";
  const any = await findAnyShare(reportId);
  return any.length ? "revoked" : "not_created";
}

export async function revokeSharesForReport(reportId) {
  const docs = await findAnyShare(reportId);
  await Promise.all(docs
    .filter((d) => d.data().enabled !== false && d.data().revoked !== true)
    .map((d) => updateDoc(doc(db, SHARE_COLLECTION, d.id), { revoked: true, enabled: false })));
  clearCachedToken(reportId);
}

export async function regenerateShareForReport({ reportId, bookingId, billNo }) {
  await revokeSharesForReport(reportId);
  return createShare({ reportId, bookingId, billNo });
}

export function buildShareUrl(rawToken) {
  return `https://khuntest.com/report.html?share=${encodeURIComponent(rawToken)}`;
}

export function normalizeIndianWhatsAppNumber(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "91" + digits;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return "91" + digits.slice(1);
  return digits;
}

export function buildWhatsAppReportMessage({ patientName, billNo, shareUrl }) {
  const name = String(patientName || "Patient").trim() || "Patient";
  return [
    `Hello ${name},`,
    "",
    "Your KhunTest Lab report is ready.",
    "",
    "View/Download Report:",
    shareUrl,
    "",
    `Bill No: ${billNo || ""}`,
    "",
    "If payment is pending, please clear the payment to access your report.",
    "",
    "For assistance:",
    "+91 9234277007",
    "",
    "KhunTest Lab",
    "Accurate • Reliable • Trusted"
  ].join("\n");
}

export function buildWhatsAppUrl(phone, message) {
  const clean = normalizeIndianWhatsAppNumber(phone);
  if (!clean) return "";
  return `https://wa.me/${clean}?text=${encodeURIComponent(message)}`;
}

/**
 * High-level helper for the admin dashboard's "Share on WhatsApp" button.
 * Returns { ok: true, url } or { ok: false, reason } where reason is one of
 * "no-phone" | "needs-regenerate".
 */
export async function prepareWhatsAppShare({ reportId, bookingId, billNo, patientName, phone }) {
  const { rawToken, reused } = await getOrCreateShareForReport({ reportId, bookingId, billNo });
  if (!rawToken) {
    return { ok: false, reason: "needs-regenerate", reused };
  }
  const shareUrl = buildShareUrl(rawToken);
  const message = buildWhatsAppReportMessage({ patientName, billNo, shareUrl });
  const waUrl = buildWhatsAppUrl(phone, message);
  if (!waUrl) return { ok: false, reason: "no-phone" };
  return { ok: true, url: waUrl, shareUrl };
}
