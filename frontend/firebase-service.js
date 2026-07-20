import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const C = {
  users: "users",
  bookings: "bookings",
  reports: "reports",
  bills: "bills",
  billAccess: "billAccess",
  tests: "tests",
  packages: "packages",
  patients: "patients",
  onlineBookings: "onlineBookings",
  adminNotifications: "adminNotifications",
  bookingAuditTrail: "bookingAuditTrail"
};

let lastTestsLoadInfo = {
  source: "not loaded",
  count: 0,
  firestoreCount: 0,
  jsonCount: 0,
  error: ""
};

function cleanEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizePatientName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function billNo() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function accessToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(18))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeDoc(snap) {
  const data = snap.data() || {};
  return { id: snap.id, ...data };
}

function safeSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || String(Date.now());
}

function testKeywords(...values) {
  return Array.from(new Set(values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)));
}

function isCBCTest(test) {
  const text = `${test?.name || ""} ${test?.testName || ""} ${test?.testCode || ""}`.toLowerCase();
  return text.includes("cbc") || text.includes("complete blood count");
}

function getFullCBCParameters() {
  return [
    { name: "Haemoglobin", normalRange: "M: 13.2-16.6, F: 11.6-15.0", unit: "g/dL", sample: "W.B. EDTA", method: "Non-cyanide Hb" },
    { name: "WBC Count", normalRange: "4000-11000", unit: "cmm", sample: "W.B. EDTA", method: "DC Detection" },
    { name: "DIFFERENTIAL COUNT OF W.B.C", type: "heading", isHeading: true },
    { name: "Neutrophils", normalRange: "40-75", unit: "%" },
    { name: "Lymphocytes", normalRange: "20-50", unit: "%" },
    { name: "Monocytes", normalRange: "2-8", unit: "%" },
    { name: "Eosinophils", normalRange: "1-6", unit: "%" },
    { name: "Basophils", normalRange: "0-1", unit: "%" },
    { name: "RBC Count", normalRange: "3.5-5.5", unit: "mill/cumm" },
    { name: "PCV/HCT", normalRange: "34-47", unit: "%" },
    { name: "MCV", normalRange: "80-96", unit: "fL" },
    { name: "MCH", normalRange: "27.5-33.2", unit: "pg" },
    { name: "MCHC", normalRange: "33.4-35.5", unit: "%" },
    { name: "RDW-CV", normalRange: "11.0-16.0", unit: "%" },
    { name: "RDW-SD", normalRange: "35.0-56.0", unit: "fL" },
    { name: "MPV", normalRange: "6.5-12.0", unit: "fL" },
    { name: "Platelet Count", normalRange: "1,50,000-4,50,000", unit: "/µL" },
    { name: "PCT", normalRange: "0.108-0.282", unit: "%" },
    { name: "P-LCR", normalRange: "11.0-45.0", unit: "%" },
    { name: "P-LCC", normalRange: "30-90", unit: "10^9/L" },
    { name: "PDW", normalRange: "9.0-17.0", unit: "fL" }
  ].map((parameter, index) => ({ ...parameter, sortOrder: index + 1 }));
}

function normalizeParameter(row, fallback = {}) {
  const name = row.name || row.parameterName || row.parameter_name || row.parameter || fallback.name || "Result";
  return {
    name,
    normalRange: row.normalRange || row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
    unit: row.unit || row.units || "",
    method: row.method || row.methodName || row.method_name || "",
    sample: row.sample || row.sampleType || row.sample_type || fallback.sample || "",
    type: row.type || "",
    isHeading: Boolean(row.isHeading || row.heading || row.type === "heading"),
    sortOrder: Number(row.sortOrder || row.sort_order || 0)
  };
}

function normalizeTest(data) {
  const name = data.name || data.testName || data.test_name || "";
  const testCode = String(data.testCode || data.test_code || data.code || data.sourceId || safeSlug(name)).trim();
  const category = data.category || "Lab Test";
  const sample = data.sample || "";
  const parameters = isCBCTest({ name, testCode })
    ? getFullCBCParameters().map((p) => normalizeParameter(p, { name, sample }))
    : Array.isArray(data.parameters)
      ? data.parameters.map((p) => normalizeParameter(p, { name, sample }))
    : [];
  return {
    id: data.id || data.slug || safeSlug(`${testCode}-${name}`),
    testId: data.testId || data.id || data.slug || testCode,
    slug: data.slug || safeSlug(`${testCode}-${name}`),
    sno: Number(data.sno || 0),
    testCode,
    name,
    nameLower: String(data.nameLower || name).toLowerCase(),
    category,
    price: Number(data.price ?? data.priceInr ?? data.price_inr ?? 0),
    sample,
    reportTime: data.reportTime || data.report_time || data.time || "Same Day",
    isActive: data.isActive !== false && data.is_active !== 0,
    needsParameterReview: data.needsParameterReview === true,
    parameters,
    searchKeywords: Array.isArray(data.searchKeywords) && data.searchKeywords.length
      ? data.searchKeywords
      : testKeywords(testCode, name, category),
    source: data.source || null,
    sourceId: data.sourceId || null
  };
}

