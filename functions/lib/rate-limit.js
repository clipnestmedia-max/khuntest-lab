// Best-effort per-instance rate limiter. Cloud Functions scale out across
// many instances and this state resets on cold start, so it is defense in
// depth (stops a hot instance being hammered), not a hard guarantee - a
// managed rate limiter (Cloud Armor, App Check) is the real backstop.
function createRateLimiter({ windowMs = 5 * 60 * 1000, maxHits = 30 } = {}) {
  const hits = new Map();

  function prune(now) {
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((t) => now - t < windowMs);
      if (kept.length) hits.set(key, kept);
      else hits.delete(key);
    }
  }

  return {
    check(key, now = Date.now()) {
      if (hits.size > 5000) prune(now);
      const timestamps = (hits.get(key) || []).filter((t) => now - t < windowMs);
      timestamps.push(now);
      hits.set(key, timestamps);
      return timestamps.length <= maxHits;
    }
  };
}

module.exports = { createRateLimiter };
