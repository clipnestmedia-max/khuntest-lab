// Laboratory staff directory.
//
// A staff member is TWO documents: /labs/{labId}/staff/{uid} holds the HR
// detail the lab manages, and /userIndex/{uid} holds the one line the security
// rules read (labId + role + isActive). They are written together so a
// deactivated employee loses access immediately, not at next login.
import { getDocs, getDoc, setDoc, updateDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../firebase-config.js";
import { doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId, getLabId } from "../tenant.js";
import { clean, normalizeName, normalizePhone, cleanEmail } from "./helpers.js";
import { ROLES, roleLabel, isStaffRole } from "../roles.js";
import { logAudit, AUDIT } from "../audit.js";

export function normalizeStaff(id, data = {}) {
  return {
    id,
    uid: data.uid || id,
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    role: data.role || "",
    roleLabel: roleLabel(data.role),
    employeeId: data.employeeId || "",
    designation: data.designation || "",
    qualification: data.qualification || "",
    registrationNumber: data.registrationNumber || "",
    signatureUrl: data.signatureUrl || "",
    branchId: data.branchId || "",
    isActive: data.isActive !== false,
    canSignReports: data.canSignReports === true,
    createdAt: data.createdAt || null,
    labId: data.labId || ""
  };
}

/**
 * Save the laboratory-side staff record. The auth user itself is created by
 * Super Admin onboarding (or by the lab admin through the backend endpoint),
 * because minting a Firebase Auth user requires the Admin SDK.
 */
export async function saveStaff(uid, data, { actor = {} } = {}) {
  if (!uid) throw new Error("A staff record needs the user's uid.");
  if (!isStaffRole(data.role)) throw new Error(`"${data.role}" is not a valid staff role.`);

  const payload = withLabId(clean({
    uid,
    name: normalizeName(data.name),
    email: cleanEmail(data.email),
    phone: normalizePhone(data.phone),
    role: data.role,
    employeeId: data.employeeId || "",
    designation: data.designation || roleLabel(data.role),
    qualification: data.qualification || "",
    registrationNumber: data.registrationNumber || "",
    signatureUrl: data.signatureUrl || "",
    branchId: data.branchId || "",
    isActive: data.isActive !== false,
    canSignReports: data.canSignReports === true,
    updatedAt: serverTimestamp(),
    createdAt: data.createdAt || serverTimestamp()
  }));

  await setDoc(docRef("staff", uid), payload, { merge: true });

  // Keep the rules-facing index in step. A lab admin may only flip isActive
  // here; role and labId changes are rejected by firestore.rules unless the
  // caller is Super Admin.
  await setDoc(doc(db, "userIndex", uid), {
    labId: getLabId(), role: data.role, isActive: data.isActive !== false,
    name: payload.name, email: payload.email, branchId: payload.branchId
  }, { merge: true }).catch((err) => {
    console.warn("userIndex sync needs Super Admin for role/lab changes:", err?.message);
  });

  logAudit(AUDIT.STAFF_CREATED, {
    entityType: "staff", entityId: uid,
    summary: `${payload.name} as ${roleLabel(data.role)}`
  });
  return normalizeStaff(uid, payload);
}

export async function setStaffActive(uid, isActive, { actor = {} } = {}) {
  await updateDoc(docRef("staff", uid), { isActive: Boolean(isActive), updatedAt: serverTimestamp() });
  await setDoc(doc(db, "userIndex", uid), { isActive: Boolean(isActive) }, { merge: true }).catch(() => {});
  logAudit(isActive ? AUDIT.STAFF_UPDATED : AUDIT.STAFF_REMOVED, {
    entityType: "staff", entityId: uid,
    summary: `${isActive ? "Activated" : "Deactivated"} staff ${uid}`
  });
}

export async function getStaff(uid) {
  const snap = await getDoc(docRef("staff", uid));
  return snap.exists() ? normalizeStaff(snap.id, snap.data()) : null;
}

export async function listStaff({ activeOnly = false, role = "" } = {}) {
  const snap = await getDocs(col("staff"));
  let rows = snap.docs.map((d) => normalizeStaff(d.id, d.data()));
  if (activeOnly) rows = rows.filter((r) => r.isActive);
  if (role) rows = rows.filter((r) => r.role === role);
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** People who may appear as the signing pathologist on a report. */
export async function listSignatories() {
  const rows = await listStaff({ activeOnly: true });
  return rows.filter((r) => r.canSignReports || r.role === ROLES.PATHOLOGIST);
}

export async function listCollectionExecutives() {
  return listStaff({ activeOnly: true, role: ROLES.COLLECTION_EXEC });
}
