// Home collection workflow (spec section 16).
//
// The status list is a fixed, ordered pipeline so a laboratory owner can see
// at a glance where every sample is. Statuses only move forward except for an
// explicit Cancelled, which any admin may set.
import {
  getDocs, getDoc, setDoc, updateDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId } from "../tenant.js";
import { safeNextId } from "./ids.js";
import { clean, normalizeName, normalizePhone, dateKey, buildSearchTokens, toNumber } from "./helpers.js";
import { logAudit, AUDIT } from "../audit.js";

export const HC_STATUS = Object.freeze([
  "Requested", "Assigned", "On the Way", "Sample Collected",
  "Reached Lab", "Processing", "Report Ready"
]);

export const HC_CANCELLED = "Cancelled";

export function nextStatuses(current) {
  const i = HC_STATUS.indexOf(current);
  if (i < 0) return [HC_STATUS[0], HC_CANCELLED];
  return [...HC_STATUS.slice(i + 1), HC_CANCELLED];
}

export function statusProgress(status) {
  const i = HC_STATUS.indexOf(status);
  return i < 0 ? 0 : Math.round(((i + 1) / HC_STATUS.length) * 100);
}

export function normalizeHomeCollection(id, data = {}) {
  return {
    id,
    requestId: data.requestId || id,
    bookingId: data.bookingId || "",
    patientId: data.patientId || "",
    patientUid: data.patientUid || "",
    patientName: data.patientName || "",
    phone: data.phone || "",
    address: data.address || "",
    city: data.city || "",
    pincode: data.pincode || "",
    landmark: data.landmark || "",
    scheduledAt: data.scheduledAt || "",
    slot: data.slot || "",
    tests: Array.isArray(data.tests) ? data.tests : [],
    charge: toNumber(data.charge),
    status: data.status || "Requested",
    assignedToUid: data.assignedToUid || "",
    assignedToName: data.assignedToName || "",
    assignedToPhone: data.assignedToPhone || "",
    branchId: data.branchId || "",
    notes: data.notes || "",
    history: Array.isArray(data.history) ? data.history : [],
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    labId: data.labId || ""
  };
}

export async function createHomeCollection(input, { actor = {} } = {}) {
  const requestId = input.requestId || await safeNextId("homeCollection");
  const name = normalizeName(input.patientName);
  const payload = withLabId(clean({
    requestId,
    bookingId: input.bookingId || "",
    patientId: input.patientId || "",
    patientUid: input.patientUid || "",
    patientName: name,
    phone: normalizePhone(input.phone),
    address: input.address || "",
    city: input.city || "",
    pincode: input.pincode || "",
    landmark: input.landmark || "",
    scheduledAt: input.scheduledAt || "",
    slot: input.slot || "",
    tests: Array.isArray(input.tests) ? input.tests : [],
    charge: toNumber(input.charge),
    status: "Requested",
    branchId: input.branchId || "",
    notes: input.notes || "",
    history: [{ status: "Requested", at: new Date().toISOString(), by: actor.name || "patient" }],
    dayKey: dateKey(input.scheduledAt || new Date()),
    searchTokens: buildSearchTokens(name, input.phone, requestId, input.pincode),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));
  await setDoc(docRef("homeCollections", requestId), payload);
  return normalizeHomeCollection(requestId, payload);
}

/** Assign a collection executive and move the request to Assigned. */
export async function assignExecutive(requestId, executive, { actor = {} } = {}) {
  const before = await getHomeCollection(requestId);
  const entry = {
    status: "Assigned", at: new Date().toISOString(),
    by: actor.name || "", note: `Assigned to ${executive.name || ""}`
  };
  await updateDoc(docRef("homeCollections", requestId), {
    assignedToUid: executive.uid || "",
    assignedToName: executive.name || "",
    assignedToPhone: normalizePhone(executive.phone),
    status: before?.status === "Requested" ? "Assigned" : before?.status,
    history: [...(before?.history || []), entry],
    updatedAt: serverTimestamp()
  });
  logAudit(AUDIT.HOMECOLLECTION_ASSIGNED, {
    entityType: "homeCollection", entityId: requestId,
    summary: `Assigned to ${executive.name || executive.uid}`
  });
}

export async function setHomeCollectionStatus(requestId, status, { actor = {}, note = "" } = {}) {
  const before = await getHomeCollection(requestId);
  const entry = { status, at: new Date().toISOString(), by: actor.name || "", note };
  await updateDoc(docRef("homeCollections", requestId), {
    status,
    history: [...(before?.history || []), entry],
    updatedAt: serverTimestamp()
  });
  logAudit(AUDIT.HOMECOLLECTION_STATUS, {
    entityType: "homeCollection", entityId: requestId,
    summary: `${before?.status || "?"} -> ${status}`
  });
}

export async function getHomeCollection(requestId) {
  const snap = await getDoc(docRef("homeCollections", requestId));
  return snap.exists() ? normalizeHomeCollection(snap.id, snap.data()) : null;
}

export async function listHomeCollections({ status = "", assignedToUid = "", max = 300 } = {}) {
  const clauses = [col("homeCollections")];
  if (status) clauses.push(where("status", "==", status));
  if (assignedToUid) clauses.push(where("assignedToUid", "==", assignedToUid));
  clauses.push(orderBy("scheduledAt", "asc"), limit(max));
  const snap = await getDocs(query(...clauses));
  return snap.docs.map((d) => normalizeHomeCollection(d.id, d.data()));
}

export function listenHomeCollections(callback, onError) {
  return onSnapshot(
    query(col("homeCollections"), orderBy("createdAt", "desc"), limit(200)),
    (snap) => callback(snap.docs.map((d) => normalizeHomeCollection(d.id, d.data()))),
    onError
  );
}

/** Count by status for the dashboard pipeline strip. */
export function pipelineCounts(rows) {
  const counts = Object.fromEntries(HC_STATUS.map((s) => [s, 0]));
  counts[HC_CANCELLED] = 0;
  rows.forEach((r) => { if (counts[r.status] !== undefined) counts[r.status] += 1; });
  return counts;
}
