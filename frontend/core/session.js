// Authentication — NEUTRALISED for the single-tenant KhunTest deployment.
//
// The platform resolved WHO / WHICH lab / subscription state from
// /userIndex/{uid} + /labs/{labId} and a 9-role matrix. This app keeps
// KhunTest's model: a Firebase Auth user whose /users/{uid} document has
// role === "admin" and is active. That single admin gets every permission,
// there is no subscription gate, and the lab is always "khuntest".
//
// The export surface matches the original so admin/*.js import unchanged.
import { auth, db } from "./firebase-config.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getLabId } from "./tenant.js";

const ACTIVE_SUBSCRIPTION = Object.freeze({
  state: "active", readOnly: false, blocked: false, message: "", daysRemaining: null
});

let cachedSession = null;

export function currentSession() { return cachedSession; }

function waitForUser() {
  return new Promise((resolve) => {
    let unsub = null;
    let fired = false;
    unsub = onAuthStateChanged(auth, (user) => {
      fired = true;
      unsub?.();
      resolve(user);
    });
    if (fired) unsub();
  });
}

function profileIsActive(profile) {
  return profile?.isActive === true || profile?.active === true;
}

async function readUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

/** Build the session for the signed-in admin (or null). */
export async function loadSession() {
  const user = await waitForUser();
  if (!user) { cachedSession = null; return null; }

  const profile = await readUserProfile(user.uid);
  if (!profile || profile.role !== "admin" || !profileIsActive(profile)) {
    cachedSession = null;
    return null;
  }

  cachedSession = {
    uid: user.uid,
    email: user.email || profile.email || "",
    name: profile.name || profile.displayName || user.displayName || user.email || "Admin",
    phone: profile.phone || "",
    role: "admin",
    branchId: "",
    isSuperAdmin: false,
    isActive: true,
    labId: getLabId(),
    lab: {},
    subscription: ACTIVE_SUBSCRIPTION,
    permissions: ["*"]
  };
  return cachedSession;
}

/** The single admin may do everything. */
export function sessionCan(_permission, session = cachedSession) {
  return Boolean(session && session.isActive);
}

export function sessionCanWrite(_permission, session = cachedSession) {
  return Boolean(session && session.isActive);
}

export function sessionHasFeature(_feature, session = cachedSession) {
  return Boolean(session && session.isActive);
}

function redirect(to) {
  const next = encodeURIComponent(globalThis.location.pathname + globalThis.location.search);
  globalThis.location.replace(`${to}?next=${next}`);
}

/** Gate the admin panel. Resolves to the session or never returns. */
export async function requireStaff({ redirectTo = "admin-login.html" } = {}) {
  const session = await loadSession();
  if (!session) { redirect(redirectTo); return new Promise(() => {}); }
  return session;
}

// Kept for import compatibility; this deployment has no super-admin surface.
export async function requireSuperAdmin({ redirectTo = "admin-login.html" } = {}) {
  return requireStaff({ redirectTo });
}

export async function requirePatient({ redirectTo = "patient-login.html" } = {}) {
  const user = await waitForUser();
  if (!user) { redirect(redirectTo); return new Promise(() => {}); }
  return { uid: user.uid, email: user.email || "", role: "patient" };
}

export async function login(email, password) {
  const credential = await signInWithEmailAndPassword(
    auth, String(email || "").trim().toLowerCase(), password
  );
  cachedSession = null;
  return credential.user;
}

export async function logout() {
  cachedSession = null;
  try { await signOut(auth); } catch { /* already signed out */ }
}

export { getLabId };
