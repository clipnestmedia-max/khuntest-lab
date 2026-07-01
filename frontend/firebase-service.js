import { auth, db } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
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
  tests: "tests",
  packages: "packages"
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

function billNo() {
  return String(Math.floor(100000 + Math.random() * 900000));
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

function normalizeParameter(row, fallback = {}) {
  const name = row.name || row.parameterName || row.parameter_name || row.parameter || fallback.name || "Result";
  return {
    name,
    normalRange: row.normalRange || row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
    unit: row.unit || row.units || "",
    method: row.method || row.methodName || row.method_name || "",
    sample: row.sample || row.sampleType || row.sample_type || fallback.sample || "",
    sortOrder: Number(row.sortOrder || row.sort_order || 0)
  };
}

function normalizeTest(data) {
  const name = data.name || data.testName || data.test_name || "";
  const testCode = String(data.testCode || data.test_code || data.code || data.sourceId || safeSlug(name)).trim();
  const category = data.category || "Lab Test";
  const sample = data.sample || "";
  const parameters = Array.isArray(data.parameters)
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
    patientName: data.patientName || data.patient_name || data.name || "",
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
    name: name || "",
    email: cleanEmail(email),
    phone: phone || "",
    role: "patient",
    age: age || "",
    gender: gender || "",
    address: address || "",
    createdAt: serverTimestamp(),
    isActive: true
  };
  await setDoc(doc(db, C.users, cred.user.uid), profile);
  return profile;
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
    patientName: patientName || "",
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
    patientName: booking.patientName || booking.patient_name || "",
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
  createBooking,
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
