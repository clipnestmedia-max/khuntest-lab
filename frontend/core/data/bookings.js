// Bookings, billing lines and payment capture.
//
// A booking carries its own denormalised copy of every test row (name, code,
// price at the time of booking). That is deliberate: a laboratory that raises
// the CBC price next month must not retroactively change last month's bills.
import {
  getDocs, getDoc, setDoc, updateDoc, deleteDoc, addDoc, query, where, orderBy, limit,
  onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId } from "../tenant.js";
import { safeNextId } from "./ids.js";
import {
  snapshotRows, normalizeName, normalizePhone, cleanEmail, buildSearchTokens, clean, toNumber,
  dateKey, sortByDateDesc
} from "./helpers.js";
import { upsertPatientByPhone, recordVisit } from "./patients.js";
import { logAudit, AUDIT, diffFields } from "../audit.js";

export const BOOKING_STATUS = Object.freeze([
  "New", "Sample Pending", "Sample Collected", "In Process",
  "Report Ready", "Delivered", "Cancelled"
]);

export const PAYMENT_MODES = Object.freeze(["Cash", "UPI", "Card", "Net Banking", "Online", "Pay Later"]);
export const PAYMENT_STATUS = Object.freeze(["Pending", "Partial", "Paid", "Refunded", "Failed"]);

/** Drop duplicate tests and keep the price the operator actually saw. */
export function uniqueTests(list = []) {
  const seen = new Set();
  const out = [];
  (Array.isArray(list) ? list : []).forEach((t, index) => {
    const key = String(t.testId || t.id || t.testCode || t.name || index).toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      testId: t.testId || t.id || t.testCode || "",
      testCode: t.testCode || "",
      name: t.name || t.testName || "",
      category: t.category || "",
      sample: t.sample || "",
      reportTime: t.reportTime || "",
      price: toNumber(t.price),
      displayOrder: index + 1
    });
  });
  return out;
}

/** Money maths in one place so the booking screen, bill and reports agree. */
export function priceBooking({ tests = [], collectionCharge = 0, discount = 0, paidAmount = 0 } = {}) {
  const rows = uniqueTests(tests);
  const subtotal = rows.reduce((sum, t) => sum + toNumber(t.price), 0);
  const charge = toNumber(collectionCharge);
  const off = Math.min(toNumber(discount), subtotal + charge);
  const totalAmount = Math.max(subtotal + charge - off, 0);
  const paid = Math.min(Math.max(toNumber(paidAmount), 0), totalAmount);
  const balanceDue = Math.max(totalAmount - paid, 0);
  return {
    tests: rows, subtotal, collectionCharge: charge, discount: off,
    totalAmount, paidAmount: paid, balanceDue,
    paymentStatus: balanceDue === 0 && totalAmount > 0 ? "Paid" : paid > 0 ? "Partial" : "Pending"
  };
}

export function normalizeBooking(id, data = {}) {
  const tests = Array.isArray(data.tests) ? data.tests : [];
  return {
    id,
    bookingId: data.bookingId || id,
    billNo: data.billNo || data.bookingId || id,
    patientId: data.patientId || "",
    patientUid: data.patientUid || "",
    patientName: data.patientName || "",
    phone: data.phone || "",
    whatsapp: data.whatsapp || data.phone || "",
    email: data.email || "",
    age: data.age || "",
    gender: data.gender || "",
    address: data.address || "",
    refBy: data.refBy || data.referringDoctor || "",
    branchId: data.branchId || "",
    collectionType: data.collectionType || "Lab Visit",
    scheduledAt: data.scheduledAt || "",
    tests,
    testNames: tests.map((t) => t.name).filter(Boolean).join(", "),
    subtotal: toNumber(data.subtotal),
    collectionCharge: toNumber(data.collectionCharge),
    discount: toNumber(data.discount),
    totalAmount: toNumber(data.totalAmount),
    paidAmount: toNumber(data.paidAmount),
    balanceDue: toNumber(data.balanceDue),
    paymentMode: data.paymentMode || "Cash",
    paymentStatus: data.paymentStatus || "Pending",
    bookingStatus: data.bookingStatus || data.status || "New",
    source: data.source || "walkin",
    remarks: data.remarks || "",
    collectedBy: data.collectedBy || "",
    createdByUid: data.createdByUid || "",
    createdByName: data.createdByName || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    labId: data.labId || ""
  };
}

