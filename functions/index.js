const express = require("express");
const admin = require("firebase-admin");
const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");

const { handleSharedReportLookup } = require("./lib/shared-report-core");
const { createRateLimiter } = require("./lib/rate-limit");
const { categorizeUserAgent } = require("./lib/user-agent");

admin.initializeApp();
const db = admin.firestore();

const ALLOWED_ORIGINS = new Set([
  "https://khuntest.com",
  "https://www.khuntest.com",
  "https://khuntest-lab-e5966.web.app",
  "https://khuntest-lab-e5966.firebaseapp.com"
]);

const rateLimiter = createRateLimiter({ windowMs: 5 * 60 * 1000, maxHits: 30 });

async function getShareByHash(tokenHash) {
  const snap = await db.collection("reportShares").doc(tokenHash).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function getReport(reportId) {
  const snap = await db.collection("reports").doc(reportId).get();
  return snap.exists ? snap.data() : null;
}

async function getBooking(bookingId) {
  const snap = await db.collection("bookings").doc(bookingId).get();
  return snap.exists ? snap.data() : null;
}

async function recordAccess({ shareId, reportId, state, userAgent }) {
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp();
  const tasks = [
    db.collection("reportShares").doc(shareId).update({
      accessCount: admin.firestore.FieldValue.increment(1),
      lastAccessedAt: serverTimestamp
    }),
    db.collection("reportShareAccess").add({
      shareId,
      reportId: reportId || null,
      accessedAt: serverTimestamp,
      result: state,
      uaCategory: categorizeUserAgent(userAgent)
    })
  ];
  // Access logging must never break the actual report response.
  await Promise.allSettled(tasks);
}

const app = express();

app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

app.get("/api/shared-report/:token", async (req, res) => {
  const clientIp = req.ip || req.get("x-forwarded-for") || "unknown";
  if (!rateLimiter.check(clientIp)) {
    logger.warn("shared-report rate limit hit", { clientIp });
    return res.status(429).json({ success: false, state: "rate_limited", message: "Too many requests. Please try again shortly." });
  }

  const { token } = req.params;
  try {
    const result = await handleSharedReportLookup(token, { getShareByHash, getReport, getBooking, now: () => Date.now() });

    // Never log the raw token - only the derived share/report identifiers.
    logger.info("shared-report access", { shareId: result.shareId || null, reportId: result.reportId || null, state: result.body.state });

    if (result.shareId) {
      await recordAccess({ shareId: result.shareId, reportId: result.reportId, state: result.body.state, userAgent: req.get("user-agent") });
    }

    res.status(result.httpStatus).json(result.body);
  } catch (err) {
    logger.error("shared-report lookup failed", { message: err.message });
    res.status(500).json({ success: false, state: "error", message: "Unable to load report right now. Please try again shortly." });
  }
});

app.use((req, res) => {
  res.status(404).json({ success: false, state: "invalid_link", message: "This report link is invalid." });
});

exports.getSharedReport = onRequest({ region: "us-central1", cors: false, maxInstances: 20 }, app);
