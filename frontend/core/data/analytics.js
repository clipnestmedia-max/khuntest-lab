// Financial reporting and business analytics (spec sections 18 and 19).
//
// Everything here is computed client-side from the laboratory's own bookings
// and payments. That keeps it correct with zero extra infrastructure at the
// scale a diagnostic centre actually runs at (hundreds of bookings a day); if
// a customer outgrows it, the same shapes can be produced by a scheduled
// aggregation without changing a single caller.
import { getDocs, query, where, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col } from "../tenant.js";
import { snapshotRows, toNumber, dateKey, bestTime } from "./helpers.js";

function inRange(row, from, to, field = "dayKey") {
  // Legacy bookings/payments have no dayKey - fall back to any date they carry.
  let key = row[field];
  if (!key) {
    const ms = bestTime(row);
    key = ms ? dateKey(new Date(ms)) : "";
  }
  if (!key) return !from && !to;   // undateable row: only include an unbounded range
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

export function shiftDays(days, base = new Date()) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

export function monthStart(base = new Date()) {
  const d = new Date(base.getFullYear(), base.getMonth(), 1);
  return dateKey(d);
}

export function yearStart(base = new Date()) {
  return dateKey(new Date(base.getFullYear(), 0, 1));
}

export const RANGES = Object.freeze({
  today: () => ({ from: dateKey(), to: dateKey(), label: "Today" }),
  week: () => ({ from: shiftDays(-6), to: dateKey(), label: "Last 7 days" }),
  month: () => ({ from: monthStart(), to: dateKey(), label: "This month" }),
  year: () => ({ from: yearStart(), to: dateKey(), label: "This year" })
});

/** Pull the raw rows once; every report below is derived from these. */
export async function loadFinanceData({ from = "", to = "", max = 3000 } = {}) {
  // No orderBy: legacy rows without the ordered field would be dropped.
  const [bookingSnap, paymentSnap, expenseSnap] = await Promise.all([
    getDocs(query(col("bookings"), limit(max))),
    getDocs(query(col("payments"), limit(max))).catch(() => ({ docs: [] })),
    getDocs(query(col("expenses"), limit(max))).catch(() => ({ docs: [] }))
  ]);
  return {
    bookings: snapshotRows(bookingSnap).filter((r) => inRange(r, from, to)),
    payments: snapshotRows(paymentSnap).filter((r) => inRange(r, from, to)),
    expenses: (expenseSnap.docs || []).map((d) => ({ id: d.id, ...d.data() })).filter((r) => inRange(r, from, to))
  };
}

/** Headline numbers for the finance screen. */
export function revenueSummary({ bookings = [], payments = [], expenses = [] }) {
  const billed = bookings.reduce((s, b) => s + toNumber(b.totalAmount), 0);
  const collected = payments.reduce((s, p) => s + toNumber(p.amount), 0);
  const discount = bookings.reduce((s, b) => s + toNumber(b.discount), 0);
  const outstanding = bookings.reduce((s, b) => s + toNumber(b.balanceDue), 0);
  const spend = expenses.reduce((s, e) => s + toNumber(e.amount), 0);
  const homeCollection = bookings
    .filter((b) => String(b.collectionType || "").toLowerCase().includes("home"))
    .reduce((s, b) => s + toNumber(b.totalAmount), 0);

  const byMode = {};
  payments.forEach((p) => {
    const mode = p.mode || "Cash";
    byMode[mode] = (byMode[mode] || 0) + toNumber(p.amount);
  });

  return {
    billed, collected, discount, outstanding, expenses: spend,
    netRevenue: collected - spend,
    homeCollectionRevenue: homeCollection,
    bookingCount: bookings.length,
    averageBill: bookings.length ? Math.round(billed / bookings.length) : 0,
    cash: byMode.Cash || 0,
    upi: byMode.UPI || 0,
    card: byMode.Card || 0,
    online: (byMode.Online || 0) + (byMode["Net Banking"] || 0),
    byMode
  };
}

/** Day-by-day series for a chart or an export. */
export function revenueByDay({ bookings = [], payments = [] }) {
  const map = new Map();
  const touch = (key) => {
    if (!map.has(key)) map.set(key, { date: key, billed: 0, collected: 0, bookings: 0 });
    return map.get(key);
  };
  bookings.forEach((b) => {
    const row = touch(b.dayKey || dateKey(b.createdAt));
    row.billed += toNumber(b.totalAmount);
    row.bookings += 1;
  });
  payments.forEach((p) => {
    touch(p.dayKey || dateKey(p.paidAt)).collected += toNumber(p.amount);
  });
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

/** Test-wise revenue - which tests actually pay the bills. */
export function testWiseRevenue(bookings = []) {
  const map = new Map();
  bookings.forEach((b) => {
    (b.tests || []).forEach((t) => {
      const key = t.testCode || t.testId || t.name;
      if (!key) return;
      if (!map.has(key)) map.set(key, { testCode: t.testCode || "", name: t.name || key, count: 0, revenue: 0 });
      const row = map.get(key);
      row.count += 1;
      row.revenue += toNumber(t.price);
    });
  });
  return Array.from(map.values());
}

export function mostBookedTests(bookings, topN = 10) {
  return testWiseRevenue(bookings).sort((a, b) => b.count - a.count).slice(0, topN);
}

export function highestRevenueTests(bookings, topN = 10) {
  return testWiseRevenue(bookings).sort((a, b) => b.revenue - a.revenue).slice(0, topN);
}

/**
 * New vs returning patients in the window. A patient is "returning" when the
 * same patientId appears on an earlier booking than the one being counted.
 */
export function patientMix(bookings = []) {
  const firstSeen = new Map();
  const sorted = [...bookings].sort((a, b) => (a.dayKey || "").localeCompare(b.dayKey || ""));
  let newCount = 0;
  let returning = 0;
  sorted.forEach((b) => {
    const key = b.patientId || b.phone;
    if (!key) return;
    if (firstSeen.has(key)) returning += 1;
    else { firstSeen.set(key, b.dayKey); newCount += 1; }
  });
  return { newPatients: newCount, returningPatients: returning, uniquePatients: firstSeen.size };
}

export function collectionMix(bookings = []) {
  const home = bookings.filter((b) => String(b.collectionType || "").toLowerCase().includes("home")).length;
  const total = bookings.length || 1;
  return { home, lab: bookings.length - home, homePercent: Math.round((home / total) * 100) };
}

export function outstandingList(bookings = []) {
  return bookings
    .filter((b) => toNumber(b.balanceDue) > 0)
    .map((b) => ({
      bookingId: b.bookingId || b.id, patientName: b.patientName, phone: b.phone,
      totalAmount: toNumber(b.totalAmount), paidAmount: toNumber(b.paidAmount),
      balanceDue: toNumber(b.balanceDue), date: b.dayKey || dateKey(b.createdAt)
    }))
    .sort((a, b) => b.balanceDue - a.balanceDue);
}

/** Everything the dashboard's top strip needs, in one pass. */
export async function dashboardStats() {
  const today = dateKey();
  // No orderBy / no dayKey filter on the query: legacy KhunTest rows carry
  // neither field and would be excluded. Read broadly and filter in JS.
  const [bookingSnap, reportSnap, paymentSnap] = await Promise.all([
    getDocs(query(col("bookings"), limit(2000))),
    getDocs(query(col("reports"), limit(2000))),
    getDocs(query(col("payments"), limit(2000))).catch(() => ({ docs: [] }))
  ]);
  const allBookings = snapshotRows(bookingSnap);
  const reports = (reportSnap.docs || []).map((d) => ({ id: d.id, ...d.data() }))
    .map((r) => ({ reportStatus: legacyReportStatus(r) }));
  const payments = (paymentSnap.docs || []).map((d) => ({ id: d.id, ...d.data() }));

  const isToday = (row, dateFields) => {
    if (row.dayKey === today) return true;
    for (const f of dateFields) if (row[f] && dateKey(row[f]) === today) return true;
    const ms = bestTime(row);
    return Boolean(ms) && dateKey(new Date(ms)) === today;
  };
  const bookings = allBookings.filter((b) => isToday(b, ["createdAt", "collDate", "collectionDate"]));
  const todayPayments = payments.filter((p) => isToday(p, ["paidAt", "createdAt", "date"]));

  return {
    todayBookings: bookings.length,
    todayRevenue: todayPayments.reduce((s, p) => s + toNumber(p.amount ?? p.amountPaid), 0),
    todayBilled: bookings.reduce((s, b) => s + toNumber(b.totalAmount ?? b.grossTotal), 0),
    pendingSamples: bookings.filter((b) => ["New", "Sample Pending", ""].includes(b.bookingStatus || b.status || "")).length,
    pendingReports: reports.filter((r) => r.reportStatus !== "Final").length,
    completedReports: reports.filter((r) => r.reportStatus === "Final").length,
    outstanding: allBookings.reduce((s, b) => s + toNumber(
      b.balanceDue ?? b.dueAmount ?? Math.max(toNumber(b.totalAmount) - toNumber(b.paidAmount), 0)), 0)
  };
}

/** Map a legacy status string onto the platform's "Final"/"Draft". */
function legacyReportStatus(r) {
  const raw = String(r.reportStatus || r.status || "").toLowerCase();
  if (["released", "final", "completed", "complete", "approved", "amended"].includes(raw)
      || r.reportReleased === true) return "Final";
  return raw ? "Draft" : "Draft";
}

// ---------- exports ----------

export function toCsv(rows, columns) {
  const cell = (value) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = columns.map((c) => cell(c.label)).join(",");
  const body = rows.map((row) => columns.map((c) => cell(
    typeof c.value === "function" ? c.value(row) : row[c.key]
  )).join(",")).join("\n");
  return `${header}\n${body}`;
}

/** Download a CSV. Excel opens this natively; the BOM keeps ₹ and names intact. */
export function downloadCsv(filename, csv) {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
