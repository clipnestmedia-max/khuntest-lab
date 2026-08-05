const { isValidTokenFormat, hashToken, isReportReleased, isReportPaymentCleared, paymentSummary, isShareUsable } = require("./gating");
const { sanitizeReport } = require("./sanitize");

const MESSAGES = {
  invalid_link: "This report link is invalid.",
  revoked: "This report link is no longer active.",
  expired: "This report link has expired. Please contact KhunTest Lab.",
  not_released: "Your report is still under review.",
  payment_pending: "Your payment is pending. Please clear your payment to view and download the report."
};

const STATUS_CODE = {
  invalid_link: 404,
  revoked: 410,
  expired: 410,
  not_released: 403,
  payment_pending: 402
};

function fail(state, extra = {}) {
  return {
    httpStatus: STATUS_CODE[state] || 400,
    body: { success: false, state, message: MESSAGES[state], ...extra },
    auditState: state
  };
}

/**
 * Pure orchestration for the shared-report lookup, independent of Firestore
 * so the branching in spec section 8/22 (TEST A-G) can run as fast unit
 * tests. `deps` supplies the actual data access in production (functions/index.js)
 * or fakes in tests (functions/test/*.test.js).
 *
 * deps:
 *   getShareByHash(tokenHash) -> share doc data + id, or null
 *   getReport(reportId) -> report doc data, or null
 *   getBooking(bookingId) -> booking doc data, or null
 *   now() -> ms timestamp
 */
async function handleSharedReportLookup(rawToken, deps) {
  const now = deps.now ? deps.now() : Date.now();

  if (!isValidTokenFormat(rawToken)) {
    return fail("invalid_link");
  }

  const tokenHash = hashToken(rawToken);
  const share = await deps.getShareByHash(tokenHash);
  if (!share) {
    return fail("invalid_link");
  }

  const usable = isShareUsable(share, now);
  if (!usable.ok) {
    return { ...fail(usable.reason, { billNo: share.billNo }), shareId: share.id, reportId: share.reportId };
  }

  const report = share.reportId ? await deps.getReport(share.reportId) : null;
  if (!report) {
    return { ...fail("invalid_link"), shareId: share.id, reportId: share.reportId };
  }

  if (!isReportReleased(report)) {
    return { ...fail("not_released", { billNo: share.billNo }), shareId: share.id, reportId: share.reportId };
  }

  const booking = share.bookingId ? await deps.getBooking(share.bookingId) : null;

  if (!isReportPaymentCleared({ booking, report })) {
    const payment = paymentSummary({ booking, report });
    return {
      ...fail("payment_pending", { billNo: share.billNo, payment: { status: payment.status.toLowerCase() || "pending", balanceDue: payment.balanceDue } }),
      shareId: share.id,
      reportId: share.reportId
    };
  }

  return {
    httpStatus: 200,
    body: { success: true, state: "available", report: sanitizeReport(report) },
    auditState: "available",
    shareId: share.id,
    reportId: share.reportId
  };
}

module.exports = { handleSharedReportLookup, MESSAGES, STATUS_CODE };
