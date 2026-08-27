// Secure, tenant-aware report share links.
//
// Security model carried over verbatim from KhunTest, which got this right:
// the raw token is NEVER written to Firestore - only its SHA-256, which also
// doubles as the document id. A client must already know the exact unguessable
// 256-bit token to get() the document; `list` is denied so the collection
// cannot be enumerated. The medical content lives in a second collection with
// the same id, whose rule re-checks payment and release state live on every
// read, so a link starts working the moment the bill is settled and stops
// working the moment the report is reverted - with no new token.
//
// What is new here: every share document carries labId, and the rules resolve
// the booking and report under /labs/{labId}/..., so one laboratory can never
// mint a link that reads another laboratory's report.
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../core/firebase-config.js";
import { getLabId, settingsDoc } from "../core/tenant.js";
import { loadBranding } from "../core/branding.js";
import { hashTokenHex } from "../js/shared-report-logic.js";
import { flatResultsFromGroups } from "../core/data/reports.js";
import { logAudit, AUDIT } from "../core/audit.js";

const SHARES = "reportShares";
const RESULTS = "reportShareResults";
const TOKEN_BYTES = 32;                       // 256 bits
const CACHE_KEY = "swati_share_tokens_v1";
const DEFAULT_TTL_DAYS = 90;

// Only what report.html needs to render. Never UIDs, internal ids or contact
// details - anyone holding the link can read this document.
const SHARE_FIELDS = [
  "reportId", "billNo", "patientName", "age", "gender", "refBy",
  "collectionDate", "reportingDate", "sampleType", "reportStatus",
  "groups", "interpretation", "templateId", "signatory", "medicalNotices"
];

export function generateToken() {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The raw token cannot be recovered from Firestore once written, so this
 * browser keeps a copy purely so "Copy Link" works twice. Losing the cache is
 * harmless - regenerate produces a fresh link.
 */
function cacheRead(reportId) {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}")[`${getLabId()}:${reportId}`] || ""; }
  catch { return ""; }
}