function normalizeSelectedTest(data) {
  const test = normalizeTest(data);
  return {
    testId: data.testId || test.id || test.slug || test.testCode,
    id: test.id,
    testCode: test.testCode,
    name: test.name,
    category: test.category,
    price: test.price,
    sample: test.sample,
    reportTime: test.reportTime,
    parameters: test.parameters
  };
}

function normalizeBooking(data) {
  const selectedTests = Array.isArray(data.selectedTests)
    ? data.selectedTests.map(normalizeSelectedTest)
    : Array.isArray(data.tests)
      ? data.tests.map(normalizeSelectedTest)
    : data.test
      ? [normalizeSelectedTest({ name: data.test, price: Number(data.price || data.totalAmount || 0) })]
      : [];
  const totalAmount = Number(data.totalAmount || data.grossTotal || data.price || selectedTests.reduce((sum, t) => sum + Number(t.price || 0), 0));

  return {
    billNo: data.billNo || data.bill_no || billNo(),
    patientName: normalizePatientName(data.patientName || data.patient_name || data.name || ""),
    patientEmail: cleanEmail(data.patientEmail || data.email),
    email: cleanEmail(data.patientEmail || data.email),
    phone: String(data.phone || data.contactNo || "").trim(),
    whatsapp: String(data.whatsapp || data.phone || "").trim(),
    age: data.age || data.patientAge || "",
    gender: data.gender || "",
    selectedTests,
    tests: selectedTests,
    test: data.test || selectedTests.map((t) => t.name).filter(Boolean).join(", "),
    totalAmount,
    grossTotal: totalAmount,
    status: data.status || "Pending",
    reportReleased: Boolean(data.reportReleased),
    bookingType: data.bookingType || data.collectionType || "",
    collectionType: data.collectionType || data.bookingType || "",
    date: data.date || "",
    time: data.time || "",
    collectionDate: data.collectionDate || data.collDate || data.date || "",
    address: data.address || "",
    payment: data.payment || "",
    staff: data.staff || "Not Assigned",
    remoteNo: data.remoteNo || "0",
    dayNo: data.dayNo || "0",
    doctor: data.doctor || data.refDoctor || "",
    refBy: data.refBy || data.doctor || data.refDoctor || "",
    coName: data.coName || "",
    pathologyName: data.pathologyName || "BN-MAIN",
    associateLab: data.associateLab || "",
    admDate: data.admDate || "",
    collDate: data.collDate || "",
    cashReceived: Number(data.cashReceived || 0),
    cardReceived: Number(data.cardReceived || 0),
    discount: Number(data.discount || 0),
    balanceDue: Number(data.balanceDue || 0),
    remarks: data.remarks || ""
  };
}

function billTestsSnapshot(data) {
  const tests = Array.isArray(data.selectedTests) && data.selectedTests.length
    ? data.selectedTests
    : Array.isArray(data.tests)
      ? data.tests
      : data.test
        ? String(data.test).split(",").map((name) => ({ name: name.trim(), price: data.price || 0 }))
        : [];
  return tests.filter((test) => test.name || test.testName).map((test) => ({
    name: test.name || test.testName || "",
    testCode: test.testCode || test.id || "",
    category: test.category || "",
    quantity: Number(test.quantity || 1),
    price: Number(test.price || test.rate || 0),
    packageName: test.packageName || test.package || ""
  }));
}

function billSnapshot(data, existing = null) {
  const tests = billTestsSnapshot(data);
  const subtotal = Number(data.subtotal ?? tests.reduce((sum, test) => sum + (test.price * test.quantity), 0));
  const collectionCharge = Number(data.collectionCharge || 0);
  const discount = Number(data.discount || 0);
  const grandTotal = Number(data.grandTotal ?? data.totalAmount ?? data.grossTotal ?? Math.max(subtotal + collectionCharge - discount, 0));
  const amountPaid = Number(data.amountPaid ?? data.paidAmount ?? (Number(data.cashReceived || 0) + Number(data.cardReceived || 0)));
  const balanceDue = Number(data.balanceDue ?? data.dueAmount ?? Math.max(grandTotal - amountPaid, 0));
  const billNumber = existing?.billNo || data.customerBillNo || data.billNo || data.bookingId || billNo();
  return {
    billId: existing?.billId || billNumber,
    billNo: billNumber,
    bookingId: data.id || data.bookingId || "",
    bookingNo: data.bookingId || data.onlineBookingId || data.id || "",
    patientId: data.patientUid || data.uid || "",
    patientName: normalizePatientName(data.patientName),
    patientEmail: cleanEmail(data.patientEmail || data.email),
    phone: data.phone || "",
    whatsapp: data.whatsapp || data.phone || "",
    age: data.age || "",
    gender: data.gender || "",
    referringDoctor: data.referringDoctor || data.doctor || data.refBy || "",
    collectionType: data.collectionType || data.bookingType || "",
    tests,
    packages: tests.filter((test) => test.packageName).map((test) => test.packageName),
    subtotal,
    collectionCharge,
    discount,
    grandTotal,
    amountPaid,
    balanceDue,
    paymentMode: data.paymentMode || data.payment || "",
    paymentStatus: data.paymentStatus || (balanceDue <= 0 ? "Paid" : "Pending"),
    transactionId: data.transactionId || "",
    cashierName: data.cashierName || "",
    remarks: data.remarks || data.notes || "",
    billDate: existing?.billDate || new Date().toISOString(),
    accessToken: existing?.accessToken || accessToken(),
    revised: Boolean(existing?.revised),
    updatedAt: serverTimestamp()
  };
}

