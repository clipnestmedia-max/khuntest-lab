// Admin-only module: creates/reuses/revokes secure WhatsApp report-share
// tokens and builds the WhatsApp message. Used from admin-dashboard.html.
//
// Security model: the raw token is never written to Firestore (only its
// SHA-256 hash, which also doubles as the reportShares document ID so the
// public getSharedReport Cloud Function can look it up with a single get()
// and no query). Because the raw token can't be recovered from Firestore,
// this module caches it in this admin browser's localStorage purely as a
// UX convenience for repeat "Copy Link"/"Share on WhatsApp" clicks. If that
// cache is gone (different device, cleared storage), the caller should fall
// back to Regenerate Link - see getOrCreateShareForReport()'s `reused` /
// `rawToken` fields.
import { auth, db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const SHARE_COLLECTION = "reportShares";
const TOKEN_BYTES = 32; // 256 bits of randomness, well above the 128-bit minimum
const CACHE_KEY = "khuntest_share_token_cache_v1";

export function generateSecureShareToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function hashTokenHex(rawToken) {
  const data = new TextEncoder().encode(rawToken);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

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

async function createShare({ reportId, bookingId, billNo }) {
  const rawToken = generateSecureShareToken();
  const tokenHash = await hashTokenHex(rawToken);
  await setDoc(doc(db, SHARE_COLLECTION, tokenHash), {
    reportId: String(reportId || ""),
    bookingId: String(bookingId || ""),
    billNo: String(billNo || ""),
    tokenHash,
    enabled: true,
    revoked: false,
    expiresAt: null,
    createdAt: serverTimestamp(),
    createdBy: auth.currentUser?.uid || "",
    lastAccessedAt: null,
    accessCount: 0
  });
  cacheToken(reportId, tokenHash, rawToken);
  return { shareId: tokenHash, rawToken, reused: false };
}

/**
 * Returns the active share for a report, creating one if none exists.
 * `rawToken` is only present when we just created it or still have it
 * cached locally - callers must handle `rawToken === null` (existing share,
 * but the link can't be reconstructed on this device) by offering Regenerate.
 */
export async function getOrCreateShareForReport({ reportId, bookingId, billNo }) {
  if (!reportId) throw new Error("reportId is required to create a share link.");
  const existing = await findActiveShare(reportId);
  if (existing) {
    const rawToken = cachedTokenFor(reportId, existing.id);
    return { shareId: existing.id, rawToken, reused: true, share: existing.data() };
  }
  return createShare({ reportId, bookingId, billNo });
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
