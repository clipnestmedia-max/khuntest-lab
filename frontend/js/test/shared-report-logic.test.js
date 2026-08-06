const test = require("node:test");
const assert = require("node:assert/strict");

// Node's test runner is CommonJS by default; this file's target is an ES
// module (browser code), so load it dynamically.
async function loadLogic() {
  return import("../shared-report-logic.js");
}

test("isValidTokenFormat accepts a real 256-bit token and rejects malformed input", async () => {
  const { isValidTokenFormat } = await loadLogic();
  assert.equal(isValidTokenFormat("a".repeat(64)), true);
  assert.equal(isValidTokenFormat("a".repeat(31)), false, "below 128-bit minimum");
  assert.equal(isValidTokenFormat("g".repeat(64)), false, "non-hex characters");
  assert.equal(isValidTokenFormat(""), false);
  assert.equal(isValidTokenFormat(null), false);
  assert.equal(isValidTokenFormat(undefined), false);
});

test("hashTokenHex is deterministic and matches an independent SHA-256 implementation", async () => {
  const { hashTokenHex } = await loadLogic();
  const crypto = require("crypto");
  const token = "abc123def456";
  const hash = await hashTokenHex(token);
  const expected = crypto.createHash("sha256").update(token, "utf8").digest("hex");
  assert.equal(hash, expected);
  assert.equal(hash.length, 64);
});

test("shareState: active by default", async () => {
  const { shareState } = await loadLogic();
  assert.equal(shareState({ enabled: true, revoked: false }), "active");
});

test("shareState: revoked flag wins", async () => {
  const { shareState } = await loadLogic();
  assert.equal(shareState({ enabled: true, revoked: true }), "revoked");
});

test("shareState: disabled (enabled:false) reports as revoked", async () => {
  const { shareState } = await loadLogic();
  assert.equal(shareState({ enabled: false, revoked: false }), "revoked");
});

test("shareState: expiresAt in the past reports as expired", async () => {
  const { shareState } = await loadLogic();
  const now = Date.now();
  assert.equal(shareState({ enabled: true, revoked: false, expiresAt: now - 1000 }, now), "expired");
});

test("shareState: expiresAt in the future stays active", async () => {
  const { shareState } = await loadLogic();
  const now = Date.now();
  assert.equal(shareState({ enabled: true, revoked: false, expiresAt: now + 100000 }, now), "active");
});

test("shareState: Firestore Timestamp-shaped expiresAt (toMillis) is handled", async () => {
  const { shareState } = await loadLogic();
  const now = Date.now();
  const pastTimestamp = { toMillis: () => now - 5000 };
  assert.equal(shareState({ enabled: true, revoked: false, expiresAt: pastTimestamp }, now), "expired");
});