async function findBillForBooking(data) {
  const billNumber = String(data.customerBillNo || data.billNo || data.bookingId || "");
  if (billNumber) {
    const direct = await getDoc(doc(db, C.bills, billNumber)).catch(() => null);
    if (direct?.exists()) return normalizeDoc(direct);
  }
  const bookingId = data.id || data.bookingId || "";
  if (bookingId) {
    const snap = await getDocs(query(collection(db, C.bills), where("bookingId", "==", bookingId), limit(1))).catch(() => null);
    if (snap && !snap.empty) return normalizeDoc(snap.docs[0]);
  }
  return null;
}

function normalizeResult(row) {
  return {
    category: row.category || row.department || row.section || "",
    testName: row.testName || row.test_name || row.name || "",
    parameterName: row.parameterName || row.parameter_name || row.parameter || row.name || "",
    resultValue: row.resultValue || row.result_value || row.finding || row.value || "",
    normalRange: row.normalRange || row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
    normalValue: row.normalRange || row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
    unit: row.unit || row.units || "",
    method: row.method || row.methodName || row.method_name || "",
    sample: row.sample || row.sampleType || row.sample_type || "",
    comment: row.comment || row.remarks || "",
    details: row.details || [],
    isHeading: Boolean(row.isHeading || row.heading || row.type === "heading")
  };
}

export async function loginUser(email, password) {
  const cred = await signInWithEmailAndPassword(auth, cleanEmail(email), password);
  const profileSnap = await getDoc(doc(db, C.users, cred.user.uid));
  if (!profileSnap.exists()) throw new Error("User profile not found in Firestore.");
  const profile = normalizeDoc(profileSnap);
  if (profile.isActive === false) throw new Error("This account is inactive.");
  localStorage.setItem("auth_user", JSON.stringify(profile));
  localStorage.setItem("auth_token", cred.user.uid);
  return profile;
}

export async function requireAuth() {
  const user = await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (current) => {
      unsub();
      resolve(current);
    });
  });
  if (!user) throw new Error("Please login first.");
  return user;
}

export async function getCurrentUserProfile() {
  const user = await requireAuth();
  const snap = await getDoc(doc(db, C.users, user.uid));
  if (!snap.exists()) throw new Error("User profile not found in Firestore.");
  return normalizeDoc(snap);
}

export async function isAdmin() {
  const profile = await getCurrentUserProfile().catch(() => null);
  return Boolean(profile && profile.role === "admin" && profile.isActive !== false);
}

export async function logoutUser() {
  await signOut(auth);
  localStorage.removeItem("auth_token");
  localStorage.removeItem("auth_user");
  localStorage.removeItem("kt_session");
}

export async function getCurrentUserRole() {
  const user = await new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (current) => {
      unsub();
      resolve(current);
    });
  });
  if (!user) return null;
  const snap = await getDoc(doc(db, C.users, user.uid));
  if (!snap.exists()) return null;
  const profile = normalizeDoc(snap);
  return profile.isActive === false ? null : profile.role;
}

export async function registerPatient({ name, email, phone, password, age, gender, address }) {
  const cred = await createUserWithEmailAndPassword(auth, cleanEmail(email), password);
  const profile = {
    uid: cred.user.uid,
    name: normalizePatientName(name),
    email: cleanEmail(email),
    phone: phone || "",
    role: "patient",
    age: age || "",
    gender: gender || "",
    address: address || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    isActive: true
  };
  await setDoc(doc(db, C.users, cred.user.uid), profile);
  await setDoc(doc(db, C.patients, cred.user.uid), profile, { merge: true });
  localStorage.setItem("auth_user", JSON.stringify(profile));
  localStorage.setItem("auth_token", cred.user.uid);
  return profile;
}

export async function resetPatientPassword(email) {
  await sendPasswordResetEmail(auth, cleanEmail(email));
}