/**
 * Create a walk-in / reception booking. Registers or reuses the patient by
 * phone so the patient master stays clean, then writes one booking document
 * plus one payment row when money changed hands.
 */
export async function createBooking(input, { actor = {} } = {}) {
  const priced = priceBooking(input);
  if (!priced.tests.length) throw new Error("Add at least one test to the booking.");

  const patient = input.patientId
    ? { patientId: input.patientId, name: normalizeName(input.patientName), phone: normalizePhone(input.phone) }
    : await upsertPatientByPhone({
        name: input.patientName, phone: input.phone, email: input.email,
        age: input.age, gender: input.gender, address: input.address,
        city: input.city, pincode: input.pincode, uid: input.patientUid,
        branchId: input.branchId, referredBy: input.refBy
      });

  const bookingId = input.bookingId || await safeNextId("booking");
  const name = normalizeName(input.patientName || patient.name);
  const phone = normalizePhone(input.phone || patient.phone);

  const payload = withLabId(clean({
    bookingId,
    billNo: bookingId,
    patientId: patient.patientId,
    patientUid: input.patientUid || patient.uid || "",
    patientName: name,
    phone,
    whatsapp: normalizePhone(input.whatsapp || phone),
    email: cleanEmail(input.email),
    age: String(input.age ?? "").trim(),
    gender: input.gender || "",
    address: input.address || "",
    refBy: input.refBy || "",
    branchId: input.branchId || "",
    collectionType: input.collectionType || "Lab Visit",
    scheduledAt: input.scheduledAt || "",
    ...priced,
    paymentMode: input.paymentMode || "Cash",
    bookingStatus: input.bookingStatus || "New",
    status: input.bookingStatus || "New",
    source: input.source || "walkin",
    remarks: input.remarks || "",
    collectedBy: input.collectedBy || "",
    createdByUid: actor.uid || "",
    createdByName: actor.name || "",
    dayKey: dateKey(),
    searchTokens: buildSearchTokens(name, phone, bookingId, priced.tests.map((t) => t.name).join(" ")),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }));

  await setDoc(docRef("bookings", bookingId), payload);

  if (priced.paidAmount > 0) {
    await recordPayment({
      bookingId, patientId: patient.patientId, patientUid: payload.patientUid,
      amount: priced.paidAmount, mode: payload.paymentMode, branchId: payload.branchId
    }, { actor });
  }
  await recordVisit(patient.patientId, priced.totalAmount).catch(() => {});

  logAudit(AUDIT.BOOKING_CREATED, {
    entityType: "booking", entityId: bookingId,
    summary: `${name} - ${priced.tests.length} test(s), ₹${priced.totalAmount}`
  });

  return normalizeBooking(bookingId, payload);
}

export async function getBooking(bookingId) {
  const snap = await getDoc(docRef("bookings", bookingId));
  return snap.exists() ? normalizeBooking(snap.id, snap.data()) : null;
}

export async function updateBooking(bookingId, patch, { actor = {} } = {}) {
  const before = await getBooking(bookingId);
  if (!before) throw new Error("Booking not found.");

  const merged = { ...before, ...patch };
  const priced = patch.tests || patch.discount !== undefined || patch.paidAmount !== undefined ||
                 patch.collectionCharge !== undefined
    ? priceBooking(merged)
    : {};

  const payload = clean({
    ...patch,
    ...priced,
    patientName: patch.patientName ? normalizeName(patch.patientName) : undefined,
    phone: patch.phone ? normalizePhone(patch.phone) : undefined,
    updatedAt: serverTimestamp(),
    updatedByUid: actor.uid || "",
    updatedByName: actor.name || ""
  });

  await updateDoc(docRef("bookings", bookingId), payload);
  logAudit(AUDIT.BOOKING_UPDATED, {
    entityType: "booking", entityId: bookingId,
    summary: `Updated booking ${bookingId}`,
    before: diffFields(before, { ...before, ...payload },
      ["totalAmount", "paidAmount", "balanceDue", "paymentStatus", "bookingStatus", "discount"])
  });
  return { ...before, ...payload };
}

export async function setBookingStatus(bookingId, status, { actor = {} } = {}) {
  await updateDoc(docRef("bookings", bookingId), {
    bookingStatus: status, status, updatedAt: serverTimestamp(),
    updatedByName: actor.name || ""
  });
  logAudit(AUDIT.BOOKING_UPDATED, {
    entityType: "booking", entityId: bookingId, summary: `Status -> ${status}`
  });
}

