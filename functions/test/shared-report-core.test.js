const test = require("node:test");
const assert = require("node:assert/strict");
const { handleSharedReportLookup } = require("../lib/shared-report-core");
const { hashToken } = require("../lib/gating");

const VALID_TOKEN = "a".repeat(64);
const OTHER_TOKEN = "b".repeat(64);

function makeDeps({ shares = {}, reports = {}, bookings = {}, now = Date.now() } = {}) {
  return {
    now: () => now,
    getShareByHash: async (hash) => shares[hash] || null,
    getReport: async (id) => reports[id] || null,
    getBooking: async (id) => bookings[id] || null
  };
}

test("TEST D - invalid token format is rejected without any lookup", async () => {
  const deps = makeDeps();
  const result = await handleSharedReportLookup("not-hex", deps);
  assert.equal(result.body.state, "invalid_link");
  assert.equal(result.httpStatus, 404);
  assert.equal(result.body.report, undefined);
});

test("TEST D - well-formed but unknown token returns invalid_link, not a 'not found' distinction", async () => {
  const deps = makeDeps({ shares: {} });
  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.body.state, "invalid_link");
});

test("TEST G - token manipulation does not expose another report", async () => {
  const hashA = hashToken(VALID_TOKEN);
  const hashB = hashToken(OTHER_TOKEN);
  const deps = makeDeps({
    shares: {
      [hashA]: { id: hashA, reportId: "rpt-A", bookingId: "bk-A", enabled: true, revoked: false }
    },
    reports: {
      "rpt-A": { billNo: "A1", status: "Final", results: [{ testName: "X" }] }
    },
    bookings: { "bk-A": { paymentStatus: "Paid", balanceDue: 0 } }
  });
  const resultForA = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(resultForA.body.state, "available");
  assert.equal(resultForA.body.report.billNo, "A1");

  const resultForB = await handleSharedReportLookup(OTHER_TOKEN, deps);
  assert.equal(resultForB.body.state, "invalid_link");
  assert.equal(resultForB.body.report, undefined);
});

test("TEST A - paid + released report is returned, sanitized", async () => {
  const hash = hashToken(VALID_TOKEN);
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-1", bookingId: "bk-1", enabled: true, revoked: false } },
    reports: {
      "rpt-1": {
        billNo: "583240",
        status: "Final",
        patientUid: "secret-uid",
        patientEmail: "patient@example.com",
        bookingId: "internal-booking-id",
        results: [{ testName: "CBC", resultValue: "5" }]
      }
    },
    bookings: { "bk-1": { paymentStatus: "Paid", balanceDue: 0 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.state, "available");
  assert.equal(result.body.report.billNo, "583240");
  assert.equal(result.body.report.patientUid, undefined, "must not leak Firebase UID");
  assert.equal(result.body.report.patientEmail, undefined, "must not leak patient email");
  assert.equal(result.body.report.bookingId, undefined, "must not leak internal booking id");
});

test("TEST B - unpaid report returns payment_pending and never leaks results", async () => {
  const hash = hashToken(VALID_TOKEN);
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-2", bookingId: "bk-2", billNo: "1", enabled: true, revoked: false } },
    reports: { "rpt-2": { billNo: "1", status: "Final", results: [{ testName: "Secret result" }] } },
    bookings: { "bk-2": { paymentStatus: "Pending", balanceDue: 500 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.httpStatus, 402);
  assert.equal(result.body.state, "payment_pending");
  assert.equal(result.body.report, undefined);
  assert.equal(result.body.payment.balanceDue, 500);
  assert.equal(result.body.billNo, "1", "billNo must be present so the pending screen can display it");
});

test("TEST C - same link opens report automatically once payment flips to Paid", async () => {
  const hash = hashToken(VALID_TOKEN);
  const booking = { paymentStatus: "Pending", balanceDue: 500 };
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-3", bookingId: "bk-3", enabled: true, revoked: false } },
    reports: { "rpt-3": { billNo: "3", status: "Final", results: [{ testName: "X" }] } },
    bookings: { "bk-3": booking }
  });

  const before = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(before.body.state, "payment_pending");

  booking.paymentStatus = "Paid";
  booking.balanceDue = 0;

  const after = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(after.body.state, "available");
});

test("TEST F - draft report stays blocked even when paid", async () => {
  const hash = hashToken(VALID_TOKEN);
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-4", bookingId: "bk-4", enabled: true, revoked: false } },
    reports: { "rpt-4": { billNo: "4", status: "Draft", results: [{ testName: "Secret" }] } },
    bookings: { "bk-4": { paymentStatus: "Paid", balanceDue: 0 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.httpStatus, 403);
  assert.equal(result.body.state, "not_released");
  assert.equal(result.body.report, undefined);
});

test("explicit Paid status unlocks the report even with a stale nonzero balanceDue", async () => {
  const hash = hashToken(VALID_TOKEN);
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-7", bookingId: "bk-7", enabled: true, revoked: false } },
    reports: { "rpt-7": { billNo: "7", status: "Final", results: [{ testName: "X" }] } },
    // Admin marked the booking Paid but an old balanceDue was never re-zeroed.
    bookings: { "bk-7": { paymentStatus: "Paid", balanceDue: 500 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.body.state, "available");
});

test("TEST E - revoked token blocks access", async () => {
  const hash = hashToken(VALID_TOKEN);
  const deps = makeDeps({
    shares: { [hash]: { id: hash, reportId: "rpt-5", bookingId: "bk-5", enabled: true, revoked: true } },
    reports: { "rpt-5": { billNo: "5", status: "Final" } },
    bookings: { "bk-5": { paymentStatus: "Paid", balanceDue: 0 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.httpStatus, 410);
  assert.equal(result.body.state, "revoked");
  assert.equal(result.body.report, undefined);
});

test("expired token blocks access", async () => {
  const hash = hashToken(VALID_TOKEN);
  const now = Date.now();
  const deps = makeDeps({
    now,
    shares: { [hash]: { id: hash, reportId: "rpt-6", bookingId: "bk-6", enabled: true, revoked: false, expiresAt: { toMillis: () => now - 1000 } } },
    reports: { "rpt-6": { billNo: "6", status: "Final" } },
    bookings: { "bk-6": { paymentStatus: "Paid", balanceDue: 0 } }
  });

  const result = await handleSharedReportLookup(VALID_TOKEN, deps);
  assert.equal(result.body.state, "expired");
});