export async function savePatientProfile(uid, profilePatch) {
  const clean = {
    ...profilePatch,
    name: normalizePatientName(profilePatch.name || profilePatch.patientName || ""),
    patientName: normalizePatientName(profilePatch.patientName || profilePatch.name || ""),
    email: cleanEmail(profilePatch.email),
    updatedAt: serverTimestamp()
  };
  await setDoc(doc(db, C.users, uid), clean, { merge: true });
  await setDoc(doc(db, C.patients, uid), clean, { merge: true });
  return clean;
}

export async function createBooking(bookingData) {
  const booking = normalizeBooking(bookingData);
  const now = serverTimestamp();
  const docRef = await addDoc(collection(db, C.bookings), {
    ...booking,
    createdAt: now,
    updatedAt: now
  });
  await updateDoc(docRef, { id: docRef.id });
  return { id: docRef.id, ...booking };
}

export async function createOnlineBooking(bookingData) {
  const user = await requireAuth();
  const bookingId = bookingData.bookingId || `OB${Date.now()}`;
  const tests = Array.isArray(bookingData.tests) ? bookingData.tests.map(normalizeSelectedTest) : [];
  const subtotal = Number(bookingData.subtotal || tests.reduce((sum, test) => sum + Number(test.price || 0), 0));
  const collectionCharge = Number(bookingData.collectionCharge || 0);
  const discount = Number(bookingData.discount || 0);
  const totalAmount = Number(bookingData.totalAmount || Math.max(subtotal + collectionCharge - discount, 0));
  const paymentStatus = bookingData.paymentStatus || (Number(bookingData.paidAmount || 0) >= totalAmount ? "Paid" : "Pending");
  const payload = {
    bookingId,
    patientUid: user.uid,
    patientName: normalizePatientName(bookingData.patientName || ""),
    age: bookingData.age || "",
    dob: bookingData.dob || "",
    gender: bookingData.gender || "",
    phone: String(bookingData.phone || "").trim(),
    whatsapp: String(bookingData.whatsapp || bookingData.phone || "").trim(),
    email: cleanEmail(bookingData.email || user.email),
    patientEmail: cleanEmail(bookingData.email || user.email),
    address: bookingData.address || "",
    city: bookingData.city || "",
    pincode: bookingData.pincode || "",
    collectionType: bookingData.collectionType || "Home Collection",
    bookingType: bookingData.collectionType || "Home Collection",
    preferredDate: bookingData.preferredDate || "",
    preferredTime: bookingData.preferredTime || "",
    date: bookingData.preferredDate || "",
    time: bookingData.preferredTime || "",
    referringDoctor: bookingData.referringDoctor || "",
    doctor: bookingData.referringDoctor || "",
    refBy: bookingData.referringDoctor || "",
    notes: bookingData.notes || "",
    remarks: bookingData.remarks || bookingData.notes || "",
    tests,
    selectedTests: tests,
    test: tests.map((test) => test.name).join(", "),
    subtotal,
    collectionCharge,
    discount,
    totalAmount,
    grossTotal: totalAmount,
    paidAmount: Number(bookingData.paidAmount || 0),
    dueAmount: Number(bookingData.dueAmount ?? Math.max(totalAmount - Number(bookingData.paidAmount || 0), 0)),
    paymentMode: bookingData.paymentMode || "Pay Later",
    paymentStatus,
    transactionId: bookingData.transactionId || "",
    bookingStatus: bookingData.bookingStatus || "New",
    status: bookingData.bookingStatus || "New",
    source: "online",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  let savedCollection = C.onlineBookings;
  let savedId = bookingId;
  try {
    await setDoc(doc(db, C.onlineBookings, bookingId), payload);
  } catch (err) {
    const fallbackRef = await addDoc(collection(db, C.bookings), {
      ...payload,
      onlineBookingId: bookingId,
      source: "online",
      status: payload.bookingStatus
    });
    savedCollection = C.bookings;
    savedId = fallbackRef.id;
  }
  await savePatientProfile(user.uid, {
    uid: user.uid,
    name: payload.patientName,
    email: payload.email,
    phone: payload.phone,
    whatsapp: payload.whatsapp,
    age: payload.age,
    dob: payload.dob,
    gender: payload.gender,
    address: payload.address,
    city: payload.city,
    pincode: payload.pincode,
    role: "patient",
    isActive: true
  });
  await setDoc(doc(db, C.adminNotifications, `online-${bookingId}`), {
    type: "online_booking",
    bookingId,
    title: "New Online Booking",
    message: `${payload.patientName || "Patient"} requested ${tests.map((test) => test.name).join(", ") || "lab tests"}.`,
    isRead: false,
    createdAt: serverTimestamp()
  }, { merge: true }).catch(() => {});
  return { id: savedId, savedCollection, ...payload };
}

export function listenMyOnlineBookings(uid, callback, onError) {
  return onSnapshot(
    query(collection(db, C.onlineBookings), where("patientUid", "==", uid)),
    (snap) => callback(snap.docs.map(normalizeDoc).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))),
    onError
  );
}

