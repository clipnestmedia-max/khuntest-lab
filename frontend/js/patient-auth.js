import { auth, db, loginUser, logoutUser, registerPatient as registerFirebasePatient, resetPatientPasswordByIdentifier } from "../firebase-service.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, getDocs, collection, query, where, limit, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export const PATIENT_TOKEN_KEY = "khuntestPatientToken";
export const PATIENT_DATA_KEY = "khuntestPatient";

const LEGACY_TOKEN_KEYS = ["patientToken", "authToken", "token", "auth_token"];
const LEGACY_DATA_KEYS = ["patientUser", "currentPatient", "auth_user"];

export function normalizeIndianPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function normalizePatientIdentifier(value) {
  const cleaned = String(value || "").trim();
  const digits = cleaned.replace(/\D/g, "");
  if (/^\+?91[\s-]?\d{10}$/.test(cleaned.replace(/\s|-/g, ""))) return digits.slice(-10);
  if (/^\d{10}$/.test(digits)) return digits;
  return cleaned.toLowerCase();
}

export function normalizePatient(raw = {}) {
  const patient = {
    id: raw.id || raw.patientId || raw.patient_id || raw._id || raw.uid || "",
    uid: raw.uid || raw.authUid || raw.firebaseUid || raw.id || "",
    name: raw.name || raw.fullName || raw.patientName || raw.patient_name || "",
    phone: raw.phone || raw.mobile || raw.phoneNumber || raw.whatsapp || "",
    email: raw.email || raw.patientEmail || "",
    address: raw.address || "",
    age: raw.age || raw.patientAge || "",
    gender: raw.gender || raw.patientGender || "",
    dateOfBirth: raw.dateOfBirth || raw.dob || "",
    role: raw.role || "patient",
    isActive: raw.isActive !== false
  };
  patient.normalizedPhone = raw.normalizedPhone || normalizeIndianPhone(patient.phone);
  return patient;
}

function readJson(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_err) { return null; }
}

export function getPatientToken() {
  const current = localStorage.getItem(PATIENT_TOKEN_KEY);
  if (current) return current;
  for (const key of LEGACY_TOKEN_KEYS) {
    const value = localStorage.getItem(key);
    if (value) {
      localStorage.setItem(PATIENT_TOKEN_KEY, value);
      return value;
    }
  }
  return "";
}

export function getCurrentPatient() {
  const current = readJson(PATIENT_DATA_KEY);
  if (current?.role === "patient") return normalizePatient(current);
  for (const key of LEGACY_DATA_KEYS) {
    const value = readJson(key);
    if (value?.role === "patient") {
      const patient = normalizePatient(value);
      localStorage.setItem(PATIENT_DATA_KEY, JSON.stringify(patient));
      return patient;
    }
  }
  return null;
}

export function getPatientSession() {
  return { token: getPatientToken(), patient: getCurrentPatient() };
}

export function isPatientLoggedIn() {
  const patient = getCurrentPatient();
  return Boolean(patient && patient.role === "patient" && patient.isActive !== false);
}

export function savePatientSession(token, patient) {
  const normalized = normalizePatient(patient);
  if (normalized.role !== "patient" || normalized.isActive === false) throw new Error("This account is not a patient account.");
  if (token) {
    localStorage.setItem(PATIENT_TOKEN_KEY, token);
    localStorage.setItem("patientToken", token);
    localStorage.setItem("authToken", token);
  }
  localStorage.setItem(PATIENT_DATA_KEY, JSON.stringify(normalized));
  localStorage.setItem("patientUser", JSON.stringify(normalized));
  localStorage.setItem("auth_user", JSON.stringify(normalized));
  return normalized;
}

export function clearPatientSession() {
  [PATIENT_TOKEN_KEY, PATIENT_DATA_KEY, ...LEGACY_TOKEN_KEYS, ...LEGACY_DATA_KEYS].forEach((key) => localStorage.removeItem(key));
}

function waitForAuthUser() {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      resolve(user);
    });
  });
}

async function readProfileByUid(uid) {
  const userSnap = await getDoc(doc(db, "users", uid)).catch(() => null);
  if (userSnap?.exists()) return { id: userSnap.id, ...userSnap.data() };
  const patientSnap = await getDoc(doc(db, "patients", uid)).catch(() => null);
  if (patientSnap?.exists()) return { id: patientSnap.id, ...patientSnap.data() };
  return null;
}

async function findUniquePatientProfile(user) {
  const email = String(user?.email || "").trim().toLowerCase();
  const matches = new Map();
  if (email) {
    for (const collectionName of ["users", "patients"]) {
      const snap = await getDocs(query(collection(db, collectionName), where("email", "==", email), limit(2))).catch(() => ({ docs: [] }));
      snap.docs.forEach((item) => {
        const profile = { id: item.id, ...item.data() };
        const key = profile.uid || profile.authUid || profile.firebaseUid || profile.email || item.id;
        matches.set(String(key), profile);
      });
    }
  }
  const patients = Array.from(matches.values()).filter((profile) => profile.role === "patient" || !profile.role);
  return patients.length === 1 ? patients[0] : null;
}

export async function fetchCurrentPatient() {
  const user = await waitForAuthUser();
  if (!user) throw new Error("Your session has expired. Please log in again.");

  let profile = await readProfileByUid(user.uid);
  if (!profile) {
    profile = await findUniquePatientProfile(user);
    if (profile) {
      await setDoc(doc(db, "users", user.uid), { ...profile, uid: user.uid, authUid: user.uid, role: "patient", updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(doc(db, "patients", user.uid), { ...profile, uid: user.uid, authUid: user.uid, role: "patient", updatedAt: serverTimestamp() }, { merge: true });
    }
  }
  if (!profile) throw new Error("We could not find your patient profile. Please contact KhunTest Lab.");

  const token = await user.getIdToken();
  return savePatientSession(token, { ...profile, uid: user.uid, email: profile.email || user.email || "" });
}

export async function loginPatient(identifier, password) {
  const profile = await loginUser(normalizePatientIdentifier(identifier), password);
  return { success: true, token: getPatientToken(), patient: await fetchCurrentPatient(profile) };
}

export async function registerPatient(patientData) {
  const profile = await registerFirebasePatient(patientData);
  return { success: true, token: getPatientToken(), patient: await fetchCurrentPatient(profile) };
}

export async function logoutPatient() {
  await logoutUser().catch(() => {});
  clearPatientSession();
}

export async function requirePatientAuth() {
  const patient = await fetchCurrentPatient();
  if (patient.role !== "patient" || patient.isActive === false) {
    clearPatientSession();
    throw new Error("Your session has expired. Please log in again.");
  }
  return patient;
}

export function getPatientAuthHeaders() {
  const token = getPatientToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export async function requestPatientPasswordReset(identifier) {
  return resetPatientPasswordByIdentifier(identifier);
}
