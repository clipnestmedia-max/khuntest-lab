// Tenant resolution and path isolation — NEUTRALISED for the single-tenant
// KhunTest deployment.
//
// The platform stores every document under /labs/{labId}/… and reaches it
// through col() / docRef(). This app is one laboratory on one Firebase
// project, and the rest of the KhunTest frontend (patient portal, public
// booking, report.html) reads flat top-level collections. So here col("x")
// resolves to collection(db, "x") and withLabId() is a no-op — the ported
// admin screens then read and write exactly the same documents the rest of
// the app does. The full export surface of the original module is kept so
// core/data/* and the admin screens import unchanged.
import { db } from "./firebase-config.js";
import { collection, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const LAB_ID = "khuntest";

// Kept for anything that imports them; not enforced any more.
export const TENANT_COLLECTIONS = Object.freeze([
  "patients", "bookings", "onlineBookings", "bookingTests", "reports",
  "reportResults", "tests", "testParameters", "packages", "bills",
  "payments", "expenses", "homeCollections", "staff", "labAttendants",
  "branches", "auditLogs", "notifications", "machineResults", "counters",
  "settings", "reportTemplates", "bookingAuditTrail", "billAuditTrail"
]);

export const PLATFORM_COLLECTIONS = Object.freeze([
  "labs", "userIndex", "superAdmins", "platform", "publicLabs",
  "reportShares", "reportShareResults", "reportShareAccess", "billAccess",
  "subscriptionEvents", "platformAuditLogs"
]);

export function normalizeLabId(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

export function resolveLabId() { return LAB_ID; }
export function setLabId() { return LAB_ID; }
export function getLabId() { return LAB_ID; }
export function getLabIdSource() { return "single-tenant"; }
export function hasLab() { return true; }
export function requireLabId() { return LAB_ID; }
export function labPath() { return ""; }

/** Flat collection reference: col("bookings") -> collection(db, "bookings"). */
export function col(name) {
  return collection(db, name);
}

/** Flat document reference. */
export function docRef(name, id) {
  if (!id) throw new Error(`docRef("${name}") called without a document id.`);
  return doc(db, name, id);
}

/** Settings live in a flat /settings/{key} collection. */
export function settingsDoc(key) {
  return doc(db, "settings", key);
}

/** No lab registry in single-tenant mode; return a harmless placeholder ref. */
export function labDoc() {
  return doc(db, "settings", "labProfile");
}

/** Platform-level collection — same as flat here. */
export function platformCol(name) {
  return collection(db, name);
}

export function platformDoc(name, id) {
  return doc(db, name, id);
}

/** No-op: documents are not stamped with a labId in single-tenant mode. */
export function withLabId(data) {
  return data;
}
