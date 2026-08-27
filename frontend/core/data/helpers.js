// Shared normalisation, caching and formatting helpers for the data layer.
// The caching/dedupe design is carried over from the KhunTest original
// (frontend/firebase-service.js) because it is proven under real load; only
// the cache keys are now namespaced per laboratory so two labs open in two
// browser tabs can never read each other's cached rows.
import { getLabId } from "../tenant.js";

const memoryCache = new Map();
const inFlight = new Map();

export const CACHE_TTL = Object.freeze({
  tests: 10 * 60 * 1000,
  testSummaries: 10 * 60 * 1000,
  branding: 15 * 60 * 1000,
  patientBookings: 60 * 1000,
  onlineBookings: 45 * 1000,
  analytics: 5 * 60 * 1000
});

function scopedKey(key) { return `swati:${getLabId() || "nolab"}:${key}`; }

export function cacheRead(key) {
  const k = scopedKey(key);
  const now = Date.now();
  const hit = memoryCache.get(k);
  if (hit?.expiresAt > now) return hit.value;
  if (hit) memoryCache.delete(k);
  try {
    const saved = JSON.parse(localStorage.getItem(k) || "null");
    if (saved?.expiresAt > now) { memoryCache.set(k, saved); return saved.value; }
    if (saved) localStorage.removeItem(k);
  } catch { /* storage unavailable or corrupt */ }
  return null;
}

export function cacheWrite(key, value, ttlMs) {
  const k = scopedKey(key);
  const entry = { value, expiresAt: Date.now() + ttlMs };
  memoryCache.set(k, entry);
  try { localStorage.setItem(k, JSON.stringify(entry)); } catch { /* quota */ }
  return value;
}

export function cacheDrop(key) {
  const k = scopedKey(key);
  memoryCache.delete(k);
  try { localStorage.removeItem(k); } catch { /* ignore */ }
}

/** Drop every cached row for the active laboratory (used on logout / lab switch). */
export function cacheDropAll() {
  const prefix = `swati:${getLabId() || "nolab"}:`;
  Array.from(memoryCache.keys()).forEach((k) => { if (k.startsWith(prefix)) memoryCache.delete(k); });
  try {
    Object.keys(localStorage).forEach((k) => { if (k.startsWith(prefix)) localStorage.removeItem(k); });
  } catch { /* ignore */ }
}

/** Collapse concurrent identical loads into one network round trip. */
export function dedupe(key, loader) {
  const k = scopedKey(key);
  if (inFlight.has(k)) return inFlight.get(k);
  const promise = Promise.resolve().then(loader).finally(() => inFlight.delete(k));
  inFlight.set(k, promise);
  return promise;
}

/** Read-through cache with background revalidation. */
export async function cached(key, ttlMs, loader) {
  const hit = cacheRead(key);
  if (hit !== null) {
    dedupe(`revalidate:${key}`, async () => cacheWrite(key, await loader(), ttlMs)).catch(() => {});
    return hit;
  }
  return dedupe(key, async () => cacheWrite(key, await loader(), ttlMs));
}

// ---------- value normalisation ----------
//
// These live in core/format.js, which has no imports, so the report templates
// and the flagging logic can use them without initialising Firebase. Re-exported
// here so every existing caller keeps working unchanged.
export {
  cleanEmail, digits, normalizePhone, normalizeName, titleCase, toNumber, rupees,
  toDate, toMillis, dateKey, formatDate, formatDateTime, clean, chunk,
  sortByDateDesc, buildSearchTokens, esc
} from "../format.js";

export function normalizeDoc(snapshot) {
  return { id: snapshot.id, ...snapshot.data() };
}

export function snapshotRows(snapshot) {
  return snapshot.docs.map(normalizeDoc);
}
