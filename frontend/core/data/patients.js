// Patient master.
//
// Patients are tenant-owned (/labs/{labId}/patients). The same person walking
// into two different customer laboratories is two patient records with two
// patient ids - which is correct: neither lab may see the other's history.
import { getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit }
  from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId } from "../tenant.js";
import { safeNextId } from "./ids.js";
import {
  normalizeName, normalizePhone, cleanEmail, buildSearchTokens, clean, toNumber,
  sortByDateDesc, sortByBestTime, pick
} from "./helpers.js";
import { logAudit, AUDIT, diffFields } from "../audit.js";

export function normalizePatient(id, data = {}) {
  return {
    id,
    patientId: pick(data, ["patientId", "patient_id", "uid"], id),
    uid: pick(data, ["uid", "authUid", "userId"], ""),
    name: pick(data, ["name", "patientName", "patient_name", "fullName"], ""),
    phone: pick(data, ["phone", "mobile", "contactNo"], ""),
    altPhone: data.altPhone || "",
    whatsapp: pick(data, ["whatsapp", "phone", "mobile"], ""),
    email: pick(data, ["email", "patientEmail"], ""),
    age: pick(data, ["age", "patientAge"], ""),
    dob: data.dob || "",
    gender: data.gender || "",
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    pincode: data.pincode || "",
    bloodGroup: data.bloodGroup || "",
    referredBy: data.referredBy || "",
    notes: data.notes || "",
    branchId: data.branchId || "",
    totalBookings: toNumber(data.totalBookings),
    totalSpent: toNumber(data.totalSpent),
    lastVisitAt: data.lastVisitAt || null,
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    labId: data.labId || ""
  };
}

function patientPayload(data) {
  const name = normalizeName(data.name);
  const phone = normalizePhone(data.phone);
  const email = cleanEmail(data.email);
  return clean({
    name,
    phone,
    altPhone: normalizePhone(data.altPhone),
    whatsapp: normalizePhone(data.whatsapp || data.phone),
    email,
    age: String(data.age ?? "").trim(),
    dob: data.dob || "",
    gender: data.gender || "",
    address: data.address || "",
    city: data.city || "",
    state: data.state || "",
    pincode: data.pincode || "",
    bloodGroup: data.bloodGroup || "",
    referredBy: data.referredBy || "",
    notes: data.notes || "",
    branchId: data.branchId || "",
    uid: data.uid || "",
    searchTokens: buildSearchTokens(name, phone, email, data.patientId)
  });
}

/** Register a new patient and mint their LAB001-P00001 id. */
export async function createPatient(data) {
  if (!String(data.name || "").trim()) throw new Error("Patient name is required.");
  const phone = normalizePhone(data.phone);
  if (!phone) throw new Error("A valid 10-digit mobile number is required.");

  const patientId = data.patientId || await safeNextId("patient");
  const payload = withLabId({
    ...patientPayload({ ...data, patientId }),
    patientId,
    totalBookings: 0,
    totalSpent: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  await setDoc(docRef("patients", patientId), payload);
  logAudit(AUDIT.PATIENT_CREATED, {
    entityType: "patient", entityId: patientId,
    summary: `Registered ${payload.name} (${payload.phone})`
  });
  return normalizePatient(patientId, payload);
}

export async function getPatient(patientId) {
  const snap = await getDoc(docRef("patients", patientId));
  return snap.exists() ? normalizePatient(snap.id, snap.data()) : null;
}

export async function updatePatient(patientId, patch) {
  const before = await getPatient(patientId);
  const payload = { ...patientPayload({ ...before, ...patch, patientId }), updatedAt: new Date().toISOString() };
  await updateDoc(docRef("patients", patientId), payload);
  logAudit(AUDIT.PATIENT_UPDATED, {
    entityType: "patient", entityId: patientId,
    summary: `Updated ${payload.name}`,
    before: diffFields(before, payload, ["name", "phone", "email", "age", "gender", "address"])
  });
  return { ...before, ...payload };
}

/**
 * Deleting a patient would orphan their bookings and reports, so the default
 * is an archive flag. A hard delete stays available for a genuine data-erasure
 * request and is always audited.
 */
export async function deletePatient(patientId, { hard = false } = {}) {
  const before = await getPatient(patientId);
  if (hard) await deleteDoc(docRef("patients", patientId));
  else await updateDoc(docRef("patients", patientId), { isArchived: true, updatedAt: new Date().toISOString() });
  logAudit(AUDIT.PATIENT_DELETED, {
    entityType: "patient", entityId: patientId,
    summary: `${hard ? "Deleted" : "Archived"} ${before?.name || patientId}`,
    before
  });
}

// No orderBy: legacy patient docs (keyed by auth uid, written by the portal)
// have no `createdAt` and would be dropped from an ordered query.
export async function listPatients({ max = 500 } = {}) {
  const snap = await getDocs(query(col("patients"), limit(Math.max(max * 4, 2000))));
  return sortByBestTime(snap.docs.map((d) => normalizePatient(d.id, d.data()))).slice(0, max);
}

/** Token search first; client-side scan fallback for legacy docs with no tokens. */
export async function searchPatients(text, { max = 50 } = {}) {
  const term = String(text || "").trim().toLowerCase();
  if (!term) return listPatients({ max });
  const tokenSnap = await getDocs(query(
    col("patients"), where("searchTokens", "array-contains", term), limit(max)
  )).catch(() => null);
  if (tokenSnap && !tokenSnap.empty) {
    return tokenSnap.docs.map((d) => normalizePatient(d.id, d.data()));
  }
  const all = await listPatients({ max: 3000 });
  return all.filter((p) => [p.name, p.phone, p.email, p.patientId]
    .some((v) => String(v || "").toLowerCase().includes(term))).slice(0, max);
}

/** Exact phone lookup - the fastest path at a busy reception desk. */
export async function findPatientByPhone(phone) {
  const p = normalizePhone(phone);
  if (!p) return null;
  const snap = await getDocs(query(col("patients"), where("phone", "==", p), limit(1)));
  return snap.empty ? null : normalizePatient(snap.docs[0].id, snap.docs[0].data());
}

export async function findPatientByUid(uid) {
  if (!uid) return null;
  const snap = await getDocs(query(col("patients"), where("uid", "==", uid), limit(1)));
  return snap.empty ? null : normalizePatient(snap.docs[0].id, snap.docs[0].data());
}

/** Register-or-reuse, so repeat walk-ins never create duplicate patient ids. */
export async function upsertPatientByPhone(data) {
  const existing = await findPatientByPhone(data.phone);
  if (existing) {
    const patch = {};
    ["name", "email", "age", "gender", "address", "city", "pincode", "uid", "whatsapp"].forEach((k) => {
      if (data[k] && !existing[k]) patch[k] = data[k];
    });
    if (Object.keys(patch).length) return updatePatient(existing.patientId, patch);
    return existing;
  }
  return createPatient(data);
}

/** Roll up a completed booking onto the patient card. */
export async function recordVisit(patientId, amount) {
  const patient = await getPatient(patientId);
  if (!patient) return;
  await updateDoc(docRef("patients", patientId), {
    totalBookings: toNumber(patient.totalBookings) + 1,
    totalSpent: toNumber(patient.totalSpent) + toNumber(amount),
    lastVisitAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
}

export { sortByDateDesc };