export function listenOnlineBookings(callback, onError) {
  return onSnapshot(query(collection(db, C.onlineBookings), orderBy("createdAt", "desc")), (snap) => callback(snap.docs.map(normalizeDoc)), onError);
}

export function listenAdminNotifications(callback, onError) {
  return onSnapshot(query(collection(db, C.adminNotifications), orderBy("createdAt", "desc")), (snap) => callback(snap.docs.map(normalizeDoc)), onError);
}

export async function markAdminNotificationRead(notificationId, readBy = "") {
  await setDoc(doc(db, C.adminNotifications, notificationId), {
    isRead: true,
    readAt: serverTimestamp(),
    readBy
  }, { merge: true });
}

export async function updateOnlineBooking(bookingId, patch, actor = {}) {
  const ref = doc(db, C.onlineBookings, bookingId);
  const before = await getDoc(ref);
  const previous = before.exists() ? before.data() : {};
  await setDoc(ref, {
    ...patch,
    updatedAt: serverTimestamp(),
    updatedBy: actor.email || actor.uid || ""
  }, { merge: true });
  await addDoc(collection(db, C.bookingAuditTrail), {
    bookingCollection: C.onlineBookings,
    bookingId,
    before: previous,
    after: patch,
    updatedAt: serverTimestamp(),
    updatedBy: actor.email || actor.uid || ""
  });
}

export async function convertOnlineBookingToBooking(onlineBooking, actor = {}) {
  const bill = onlineBooking.billNo || String(Math.floor(100000 + Math.random() * 900000));
  const payload = normalizeBooking({
    ...onlineBooking,
    billNo: bill,
    patientEmail: onlineBooking.email || onlineBooking.patientEmail,
    bookingType: onlineBooking.collectionType,
    collectionDate: onlineBooking.preferredDate || onlineBooking.collectionDate,
    date: onlineBooking.preferredDate || onlineBooking.date,
    time: onlineBooking.preferredTime || onlineBooking.time,
    payment: onlineBooking.paymentMode,
    status: "Report Entry"
  });
  const docRef = await addDoc(collection(db, C.bookings), {
    ...payload,
    onlineBookingId: onlineBooking.id || onlineBooking.bookingId,
    source: "online",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    updatedBy: actor.email || actor.uid || ""
  });
  await updateOnlineBooking(onlineBooking.id || onlineBooking.bookingId, {
    linkedBookingId: docRef.id,
    billNo: bill,
    bookingStatus: "Processing",
    status: "Processing"
  }, actor);
  return { id: docRef.id, ...payload };
}

export async function getTests({ activeOnly = true } = {}) {
  const result = await loadAvailableTests({ activeOnly });
  return result.tests;
}

