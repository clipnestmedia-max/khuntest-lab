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
  tests: "tests"
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

function normalizeBooking(data) {
  const tests = Array.isArray(data.tests)
    ? data.tests
    : data.test
      ? [{ name: data.test, price: Number(data.price || data.totalAmount || 0) }]
      : [];

  return {
    billNo: data.billNo || data.bill_no || billNo(),
    patientName: data.patientName || data.patient_name || data.name || "",
    patientEmail: cleanEmail(data.patientEmail || data.email),
    email: cleanEmail(data.patientEmail || data.email),
    phone: String(data.phone || data.contactNo || "").trim(),
    whatsapp: String(data.whatsapp || data.phone || "").trim(),
    age: data.age || data.patientAge || "",
    gender: data.gender || "",
    tests,
    test: data.test || tests.map((t) => t.name || t.testName || t.test_name).filter(Boolean).join(", "),
    totalAmount: Number(data.totalAmount || data.grossTotal || data.price || tests.reduce((sum, t) => sum + Number(t.price || 0), 0)),
    grossTotal: Number(data.totalAmount || data.grossTotal || data.price || 0),
    status: data.status || "Pending",
    reportReleased: Boolean(data.reportReleased),
    bookingType: data.bookingType || data.collectionType || "",
    date: data.date || "",
    time: data.time || "",
    address: data.address || "",
    payment: data.payment || "",
    staff: data.staff || "Not Assigned",
    remoteNo: data.remoteNo || "0",
    dayNo: data.dayNo || "0",
    doctor: data.doctor || data.refDoctor || "",
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
    testName: row.testName || row.test_name || row.name || "",
    parameterName: row.parameterName || row.parameter_name || row.parameter || row.name || "",
    resultValue: row.resultValue || row.result_value || row.finding || row.value || "",
    normalValue: row.normalValue || row.normal_value || row.normal || row.referenceRange || "",
    unit: row.unit || row.units || "",
    comment: row.comment || row.remarks || "",
    details: row.details || []
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
  return snap.exists() ? normalizeDoc(snap).role : null;
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

export async function getAllBookings() {
  const snap = await getDocs(query(collection(db, C.bookings), orderBy("createdAt", "desc")));
  return snap.docs.map(normalizeDoc);
}

export async function getPatientBookings(email, phone) {
  const emailValue = cleanEmail(email);
  const snap = await getDocs(query(collection(db, C.bookings), where("patientEmail", "==", emailValue)));
  let rows = snap.docs.map(normalizeDoc);
  if (!rows.length && phone) {
    const phoneSnap = await getDocs(query(collection(db, C.bookings), where("phone", "==", String(phone).trim())));
    rows = phoneSnap.docs.map(normalizeDoc);
  }
  return rows.sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0));
}

export async function saveReport({ billNo, patientName, patientEmail, phone, tests, results, bookingId, age, gender, doctor, createdAt, collectionDate }) {
  const report = {
    billNo: String(billNo || ""),
    bookingId: bookingId || "",
    patientName: patientName || "",
    patientEmail: cleanEmail(patientEmail),
    phone: phone || "",
    age: age || "",
    gender: gender || "",
    doctor: doctor || "",
    collectionDate: collectionDate || "",
    tests: Array.isArray(tests) ? tests : [],
    results: Array.isArray(results) ? results.map(normalizeResult) : [],
    status: "Final",
    releasedAt: serverTimestamp(),
    createdAt: serverTimestamp()
  };
  await setDoc(doc(db, C.reports, report.billNo), report);
  if (bookingId) {
    await updateDoc(doc(db, C.bookings, bookingId), {
      status: "Reported",
      reportReleased: true,
      updatedAt: serverTimestamp()
    });
  }
  return report;
}

export async function getReportByBillNo(billNoValue) {
  const snap = await getDoc(doc(db, C.reports, String(billNoValue || "")));
  return snap.exists() ? normalizeDoc(snap) : null;
}

export async function updateBookingStatus(bookingId, status) {
  await updateDoc(doc(db, C.bookings, bookingId), {
    status,
    updatedAt: serverTimestamp()
  });
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
      (b.tests || []).map((t) => t.name || t.testName || t.test_name).join(" | ") || b.test || "",
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
      (r.tests || []).map((t) => t.name || t.testName || t.test_name).join(" | "),
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
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 2);
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
  loginUser,
  logoutUser,
  getCurrentUserRole,
  registerPatient,
  createBooking,
  getAllBookings,
  getPatientBookings,
  saveReport,
  getReportByBillNo,
  updateBookingStatus,
  downloadBookingsCSV,
  downloadLastTwoMonthsCSV,
  deleteDataOlderThanTwoMonths,
  getReports
};

window.KTFirebase = KTFirebase;