export async function deleteBooking(bookingId) {
  const before = await getBooking(bookingId);
  await deleteDoc(docRef("bookings", bookingId));
  logAudit(AUDIT.BOOKING_DELETED, {
    entityType: "booking", entityId: bookingId,
    summary: `Deleted booking for ${before?.patientName || bookingId}`, before
  });
}

export async function listBookings({ max = 400, status = "" } = {}) {
  const clauses = [col("bookings")];
  if (status) clauses.push(where("bookingStatus", "==", status));
  clauses.push(orderBy("createdAt", "desc"), limit(max));
  const snap = await getDocs(query(...clauses));
  return snap.docs.map((d) => normalizeBooking(d.id, d.data()));
}

export async function listTodayBookings() {
  const snap = await getDocs(query(col("bookings"), where("dayKey", "==", dateKey()), limit(500)));
  return sortByDateDesc(snap.docs.map((d) => normalizeBooking(d.id, d.data())));
}

export async function listPatientBookings(patientUid, { max = 100 } = {}) {
  if (!patientUid) return [];
  const snap = await getDocs(query(
    col("bookings"), where("patientUid", "==", patientUid), orderBy("createdAt", "desc"), limit(max)
  ));
  return snap.docs.map((d) => normalizeBooking(d.id, d.data()));
}

export function listenBookings(callback, onError) {
  return onSnapshot(
    query(col("bookings"), orderBy("createdAt", "desc"), limit(300)),
    (snap) => callback(snap.docs.map((d) => normalizeBooking(d.id, d.data()))),
    onError
  );
}

export async function searchBookings(text, { max = 50 } = {}) {
  const term = String(text || "").trim().toLowerCase();
  if (!term) return listBookings({ max });
  const snap = await getDocs(query(col("bookings"), where("searchTokens", "array-contains", term), limit(max)));
  return sortByDateDesc(snap.docs.map((d) => normalizeBooking(d.id, d.data())));
}

// ---------- payments ----------

export async function recordPayment(input, { actor = {} } = {}) {
  const amount = toNumber(input.amount);
  if (amount <= 0) throw new Error("Payment amount must be greater than zero.");
  const payload = withLabId(clean({
    bookingId: input.bookingId || "",
    patientId: input.patientId || "",
    patientUid: input.patientUid || "",
    amount,
    mode: input.mode || "Cash",
    reference: input.reference || "",
    branchId: input.branchId || "",
    note: input.note || "",
    receivedByUid: actor.uid || "",
    receivedByName: actor.name || "",
    dayKey: dateKey(),
    paidAt: serverTimestamp()
  }));
  const ref = await addDoc(col("payments"), payload);
  logAudit(AUDIT.PAYMENT_RECEIVED, {
    entityType: "payment", entityId: ref.id,
    summary: `₹${amount} by ${payload.mode} for ${payload.bookingId || "-"}`
  });
  return { id: ref.id, ...payload };
}

/** Take a further payment against an existing booking and re-derive balance. */
export async function collectBalance(bookingId, { amount, mode = "Cash", reference = "" }, { actor = {} } = {}) {
  const booking = await getBooking(bookingId);
  if (!booking) throw new Error("Booking not found.");
  const paid = Math.min(booking.paidAmount + toNumber(amount), booking.totalAmount);
  const balanceDue = Math.max(booking.totalAmount - paid, 0);

  await recordPayment({
    bookingId, patientId: booking.patientId, patientUid: booking.patientUid,
    amount, mode, reference, branchId: booking.branchId
  }, { actor });

  await updateDoc(docRef("bookings", bookingId), {
    paidAmount: paid,
    balanceDue,
    paymentMode: mode,
    paymentStatus: balanceDue === 0 ? "Paid" : "Partial",
    updatedAt: serverTimestamp()
  });
  return { paidAmount: paid, balanceDue, paymentStatus: balanceDue === 0 ? "Paid" : "Partial" };
}

export async function listPayments({ from = "", to = "", max = 1000 } = {}) {
  const snap = await getDocs(query(col("payments"), orderBy("paidAt", "desc"), limit(max)));
  let rows = snapshotRows(snap);
  if (from) rows = rows.filter((r) => (r.dayKey || "") >= from);
  if (to) rows = rows.filter((r) => (r.dayKey || "") <= to);
  return rows;
}