async function loadTestsFromJson(activeOnly = true) {
  const response = await fetch("./data/tests.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load data/tests.json (${response.status})`);
  const rows = await response.json();
  return rows
    .map((row) => normalizeTest(row))
    .filter((test) => !activeOnly || test.isActive)
    .filter((test) => test.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function loadAvailableTests({ activeOnly = true } = {}) {
  let firestoreError = "";
  let firestoreWasEmpty = false;
  try {
    const snap = await getDocs(collection(db, C.tests));
    const firestoreTests = snap.docs
      .map((docSnap) => normalizeTest({ ...(docSnap.data() || {}), id: docSnap.id, testId: docSnap.id }))
      .filter((test) => !activeOnly || test.isActive)
      .filter((test) => test.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (firestoreTests.length) {
      lastTestsLoadInfo = {
        source: "firestore",
        count: firestoreTests.length,
        firestoreCount: firestoreTests.length,
        jsonCount: 0,
        error: ""
      };
      return { tests: firestoreTests, source: "firestore", error: null };
    }
    lastTestsLoadInfo = {
      source: "Firestore empty, using data/tests.json",
      count: 0,
      firestoreCount: 0,
      jsonCount: 0,
      error: ""
    };
    firestoreWasEmpty = true;
  } catch (err) {
    firestoreError = err.message || String(err);
  }

  try {
    const jsonTests = await loadTestsFromJson(activeOnly);
    const source = "data/tests.json";
    lastTestsLoadInfo = {
      source,
      count: jsonTests.length,
      firestoreCount: 0,
      jsonCount: jsonTests.length,
      error: firestoreError
    };
    return { tests: jsonTests, source, error: firestoreError || (firestoreWasEmpty ? null : null) };
  } catch (fallbackErr) {
    const message = fallbackErr.message || String(fallbackErr);
    lastTestsLoadInfo = {
      source: "none",
      count: 0,
      firestoreCount: 0,
      jsonCount: 0,
      error: message
    };
    return { tests: [], source: "none", error: message };
  }
}

export function getTestsLoadInfo() {
  return { ...lastTestsLoadInfo };
}

export async function getAllBookings() {
  const snap = await getDocs(query(collection(db, C.bookings), orderBy("createdAt", "desc")));
  return snap.docs.map(normalizeDoc);
}

export async function getTodayBookings() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const snap = await getDocs(query(
    collection(db, C.bookings),
    where("createdAt", ">=", Timestamp.fromDate(start)),
    where("createdAt", "<", Timestamp.fromDate(end))
  ));
  return snap.docs.map(normalizeDoc).sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

export async function getPatientBookings(email, phone) {
  const emailValue = cleanEmail(email);
  const snap = emailValue
    ? await getDocs(query(collection(db, C.bookings), where("patientEmail", "==", emailValue)))
    : { docs: [] };
  let rows = snap.docs.map(normalizeDoc);
  if (phone) {
    const phoneSnap = await getDocs(query(collection(db, C.bookings), where("phone", "==", String(phone).trim())));
    const byId = new Map(rows.map((row) => [row.id, row]));
    phoneSnap.docs.map(normalizeDoc).forEach((row) => byId.set(row.id, row));
    rows = Array.from(byId.values());
  }
  return rows.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

export async function saveReport({ billNo, patientName, patientEmail, phone, whatsapp, tests, results, bookingId, age, gender, doctor, refBy, createdAt, collectionDate, reportingDate }) {
  const selectedTests = Array.isArray(tests) ? tests.map(normalizeSelectedTest) : [];
  const report = {
    billNo: String(billNo || ""),
    bookingId: bookingId || "",
    patientName: normalizePatientName(patientName),
    patientEmail: cleanEmail(patientEmail),
    phone: phone || "",
    whatsapp: whatsapp || phone || "",
    age: age || "",
    gender: gender || "",
    refBy: refBy || doctor || "",
    doctor: doctor || refBy || "",
    collectionDate: collectionDate || "",
    reportingDate: reportingDate || "",
    tests: selectedTests,
    selectedTests,
    results: Array.isArray(results) ? results.map(normalizeResult) : [],
    status: "Final",
    reportStatus: "Final",
    releasedAt: serverTimestamp(),
    createdAt: createdAt || serverTimestamp()
  };
  await setDoc(doc(db, C.reports, report.billNo), report);
  if (bookingId) {
    await updateDoc(doc(db, C.bookings, bookingId), {
      status: "Reported",
      reportReleased: true,
      reportBillNo: report.billNo,
      reportingDate: reportingDate || "",
      updatedAt: serverTimestamp()
    });
  }
  return report;
}

export async function releaseReport(reportData) {
  return saveReport(reportData);
}

export async function getReportByBillNo(billNoValue) {
  const bill = String(billNoValue || "").trim();
  if (!bill) return null;

  const directReport = await getDoc(doc(db, C.reports, bill));
  if (directReport.exists()) return normalizeDoc(directReport);

  const reportSnap = await getDocs(query(collection(db, C.reports), where("billNo", "==", bill), limit(1)));
  if (!reportSnap.empty) return normalizeDoc(reportSnap.docs[0]);

  const directBooking = await getDoc(doc(db, C.bookings, bill));
  const bookingDoc = directBooking.exists()
    ? directBooking
    : (await getDocs(query(collection(db, C.bookings), where("billNo", "==", bill), limit(1)))).docs[0];

  if (!bookingDoc) return null;

  const booking = normalizeDoc(bookingDoc);
  const results = Array.isArray(booking.results)
    ? booking.results
    : Array.isArray(booking.reportResults)
      ? booking.reportResults
      : Array.isArray(booking.reportValues)
        ? booking.reportValues.map((row) => ({
            category: row.category || row.department || "",
            testName: row.testName || row.test_name || row.name || booking.test || "",
            parameterName: row.parameterName || row.parameter_name || row.parameter || row.name || "",
            resultValue: row.resultValue || row.result_value || row.finding || row.value || "",
            normalRange: row.normalRange || row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
            unit: row.unit || row.units || "",
            method: row.method || "",
            sample: row.sample || "",
            comment: row.comment || row.remarks || "",
            details: row.details || []
          }))
        : [];

  if (!booking.reportReleased && !results.length) return null;

  return {
    ...booking,
    billNo: booking.billNo || bill,
    bookingId: booking.id,
    patientName: normalizePatientName(booking.patientName || booking.patient_name || ""),
    patientEmail: cleanEmail(booking.patientEmail || booking.email),
    refBy: booking.refBy || booking.doctor || booking.refDoctor || "",
    doctor: booking.doctor || booking.refBy || booking.refDoctor || "",
    collectionDate: booking.collectionDate || booking.collDate || booking.date || "",
    reportingDate: booking.reportingDate || "",
    status: "Final",
    tests: booking.selectedTests || booking.tests || [],
    results: results.map(normalizeResult)
  };
}

export async function getBookingByBillNo(billNoValue) {
  const bill = String(billNoValue || "").trim();
  if (!bill) return null;
  const direct = await getDoc(doc(db, C.bookings, bill));
  if (direct.exists()) return normalizeDoc(direct);
  const snap = await getDocs(query(collection(db, C.bookings), where("billNo", "==", bill), limit(1)));
  return snap.empty ? null : normalizeDoc(snap.docs[0]);
}

export async function createCustomerBillForBooking(bookingData, options = {}) {
  const existing = await findBillForBooking(bookingData);
  const bill = billSnapshot(bookingData, existing);
  const reprintCount = Number(existing?.reprintCount || 0) + (options.reprint ? 1 : 0);
  await setDoc(doc(db, C.bills, bill.billNo), {
    ...bill,
    reprintCount,
    createdAt: existing?.createdAt || serverTimestamp(),
    createdBy: existing?.createdBy || bookingData.patientUid || ""
  }, { merge: true });
  await setDoc(doc(db, C.billAccess, bill.accessToken), {
    ...bill,
    publicToken: bill.accessToken,
    updatedAt: serverTimestamp()
  }, { merge: true });
  return { ...existing, ...bill, id: bill.billNo, reprintCount };
}

export async function getCustomerBill(billNoValue, token = "") {
  const billNumber = String(billNoValue || "").trim();
  if (!billNumber) throw new Error("Bill number is required.");
  if (token) {
    const accessSnap = await getDoc(doc(db, C.billAccess, token)).catch(() => null);
    if (accessSnap?.exists()) {
      const accessBill = normalizeDoc(accessSnap);
      if (String(accessBill.billNo) === billNumber) return accessBill;
    }
  }
  const snap = await getDoc(doc(db, C.bills, billNumber));
  if (!snap.exists()) throw new Error("Bill not found.");
  const bill = normalizeDoc(snap);
  if (token && token === bill.accessToken) return bill;
  const user = auth.currentUser;
  if (!user) throw new Error("Please login to view this bill.");
  const profileSnap = await getDoc(doc(db, C.users, user.uid)).catch(() => null);
  const profile = profileSnap?.exists() ? profileSnap.data() : {};
  const isAdminUser = profile?.role === "admin" && profile?.isActive !== false;
  const isPatientOwner = bill.patientId === user.uid || cleanEmail(bill.patientEmail) === cleanEmail(user.email);
  if (!isAdminUser && !isPatientOwner) throw new Error("You are not authorized to view this bill.");
  return bill;
}

export async function updateBookingStatus(bookingId, status) {
  await updateDoc(doc(db, C.bookings, bookingId), {
    status,
    updatedAt: serverTimestamp()
  });
}

export async function assignStaff(bookingId, staffName) {
  await updateDoc(doc(db, C.bookings, bookingId), {
    staff: staffName || "Not Assigned",
    updatedAt: serverTimestamp()
  });
}

export const getAllTests = getTests;

export async function searchTests(searchText = "", category = "") {
  const q = String(searchText || "").trim().toLowerCase();
  const { tests } = await loadAvailableTests();
  return tests.filter((test) => {
    if (category && test.category !== category) return false;
    if (!q) return true;
    return [test.testCode, test.name, test.category, ...(test.searchKeywords || [])].join(" ").toLowerCase().includes(q);
  });
}

export async function getTestById(testId) {
  const value = String(testId || "").trim();
  if (!value) return null;
  const direct = await getDoc(doc(db, C.tests, value));
  if (direct.exists()) return normalizeTest(normalizeDoc(direct));
  const slugValue = safeSlug(value);
  if (slugValue && slugValue !== value) {
    const slugSnap = await getDoc(doc(db, C.tests, slugValue));
    if (slugSnap.exists()) return normalizeTest(normalizeDoc(slugSnap));
  }
  const codeSnap = await getDocs(query(collection(db, C.tests), where("testCode", "==", value), limit(1)));
  if (!codeSnap.empty) return normalizeTest(normalizeDoc(codeSnap.docs[0]));
  const nameSnap = await getDocs(query(collection(db, C.tests), where("nameLower", "==", value.toLowerCase()), limit(1)));
  return nameSnap.empty ? null : normalizeTest(normalizeDoc(nameSnap.docs[0]));
}

export async function updateTest(testId, patch) {
  const existing = await getTestById(testId);
  if (!existing) throw new Error("Test not found in Firestore.");
  const ref = doc(db, C.tests, existing.id || existing.slug || safeSlug(`${existing.testCode}-${existing.name}`));
  const payload = {
    ...patch,
    price: patch.price === undefined ? existing.price : Number(patch.price || 0),
    parameters: Array.isArray(patch.parameters) ? patch.parameters.map((p) => normalizeParameter(p, { name: existing.name, sample: existing.sample })) : existing.parameters,
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });
  return { ...existing, ...payload };
}

export async function saveReportDraft(reportData) {
  const bill = String(reportData.billNo || "");
  if (!bill) throw new Error("Bill number is required.");
  const draft = {
    ...reportData,
    billNo: bill,
    reportStatus: "Draft",
    status: "Draft",
    updatedAt: serverTimestamp(),
    createdAt: reportData.createdAt || serverTimestamp()
  };
  await setDoc(doc(db, C.reports, bill), draft, { merge: true });
  if (reportData.bookingId) {
    await updateDoc(doc(db, C.bookings, reportData.bookingId), {
      status: "Report Entry",
      updatedAt: serverTimestamp()
    });
  }
  return draft;
}

export const getAllReports = getReports;

export async function getPatientReports(user) {
  const email = cleanEmail(user?.email || user?.patientEmail);
  if (!email) return [];
  const snap = await getDocs(query(collection(db, C.reports), where("patientEmail", "==", email)));
  return snap.docs.map(normalizeDoc).sort((a, b) => (toDate(b.releasedAt)?.getTime() || 0) - (toDate(a.releasedAt)?.getTime() || 0));
}

export function cleanupOldData(months = 2) {
  return deleteDataOlderThanMonths(months);
}

function csvEscape(value) {
  const text = value === undefined || value === null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowDate(row) {
  return toDate(row.createdAt) || toDate(row.releasedAt) || new Date();
}

function downloadCSV(filename, rows) {
  const blob = new Blob([rows.map((row) => row.map(csvEscape).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function collectCsvRows(cutoffDate = null) {
  const [bookings, reportSnap] = await Promise.all([
    getAllBookings(),
    getDocs(collection(db, C.reports))
  ]);
  const reports = reportSnap.docs.map(normalizeDoc);
  const bookingRows = bookings
    .filter((b) => !cutoffDate || rowDate(b) >= cutoffDate)
    .map((b) => [
      "booking",
      b.billNo || "",
      b.patientName || "",
      b.patientEmail || b.email || "",
      b.phone || "",
      (b.selectedTests || b.tests || []).map((t) => t.name || t.testName || t.test_name).join(" | ") || b.test || "",
      b.totalAmount || b.grossTotal || b.price || 0,
      b.status || "",
      rowDate(b).toISOString()
    ]);
  const reportRows = reports
    .filter((r) => !cutoffDate || rowDate(r) >= cutoffDate)
    .map((r) => [
      "report",
      r.billNo || "",
      r.patientName || "",
      r.patientEmail || "",
      r.phone || "",
      (r.selectedTests || r.tests || []).map((t) => t.name || t.testName || t.test_name).join(" | "),
      "",
      r.status || "Final",
      rowDate(r).toISOString()
    ]);
  return [
    ["type", "billNo", "patientName", "email", "phone", "tests", "amount", "status", "date"],
    ...bookingRows,
    ...reportRows
  ];
}

export async function downloadBookingsCSV() {
  downloadCSV("khuntest-all-bookings-reports.csv", await collectCsvRows());
}

export async function downloadLastTwoMonthsCSV() {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
  downloadCSV("khuntest-last-two-months.csv", await collectCsvRows(cutoff));
}

export async function deleteDataOlderThanTwoMonths() {
  return deleteDataOlderThanMonths(2);
}

export async function deleteDataOlderThanMonths(months = 2) {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - Number(months || 2));
  const cutoffTs = Timestamp.fromDate(cutoff);
  const [oldBookings, oldReports] = await Promise.all([
    getDocs(query(collection(db, C.bookings), where("createdAt", "<", cutoffTs))),
    getDocs(query(collection(db, C.reports), where("createdAt", "<", cutoffTs)))
  ]);
  await Promise.all([
    ...oldBookings.docs.map((snap) => deleteDoc(doc(db, C.bookings, snap.id))),
    ...oldReports.docs.map((snap) => deleteDoc(doc(db, C.reports, snap.id)))
  ]);
  return oldBookings.size + oldReports.size;
}

export async function getReports() {
  const snap = await getDocs(collection(db, C.reports));
  return snap.docs.map(normalizeDoc);
}

export const KTFirebase = {
  auth,
  db,
  requireAuth,
  getCurrentUserProfile,
  isAdmin,
  loginUser,
  logoutUser,
  getCurrentUserRole,
  registerPatient,
  resetPatientPassword,
  savePatientProfile,
  createBooking,
  createOnlineBooking,
  listenMyOnlineBookings,
  listenOnlineBookings,
  listenAdminNotifications,
  markAdminNotificationRead,
  updateOnlineBooking,
  convertOnlineBookingToBooking,
  getAllBookings,
  getTodayBookings,
  getPatientBookings,
  assignStaff,
  getTests,
  loadAvailableTests,
  getTestsLoadInfo,
  getAllTests,
  searchTests,
  getTestById,
  updateTest,
  saveReportDraft,
  releaseReport,
  saveReport,
  getReportByBillNo,
  getBookingByBillNo,
  updateBookingStatus,
  downloadBookingsCSV,
  downloadLastTwoMonthsCSV,
  cleanupOldData,
  deleteDataOlderThanTwoMonths,
  getReports,
  getAllReports,
  getPatientReports
};

window.KTFirebase = KTFirebase;
