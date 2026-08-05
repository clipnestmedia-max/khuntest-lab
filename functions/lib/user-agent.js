// Coarse category only - never store the full user-agent string alongside
// share access records (spec: no excessive device fingerprinting).
function categorizeUserAgent(userAgent) {
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return "unknown";
  if (ua.includes("whatsapp")) return "whatsapp";
  if (/bot|crawler|spider|curl|python-requests|headlesschrome/.test(ua)) return "bot";
  if (/iphone|ipad|android|mobile/.test(ua)) return "mobile";
  return "desktop";
}

module.exports = { categorizeUserAgent };
