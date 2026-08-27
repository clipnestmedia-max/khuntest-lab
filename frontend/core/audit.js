// Audit trail.
//
// Append-only by rule (database/firestore.rules forbids update and delete on
// auditLogs), so a laboratory owner can trust the history even against their
// own staff. Writes must never break the action they are recording, so every
// failure is swallowed after being logged to the console.
import { addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, getLabId, withLabId } from "./tenant.js";
import { currentSession } from "./session.js";

export const AUDIT = Object.freeze({
  LOGIN: "user.login",
  LOGOUT: "user.logout",
  PATIENT_CREATED: "patient.created",
  PATIENT_UPDATED: "patient.updated",
  PATIENT_DELETED: "patient.deleted",
  BOOKING_CREATED: "booking.created",
  BOOKING_UPDATED: "booking.updated",
  BOOKING_DELETED: "booking.deleted",
  RESULT_ENTERED: "report.result_entered",
  REPORT_SAVED: "report.saved",
  REPORT_APPROVED: "report.approved",
  REPORT_REVERTED: "report.reverted",
  REPORT_SHARED: "report.shared",
  REPORT_SHARE_REVOKED: "report.share_revoked",
  PAYMENT_RECEIVED: "payment.received",
  PAYMENT_EDITED: "payment.edited",
  STAFF_CREATED: "staff.created",
  STAFF_UPDATED: "staff.updated",
  STAFF_REMOVED: "staff.removed",
  TEST_UPDATED: "test.updated",
  TEST_PRICE_CHANGED: "test.price_changed",
  SETTINGS_UPDATED: "settings.updated",
  BRANDING_UPDATED: "branding.updated",
  HOMECOLLECTION_ASSIGNED: "homecollection.assigned",
  HOMECOLLECTION_STATUS: "homecollection.status_changed",
  EXPENSE_ADDED: "expense.added"
});

/** Best-effort device fingerprint. Real client IP is only visible server-side. */
function deviceInfo() {
  try {
    const ua = navigator.userAgent || "";
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    return {
      device: mobile ? "Mobile" : "Desktop",
      platform: navigator.platform || "",
      userAgent: ua.slice(0, 300)
    };
  } catch {
    return { device: "Unknown", platform: "", userAgent: "" };
  }
}

/**
 * Record an action. Returns true on success, false if it could not be
 * written - callers should not branch on the result, only actions do.
 */
export async function logAudit(action, details = {}) {
  const labId = getLabId();
  if (!labId) return false;
  const session = currentSession();
  try {
    await addDoc(col("auditLogs"), withLabId({
      action,
      actorUid: session?.uid || "",
      actorName: session?.name || session?.email || "system",
      actorEmail: session?.email || "",
      actorRole: session?.role || "",
      branchId: session?.branchId || "",
      entityType: details.entityType || "",
      entityId: details.entityId || "",
      summary: details.summary || "",
      before: details.before ?? null,
      after: details.after ?? null,
      ...deviceInfo(),
      at: serverTimestamp(),
      atLocal: new Date().toISOString()
    }));
    return true;
  } catch (err) {
    console.error("Audit write failed:", action, err);
    return false;
  }
}

/** Diff two plain objects into a compact {field: [before, after]} map. */
export function diffFields(before = {}, after = {}, fields = null) {
  const keys = fields || Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
  const changes = {};
  keys.forEach((key) => {
    const a = before?.[key];
    const b = after?.[key];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) changes[key] = [a ?? null, b ?? null];
  });
  return changes;
}