function cacheWrite(reportId, token) {
  try {
    const all = JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
    all[`${getLabId()}:${reportId}`] = token;
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch { /* private browsing */ }
}

/**
 * Everything the shared page needs to render the report the way the laboratory
 * prints it.
 *
 * A patient opening a WhatsApp link is not signed in, so firestore.rules will
 * not let them read /labs/{labId}/settings/report. Without this snapshot the
 * viewer fell back to whatever templateId was stored on the report - usually a
 * stale one - and rendered a different layout, with no signatures and none of
 * the laboratory's letterhead. So the presentation is frozen into the share at
 * the moment it is created, which is also correct: a link handed out today
 * should keep looking like the report that was handed out today.
 */
async function presentationSnapshot() {
  const labId = getLabId();
  let settings = {};
  try {
    const snap = await getDoc(settingsDoc("report"));
    if (snap.exists()) settings = snap.data();
  } catch { /* fall through to branding defaults */ }

  const branding = await loadBranding(labId).catch(() => ({}));

  return {
    // How it is laid out.
    templateId: settings.templateId || branding.reportTemplate || "modern-diagnostic",
    pageBreakPerTest: settings.pageBreakPerTest !== false,
    showQrVerification: settings.showQrVerification !== false,
    showWatermark: settings.showWatermark !== false,
    showMethod: settings.showMethod === true,
    headerNote: settings.headerNote || "",
    footerNote: settings.footerNote || "",
    disclaimer: settings.disclaimer || branding.disclaimer || "",
    signatories: settings.signatories || branding.signatories || [],
    customTemplate: settings.customTemplate || null,
    // Who it is from. publicLabs carries only a contact profile, not the full
    // letterhead, so the brand fields the templates need come along here.
    branding: {
      labName: branding.labName || "", legalName: branding.legalName || "",
      tagline: branding.tagline || "", logoUrl: branding.logoUrl || "",
      stampUrl: branding.stampUrl || "",
      brandLine1: branding.brandLine1 || "", brandLine2: branding.brandLine2 || "",
      brandAccentLength: Number(branding.brandAccentLength) || 0,
      primaryColor: branding.primaryColor || "#c62828",
      secondaryColor: branding.secondaryColor || "#0f172a",
      accentColor: branding.accentColor || "#0369a1",
      fullAddress: branding.fullAddress || "",
      phone: branding.phone || "", altPhone: branding.altPhone || "",
      whatsapp: branding.whatsapp || "", email: branding.email || "",
      website: branding.website || "",
      licenseNumber: branding.licenseNumber || "", gstNumber: branding.gstNumber || "",
      showPoweredBy: branding.showPoweredBy !== false
    }
  };
}

function sanitize(report) {
  const out = {};
  SHARE_FIELDS.forEach((field) => { if (report[field] !== undefined) out[field] = report[field]; });
  // Firestore Timestamps do not survive a plain copy into a nested doc cleanly.
  ["collectionDate", "reportingDate"].forEach((field) => {
    const value = out[field];
    if (value && typeof value.toDate === "function") out[field] = value.toDate().toISOString();
  });
  // report.html renders a flat results[] array (KhunTest schema); write it
  // alongside groups[] so the same shared doc serves both.
  out.results = flatResultsFromGroups(report.groups || out.groups || []);
  return out;
}

/** Payment / bill hints report.html shows on its "link active but…" screens. */
function shareHints(report, booking) {
  return {
    billNo: booking?.billNo || report?.billNo || "",
    paymentStatusHint: String(booking?.paymentStatus || "").toLowerCase(),
    balanceDueHint: Number(booking?.balanceDue || 0)
  };
}

export function shareUrl(token) {
  const base = globalThis.SWATI_ENV?.publicBaseUrl || location.origin;
  // KhunTest's report.html reads the token from ?share= (see getShareToken()).
  return `${base.replace(/\/$/, "")}/report.html?share=${encodeURIComponent(token)}`;
}

/**
 * Create (or reuse) a share link for a released report.
 * @returns {{token, tokenHash, url, reused}}
 */
export async function createShareLink({ report, booking, actor = {}, ttlDays = DEFAULT_TTL_DAYS }) {
  const labId = getLabId();
  if (!labId) throw new Error("No laboratory selected.");
  if (!report?.reportId) throw new Error("This report has not been saved yet.");

  const cachedToken = cacheRead(report.reportId);
  if (cachedToken) {
    const existingHash = await hashTokenHex(cachedToken);
    const existing = await getDoc(doc(db, SHARES, existingHash));
    if (existing.exists() && existing.data().revoked !== true && existing.data().labId === labId) {
      // Refresh the sanitized copy so the patient sees the current results.
      await setDoc(doc(db, RESULTS, existingHash), {
        labId, reportId: report.reportId, ...sanitize(report),
        presentation: await presentationSnapshot(),
        updatedAt: serverTimestamp()
      }, { merge: true });
      await updateDoc(doc(db, SHARES, existingHash), {
        reportStatusHint: report.reportStatus, ...shareHints(report, booking), updatedAt: serverTimestamp()
      });
      return { token: cachedToken, tokenHash: existingHash, url: shareUrl(cachedToken), reused: true };
    }
  }

  const token = generateToken();
  const tokenHash = await hashTokenHex(token);
  const expiresAt = ttlDays > 0 ? new Date(Date.now() + ttlDays * 86400000) : null;

  await setDoc(doc(db, SHARES, tokenHash), {
    labId,
    reportId: report.reportId,
    bookingId: booking?.bookingId || report.bookingId || "",
    patientNameHint: report.patientName || "",
    reportStatusHint: report.reportStatus || "",
    ...shareHints(report, booking),
    enabled: true,
    revoked: false,
    expiresAt,
    accessCount: 0,
    createdByUid: actor.uid || "",
    createdByName: actor.name || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });

  await setDoc(doc(db, RESULTS, tokenHash), {
    labId, reportId: report.reportId, ...sanitize(report),
    presentation: await presentationSnapshot(),
    updatedAt: serverTimestamp()
  });

  cacheWrite(report.reportId, token);
  logAudit(AUDIT.REPORT_SHARED, {
    entityType: "report", entityId: report.reportId,
    summary: `Secure link created for ${report.patientName}`
  });

  return { token, tokenHash, url: shareUrl(token), reused: false };
}

export async function revokeShareLink(reportId, tokenHash) {
  const hash = tokenHash || (cacheRead(reportId) ? await hashTokenHex(cacheRead(reportId)) : "");
  if (!hash) throw new Error("No share link is known for this report on this device.");
  await updateDoc(doc(db, SHARES, hash), { revoked: true, enabled: false, updatedAt: serverTimestamp() });
  logAudit(AUDIT.REPORT_SHARE_REVOKED, {
    entityType: "report", entityId: reportId, summary: "Share link revoked"
  });
}
