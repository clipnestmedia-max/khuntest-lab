// Laboratory admin panel - boot, navigation, permissions and the read-only
// screens. The two heavily interactive screens live in their own modules
// (booking-screen.js, report-entry.js) and settings in settings-screen.js.
import { requireStaff, logout, sessionCan, sessionCanWrite } from "../core/session.js";
import { getLabId } from "../core/tenant.js";
import { bootBranding } from "../core/branding.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P, roleLabel, STAFF_ROLES } from "../core/roles.js";
import * as Bookings from "../core/data/bookings.js";
import * as Patients from "../core/data/patients.js";
import * as Reports from "../core/data/reports.js";
import * as Tests from "../core/data/tests.js";
import * as HomeCollections from "../core/data/home-collections.js";
import * as Staff from "../core/data/staff.js";
import * as Analytics from "../core/data/analytics.js";
import { formatDate, formatDateTime, rupees, dateKey } from "../core/data/helpers.js";
import { col } from "../core/tenant.js";
import { getDocs, query, orderBy, limit } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { sendBookingConfirmation, sendBill, sendPaymentReminder } from "../core/whatsapp.js";
import {
  $, $$, esc, toastOk, toastError, reportError, openModal, confirmAction, renderRows,
  setupTabs, setupMobileNav, setBusy, readForm, pill, debounce, progressBar
} from "../core/ui.js";
import { initBookingScreen } from "./booking-screen.js";
import { printReceipt } from "./receipt.js";
import { initReportEntry, openReportFor, refreshBookingList } from "./report-entry.js";
import { initSettingsScreens } from "./settings-screen.js";
import { initMedicalScreen, renderMedical } from "./medical-screen.js";
import { initMachineResultsScreen, renderMachineResults } from "./machine-results-screen.js";

const TAB_TITLES = {
  dashboard: "Dashboard", booking: "New Booking", bookings: "Bookings",
  reportEntry: "Report Entry", reports: "Reports", patients: "Patients",
  homeCollection: "Home Collection", onlineBookings: "Online Requests",
  catalogue: "Test Catalogue", finance: "Finance", analytics: "Analytics",
  staff: "Staff", branding: "Branding", settings: "Settings",
  medical: "Medical Rules", machineResults: "Machine Results", audit: "Audit Log"
};

// ---------- boot ----------

// Declared before the boot sequence on purpose. setupTabs() below shows the
// default tab synchronously, which calls loadTab() -> renderDashboard(), which
// reads `cache`. Declaring these further down left them in the temporal dead
// zone and every first paint died with "Cannot access 'cache' before
// initialization" - taking the dashboard, the tab router and the report-entry
// booking list with it.
const cache = {
  bookings: null, reports: null, patients: null, tests: null,
  homeCollections: null, staff: null, audit: null
};
const loadedTabs = new Set();

export const session = await requireStaff();
export const branding = await bootBranding(getLabId());

$("#labIdTag").textContent = getLabId();
$("#whoami").innerHTML = `<b>${esc(session.name || session.email)}</b><br>${esc(roleLabel(session.role))}`;
$("#logoutBtn").addEventListener("click", async () => { await logout(); location.replace("admin-login.html"); });
$("#refreshBtn").addEventListener("click", () => refreshActive(true));
setupMobileNav();
applyPermissions();
renderSubscriptionBanner();

const tabs = setupTabs({
  defaultTab: "dashboard",
  onChange: (tab) => {
    $("#pageTitle").textContent = TAB_TITLES[tab] || tab;
    loadTab(tab);
  }
});

initBookingScreen({ session, branding, onSaved: () => {
  invalidate();
  refreshBookingList().catch(() => {});
  tabs.show("bookings");
} });
initReportEntry({ session, branding, onChanged: () => invalidate() });
initSettingsScreens({ session, branding });
initMedicalScreen({ session, branding });
initMachineResultsScreen({ session, branding });

// ---------- permissions ----------

/**
 * Hide what this role may not do. firestore.rules enforces the same matrix
 * server-side, so this is UX, not security - a receptionist who edits the DOM
 * still cannot approve a report.
 */
function applyPermissions() {
  $$("[data-perm]").forEach((el) => {
    if (!sessionCan(el.dataset.perm, session)) el.remove();
  });
  if (session.subscription?.readOnly) {
    $$("button").forEach((b) => {
      const perm = b.dataset.perm || "";
      if (perm && !sessionCanWrite(perm, session)) b.disabled = true;
    });
  }
}

function renderSubscriptionBanner() {
  const sub = session.subscription;
  if (!sub?.message) return;
  const kind = sub.state === "expired" || sub.state === "suspended" ? "danger" : "warn";
  $("#subscriptionBanner").innerHTML =
    `<div class="notice ${kind}"><b>${esc(sub.message)}</b>${
      sub.readOnly ? " Your data is safe and fully readable — only new entries are paused." : ""}</div>`;
}

// ---------- shared caches ----------


function invalidate() {
  Object.keys(cache).forEach((k) => { cache[k] = null; });
  loadedTabs.clear();
  loadTab(document.querySelector("[data-tab].active")?.dataset.tab || "dashboard");
}

function refreshActive(force = false) {
  const tab = document.querySelector("[data-tab].active")?.dataset.tab || "dashboard";
  if (force) { loadedTabs.delete(tab); Object.keys(cache).forEach((k) => { cache[k] = null; }); }
  loadTab(tab);
}

async function loadTab(tab) {
  try {
    switch (tab) {
      case "dashboard": return renderDashboard();
      // Re-read the bookings each time, so one created moments ago is here.
      case "reportEntry": return refreshBookingList();
      case "bookings": return renderBookings();
      case "reports": return renderReports();
      case "patients": return renderPatients();
      case "homeCollection": return renderHomeCollections();
      case "onlineBookings": return renderOnlineBookings();
      case "catalogue": return renderCatalogue();
      case "finance": return renderFinance();
      case "analytics": return renderAnalytics();
      case "staff": return renderStaff();
      case "medical": return renderMedical();
      case "machineResults": return renderMachineResults();
      case "audit": return renderAudit();
      default: return undefined;
    }
  } catch (error) {
    reportError(error, `Could not load ${TAB_TITLES[tab] || tab}.`);
  }
}

async function bookings(force = false) {
  if (!cache.bookings || force) cache.bookings = await Bookings.listBookings({ max: 600 });
  return cache.bookings;
}
async function reports(force = false) {
  if (!cache.reports || force) cache.reports = await Reports.listReports({ max: 400 });
  return cache.reports;
}
async function tests(force = false) {
  if (!cache.tests || force) cache.tests = await Tests.loadTests({ activeOnly: false, force });
  return cache.tests;
}

// ---------- dashboard ----------

async function renderDashboard() {
  const [stats, todayRows, reportRows, hcRows] = await Promise.all([
    Analytics.dashboardStats(),
    Bookings.listTodayBookings(),
    reports(),
    HomeCollections.listHomeCollections({ max: 200 }).catch(() => [])
  ]);

  $("#dashStats").innerHTML = [
    ["Today's bookings", stats.todayBookings, "", "info"],
    ["Collected today", rupees(stats.todayRevenue), `billed ${rupees(stats.todayBilled)}`, "ok"],
    ["Pending samples", stats.pendingSamples, "awaiting collection", stats.pendingSamples ? "warn" : ""],
    ["Pending reports", stats.pendingReports, "not yet released", stats.pendingReports ? "warn" : ""],
    ["Completed reports", stats.completedReports, "released", "ok"],
    ["Outstanding", rupees(stats.outstanding), "unpaid balances", stats.outstanding ? "danger" : ""],
    ["Home collections", hcRows.filter((r) => !["Report Ready", "Cancelled"].includes(r.status)).length, "in progress", "info"],
    ["Patients today", new Set(todayRows.map((b) => b.patientId)).size, "unique", ""]
  ].map(([label, value, hint, kind]) => `
    <div class="stat ${kind}">
      <div class="label">${esc(label)}</div><div class="value">${esc(value)}</div>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}
    </div>`).join("");

  renderRows("dashBookingsBody", todayRows.slice(0, 12), (b) => `
    <tr><td class="mono">${esc(b.billNo)}</td><td>${esc(b.patientName)}</td>
      <td class="small">${esc(b.testNames.slice(0, 44))}${b.testNames.length > 44 ? "…" : ""}</td>
      <td class="right mono">${esc(rupees(b.totalAmount))}</td>
      <td>${pill(b.bookingStatus)}</td></tr>`,
    { colspan: 5, empty: "No bookings today yet." });

  const pending = reportRows.filter((r) => r.reportStatus !== "Final").slice(0, 12);
  renderRows("dashPendingBody", pending, (r) => {
    const p = Reports.gridProgress(r.groups);
    return `<tr><td class="mono">${esc(r.billNo)}</td><td>${esc(r.patientName)}</td>
      <td>${progressBar(p.entered, p.total)} <span class="small muted">${p.entered}/${p.total}</span></td>
      <td class="actions"><button class="btn btn-sm btn-outline" data-open-report="${esc(r.reportId)}" type="button">Open</button></td></tr>`;
  }, { colspan: 4, empty: "No reports pending." });

  const counts = HomeCollections.pipelineCounts(hcRows);
  $("#hcPipeline").innerHTML = HomeCollections.HC_STATUS.map((status) => `
    <div class="stat ${counts[status] ? "info" : ""}">
      <div class="label">${esc(status)}</div><div class="value">${counts[status]}</div>
    </div>`).join("");

  const activeHc = hcRows.filter((r) => !["Report Ready", "Cancelled"].includes(r.status)).length;
  const badge = $("#hcBadge");
  if (badge) { badge.textContent = activeHc; badge.classList.toggle("hidden", activeHc === 0); }
}

// ---------- bookings ----------

let bookingFilter = { text: "", status: "" };

async function renderBookings() {
  const rows = await bookings();
  const select = $("#bookingStatusFilter");
  if (select.options.length <= 1) {
    Bookings.BOOKING_STATUS.forEach((s) => select.add(new Option(s, s)));
  }
  const filtered = rows.filter((b) => {
    if (bookingFilter.status && b.bookingStatus !== bookingFilter.status) return false;
    if (!bookingFilter.text) return true;
    const t = bookingFilter.text;
    return [b.billNo, b.patientName, b.phone, b.testNames].some((v) => String(v || "").toLowerCase().includes(t));
  });

  renderRows("bookingsBody", filtered, (b) => `
    <tr>
      <td class="mono">${esc(b.billNo)}<br><span class="small muted">${esc(formatDate(b.createdAt))}</span></td>
      <td>${esc(b.patientName)}<br><span class="small muted">${esc(b.patientId)}</span></td>
      <td class="mono">${esc(b.phone)}</td>
      <td class="small">${esc(b.testNames.slice(0, 50))}${b.testNames.length > 50 ? "…" : ""}</td>
      <td class="right mono">${esc(rupees(b.totalAmount))}</td>
      <td class="right mono">${b.balanceDue > 0 ? `<b style="color:var(--danger)">${esc(rupees(b.balanceDue))}</b>` : "—"}</td>
      <td>${pill(b.paymentStatus)}</td>
      <td>${pill(b.bookingStatus)}</td>
      <td class="actions">
        <button class="btn btn-sm btn-outline" data-open-report="${esc(b.bookingId)}" type="button">Report</button>
        <button class="btn btn-sm btn-outline" data-print-report="${esc(b.bookingId)}" type="button">Print Report</button>
        <button class="btn btn-sm btn-ghost" data-bill="${esc(b.bookingId)}" type="button">Bill</button>
        <button class="btn btn-sm btn-green" data-wa="${esc(b.bookingId)}" type="button">WhatsApp</button>
        ${b.balanceDue > 0 && sessionCanWrite(P.PAYMENT_RECEIVE, session)
          ? `<button class="btn btn-sm" data-collect="${esc(b.bookingId)}" type="button">Collect</button>` : ""}
      </td>
    </tr>`, { colspan: 9, empty: "No bookings match this filter." });
}

$("#bookingSearch").addEventListener("input", debounce((e) => {
  bookingFilter.text = e.target.value.trim().toLowerCase(); renderBookings();
}));
$("#bookingStatusFilter").addEventListener("change", (e) => { bookingFilter.status = e.target.value; renderBookings(); });

$("#exportBookingsBtn").addEventListener("click", async () => {
  const rows = await bookings();
  Analytics.downloadCsv(`bookings-${getLabId()}-${dateKey()}`, Analytics.toCsv(rows, [
    { label: "Bill No", key: "billNo" }, { label: "Date", value: (r) => formatDate(r.createdAt) },
    { label: "Patient ID", key: "patientId" }, { label: "Patient", key: "patientName" },
    { label: "Phone", key: "phone" }, { label: "Tests", key: "testNames" },
    { label: "Subtotal", key: "subtotal" }, { label: "Discount", key: "discount" },
    { label: "Total", key: "totalAmount" }, { label: "Paid", key: "paidAmount" },
    { label: "Balance", key: "balanceDue" }, { label: "Payment", key: "paymentStatus" },
    { label: "Mode", key: "paymentMode" }, { label: "Status", key: "bookingStatus" }
  ]));
  toastOk("Bookings exported.");
});

/**
 * What can be sent to a patient about one booking. Three actions rather than
 * three buttons on every row: the row is already busy, and which one is
 * appropriate depends on where the booking has got to.
 */
async function openWhatsAppDialog(bookingId) {
  const booking = await Bookings.getBooking(bookingId);
  if (!booking) return toastError("Booking not found.");
  if (!(booking.whatsapp || booking.phone)) {
    return toastError(`${booking.patientName} has no phone number on file.`);
  }

  const report = await Reports.getReportByBooking(bookingId).catch(() => null);
  const released = report?.reportStatus === "Final";
  const owed = booking.balanceDue > 0;

  const { element, close } = openModal({
    title: `Send to ${booking.patientName}`,
    body: `
      <p class="small muted">
        To ${esc(booking.whatsapp || booking.phone)} · bill ${esc(booking.billNo)} ·
        ${esc(rupees(booking.totalAmount))}${owed ? ` · <b style="color:var(--danger)">${esc(rupees(booking.balanceDue))} due</b>` : " · paid"}
      </p>
      <div class="stack">
        <button class="btn btn-outline btn-block" data-send="confirmation" type="button">
          Booking confirmation
          <span class="small muted" style="font-weight:400;">— what was booked and when</span>
        </button>
        <button class="btn btn-outline btn-block" data-send="bill" type="button">
          ${owed ? "Bill (payment pending)" : "Payment receipt"}
          <span class="small muted" style="font-weight:400;">— itemised tests and totals</span>
        </button>
        ${owed ? `<button class="btn btn-outline btn-block" data-send="reminder" type="button">
          Payment reminder
          <span class="small muted" style="font-weight:400;">— just the outstanding amount</span>
        </button>` : ""}
        <button class="btn btn-block ${released ? "btn-green" : "btn-outline"}" data-send="report" type="button"
          ${released ? "" : "disabled"}>
          Report
          <span class="small muted" style="font-weight:400;">— ${released
            ? "secure link to the released report"
            : "not released yet"}</span>
        </button>
      </div>`,
    footer: `<button class="btn btn-outline" data-act="close" type="button">Close</button>`
  });

  element.querySelector('[data-act="close"]').addEventListener("click", close);
  element.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-send]");
    if (!button || button.disabled) return;
    setBusy(button, true, "Opening WhatsApp...");
    try {
      let result;
      if (button.dataset.send === "confirmation") {
        result = await sendBookingConfirmation({ booking, branding });
      } else if (button.dataset.send === "bill") {
        result = await sendBill({ booking, branding });
      } else if (button.dataset.send === "reminder") {
        result = await sendPaymentReminder({ booking, branding });
      } else {
        close();
        return openReportFor(bookingId, { share: true });
      }
      toastOk(result.delivered ? "Sent on WhatsApp." : (result.note || "WhatsApp opened."));
      close();
    } catch (error) {
      reportError(error, "Could not open WhatsApp.");
      setBusy(button, false);
    }
  });
}

async function openCollectDialog(bookingId) {
  const booking = await Bookings.getBooking(bookingId);
  if (!booking) return toastError("Booking not found.");
  const { element, close } = openModal({
    title: `Collect balance — ${booking.billNo}`,
    body: `<p class="small muted">${esc(booking.patientName)} · total ${esc(rupees(booking.totalAmount))} · paid ${esc(rupees(booking.paidAmount))}</p>
      <label class="field"><span>Amount to collect (₹)</span>
        <input id="cAmount" type="number" min="1" max="${booking.balanceDue}" value="${booking.balanceDue}"></label>
      <label class="field"><span>Mode</span><select id="cMode">
        ${Bookings.PAYMENT_MODES.filter((m) => m !== "Pay Later").map((m) => `<option>${esc(m)}</option>`).join("")}
      </select></label>
      <label class="field"><span>Reference (UPI ref, card last 4)</span><input id="cRef"></label>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn btn-green" data-act="save" type="button">Record payment</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      await Bookings.collectBalance(bookingId, {
        amount: Number(element.querySelector("#cAmount").value),
        mode: element.querySelector("#cMode").value,
        reference: element.querySelector("#cRef").value
      }, { actor: session });
      toastOk("Payment recorded.");
      close(); cache.bookings = null; renderBookings();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- reports ----------

let reportFilter = { text: "", status: "" };

async function renderReports() {
  const rows = await reports();
  const filtered = rows.filter((r) => {
    if (reportFilter.status && r.reportStatus !== reportFilter.status) return false;
    if (!reportFilter.text) return true;
    const t = reportFilter.text;
    return [r.billNo, r.patientName, r.phone].some((v) => String(v || "").toLowerCase().includes(t));
  });

  renderRows("reportsBody", filtered, (r) => {
    const p = Reports.gridProgress(r.groups);
    return `<tr>
      <td class="mono">${esc(r.billNo)}</td>
      <td>${esc(r.patientName)}<br><span class="small muted">${esc(r.phone)}</span></td>
      <td class="small">${esc((r.groups || []).map((g) => g.testName).join(", ").slice(0, 46))}</td>
      <td>${pill(r.reportStatus)} <span class="small muted">${p.entered}/${p.total}</span></td>
      <td>${esc(formatDate(r.reportingDate) || "—")}</td>
      <td class="actions">
        <button class="btn btn-sm btn-outline" data-open-report="${esc(r.reportId)}" type="button">Open</button>
        <button class="btn btn-sm btn-ghost" data-print-report="${esc(r.reportId)}" type="button">Print</button>
        ${r.reportStatus === "Final" && sessionCan(P.REPORT_SHARE, session)
          ? `<button class="btn btn-sm" data-share-report="${esc(r.reportId)}" type="button">WhatsApp</button>` : ""}
      </td></tr>`;
  }, { colspan: 6, empty: "No reports match this filter." });
}

$("#reportSearch").addEventListener("input", debounce((e) => {
  reportFilter.text = e.target.value.trim().toLowerCase(); renderReports();
}));
$("#reportStatusFilter").addEventListener("change", (e) => { reportFilter.status = e.target.value; renderReports(); });

// ---------- patients ----------

async function renderPatients() {
  const term = $("#patientSearch").value.trim();
  const rows = term ? await Patients.searchPatients(term) : await Patients.listPatients({ max: 300 });
  cache.patients = rows;
  renderRows("patientsBody", rows, (p) => `
    <tr>
      <td class="mono">${esc(p.patientId)}</td>
      <td><b>${esc(p.name)}</b></td>
      <td class="small">${esc(p.phone)}<br><span class="muted">${esc(p.email || "")}</span></td>
      <td>${esc([p.age, p.gender].filter(Boolean).join(" / ") || "—")}</td>
      <td class="right">${p.totalBookings}</td>
      <td class="right mono">${esc(rupees(p.totalSpent))}</td>
      <td>${esc(formatDate(p.lastVisitAt) || "—")}</td>
      <td class="actions">
        <button class="btn btn-sm btn-outline" data-patient-history="${esc(p.patientId)}" type="button">History</button>
        ${sessionCanWrite(P.PATIENT_EDIT, session)
          ? `<button class="btn btn-sm btn-ghost" data-edit-patient="${esc(p.patientId)}" type="button">Edit</button>` : ""}
      </td></tr>`, { colspan: 8, empty: "No patients found." });
}

$("#patientSearch").addEventListener("input", debounce(renderPatients, 320));

const PATIENT_FIELDS = [
  ["name", "Full name"], ["phone", "Mobile"], ["email", "Email"], ["age", "Age"],
  ["gender", "Gender"], ["address", "Address"], ["city", "City"], ["pincode", "PIN code"],
  ["bloodGroup", "Blood group"], ["referredBy", "Referred by"]
];

function patientFormHtml(patient = {}) {
  return `<form id="patientForm"><div class="form-grid">${
    PATIENT_FIELDS.map(([name, label]) => name === "gender"
      ? `<label class="field"><span>Gender</span><select name="gender">
          ${["", "Male", "Female", "Other"].map((g) => `<option ${g === patient.gender ? "selected" : ""}>${g}</option>`).join("")}
        </select></label>`
      : `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(patient[name] || "")}"></label>`
    ).join("")}</div></form>`;
}

function openPatientDialog(patient = null) {
  const { element, close } = openModal({
    title: patient ? `Edit ${patient.name}` : "Add patient",
    wide: true,
    body: patientFormHtml(patient || {}),
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">${patient ? "Save changes" : "Register patient"}</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readForm(element.querySelector("#patientForm"));
      if (patient) await Patients.updatePatient(patient.patientId, data);
      else await Patients.createPatient(data);
      toastOk(patient ? "Patient updated." : "Patient registered.");
      close(); renderPatients();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

$("#addPatientBtn")?.addEventListener("click", () => openPatientDialog(null));

async function openPatientHistory(patientId) {
  const [patient, allBookings] = await Promise.all([Patients.getPatient(patientId), bookings()]);
  const mine = allBookings.filter((b) => b.patientId === patientId);
  openModal({
    title: `${patient?.name || patientId} — history`,
    wide: true,
    body: `
      <div class="grid grid-4" style="margin-bottom:14px;">
        <div class="stat"><div class="label">Patient ID</div><div class="value" style="font-size:1rem;">${esc(patientId)}</div></div>
        <div class="stat"><div class="label">Visits</div><div class="value">${mine.length}</div></div>
        <div class="stat"><div class="label">Total spent</div><div class="value" style="font-size:1.1rem;">${esc(rupees(mine.reduce((s, b) => s + b.totalAmount, 0)))}</div></div>
        <div class="stat ${mine.some((b) => b.balanceDue > 0) ? "danger" : ""}"><div class="label">Outstanding</div>
          <div class="value" style="font-size:1.1rem;">${esc(rupees(mine.reduce((s, b) => s + b.balanceDue, 0)))}</div></div>
      </div>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Bill</th><th>Date</th><th>Tests</th><th class="right">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${mine.length ? mine.map((b) => `
          <tr><td class="mono">${esc(b.billNo)}</td><td>${esc(formatDate(b.createdAt))}</td>
            <td class="small">${esc(b.testNames.slice(0, 40))}</td>
            <td class="right mono">${esc(rupees(b.totalAmount))}</td>
            <td>${pill(b.bookingStatus)}</td>
            <td><button class="btn btn-sm btn-ghost" data-open-report="${esc(b.bookingId)}" type="button">Report</button></td></tr>`).join("")
          : `<tr class="empty-row"><td colspan="6">No bookings yet.</td></tr>`}</tbody>
      </table></div>`
  });
}

// ---------- home collection ----------

async function renderHomeCollections() {
  const rows = await HomeCollections.listHomeCollections({ max: 300 });
  cache.homeCollections = rows;
  const select = $("#hcStatusFilter");
  if (select.options.length <= 1) {
    [...HomeCollections.HC_STATUS, HomeCollections.HC_CANCELLED].forEach((s) => select.add(new Option(s, s)));
  }
  const status = select.value;
  const filtered = status ? rows.filter((r) => r.status === status) : rows;

  renderRows("hcBody", filtered, (r) => `
    <tr>
      <td class="mono">${esc(r.requestId)}</td>
      <td>${esc(r.patientName)}<br><span class="small muted">${esc(r.phone)}</span></td>
      <td class="small">${esc([r.address, r.city, r.pincode].filter(Boolean).join(", ").slice(0, 52))}</td>
      <td class="small">${esc(formatDateTime(r.scheduledAt) || r.slot || "—")}</td>
      <td class="small">${esc(r.assignedToName || "—")}</td>
      <td>${pill(r.status)}</td>
      <td class="actions">
        ${sessionCanWrite(P.HOMECOLLECTION_ASSIGN, session)
          ? `<button class="btn btn-sm btn-outline" data-hc-assign="${esc(r.requestId)}" type="button">Assign</button>` : ""}
        ${sessionCanWrite(P.HOMECOLLECTION_UPDATE, session)
          ? `<button class="btn btn-sm" data-hc-status="${esc(r.requestId)}" type="button">Update status</button>` : ""}
      </td></tr>`, { colspan: 7, empty: "No home collection requests." });
}

$("#hcStatusFilter").addEventListener("change", renderHomeCollections);

async function openAssignDialog(requestId) {
  const executives = await Staff.listCollectionExecutives();
  if (!executives.length) {
    return toastError("Add a Collection Executive under Staff before assigning requests.");
  }
  const { element, close } = openModal({
    title: "Assign collection executive",
    body: `<label class="field"><span>Executive</span><select id="hcExec">
      ${executives.map((e) => `<option value="${esc(e.uid)}">${esc(e.name)} — ${esc(e.phone || "no phone")}</option>`).join("")}
    </select></label>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Assign</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const exec = executives.find((x) => x.uid === element.querySelector("#hcExec").value);
      await HomeCollections.assignExecutive(requestId, exec, { actor: session });
      toastOk(`Assigned to ${exec.name}.`); close(); renderHomeCollections();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

async function openStatusDialog(requestId) {
  const request = cache.homeCollections?.find((r) => r.requestId === requestId)
    || await HomeCollections.getHomeCollection(requestId);
  const options = HomeCollections.nextStatuses(request?.status);
  if (!options.length) return toastError("This request is already at the final status.");
  const { element, close } = openModal({
    title: `Update ${requestId}`,
    body: `<p class="small muted">Currently: <b>${esc(request?.status || "—")}</b></p>
      <label class="field"><span>New status</span><select id="hcNew">
        ${options.map((s) => `<option>${esc(s)}</option>`).join("")}</select></label>
      <label class="field"><span>Note (optional)</span><input id="hcNote"></label>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Update</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      await HomeCollections.setHomeCollectionStatus(requestId,
        element.querySelector("#hcNew").value, { actor: session, note: element.querySelector("#hcNote").value });
      toastOk("Status updated."); close(); renderHomeCollections();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- online bookings ----------

async function renderOnlineBookings() {
  const snap = await getDocs(query(col("onlineBookings"), orderBy("createdAt", "desc"), limit(200)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const pending = rows.filter((r) => ["New", "Pending Confirmation"].includes(r.bookingStatus || "New")).length;
  const badge = $("#obBadge");
  if (badge) { badge.textContent = pending; badge.classList.toggle("hidden", pending === 0); }

  renderRows("onlineBookingsBody", rows, (r) => `
    <tr>
      <td class="mono">${esc(r.bookingId || r.id)}<br><span class="small muted">${esc(formatDate(r.createdAt))}</span></td>
      <td>${esc(r.patientName)}</td>
      <td class="small">${esc(r.phone)}<br><span class="muted">${esc(r.email || "")}</span></td>
      <td class="small">${esc((r.tests || []).map((t) => t.name).join(", ").slice(0, 44))}</td>
      <td class="right mono">${esc(rupees(r.totalAmount))}</td>
      <td class="small">${esc([r.preferredDate, r.preferredTime].filter(Boolean).join(" ") || "—")}<br>
        <span class="muted">${esc(r.collectionType || "")}</span></td>
      <td>${pill(r.bookingStatus || "New")}</td>
      <td class="actions">${sessionCanWrite(P.BOOKING_CREATE, session)
        ? `<button class="btn btn-sm" data-convert="${esc(r.id)}" type="button">Convert to booking</button>` : ""}</td>
    </tr>`, { colspan: 8, empty: "No online requests yet." });
}

async function convertOnlineBooking(id) {
  if (!await confirmAction("Create a lab booking from this online request?")) return;
  try {
    const snap = await getDocs(query(col("onlineBookings"), limit(500)));
    const row = snap.docs.find((d) => d.id === id);
    if (!row) return toastError("Request not found.");
    const data = row.data();
    const booking = await Bookings.createBooking({
      patientName: data.patientName, phone: data.phone, email: data.email,
      age: data.age, gender: data.gender, address: data.address,
      city: data.city, pincode: data.pincode, patientUid: data.patientUid,
      tests: data.tests, collectionCharge: data.collectionCharge,
      discount: data.discount, paidAmount: data.paidAmount,
      paymentMode: data.paymentMode, collectionType: data.collectionType,
      scheduledAt: [data.preferredDate, data.preferredTime].filter(Boolean).join(" "),
      refBy: data.referringDoctor, source: "online"
    }, { actor: session });
    toastOk(`Booking ${booking.billNo} created.`);
    cache.bookings = null;
    renderOnlineBookings();
  } catch (error) { reportError(error); }
}

// ---------- catalogue ----------

async function renderCatalogue() {
  const rows = await tests();
  $("#catalogueCount").textContent = `${rows.length} tests`;
  const categorySelect = $("#catalogueCategory");
  if (categorySelect.options.length <= 1) {
    Tests.categoriesOf(rows).forEach((c) => categorySelect.add(new Option(c, c)));
  }
  const filtered = Tests.searchTests(rows, $("#catalogueSearch").value, categorySelect.value);

  renderRows("catalogueBody", filtered.slice(0, 400), (t) => `
    <tr>
      <td class="mono">${esc(t.testCode)}</td>
      <td><b>${esc(t.name)}</b></td>
      <td>${esc(t.category)}</td>
      <td class="small">${esc(t.sample || "—")}</td>
      <td class="right mono">${esc(rupees(t.price))}</td>
      <td class="right">${t.parameters.length}</td>
      <td>${pill(t.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${sessionCanWrite(P.TEST_EDIT, session)
        ? `<button class="btn btn-sm btn-outline" data-edit-test="${esc(t.id)}" type="button">Edit</button>` : ""}</td>
    </tr>`, { colspan: 8, empty: "No tests match. Load the catalogue from Super Admin if this laboratory is new." });
}

$("#catalogueSearch").addEventListener("input", debounce(renderCatalogue, 200));
$("#catalogueCategory").addEventListener("change", renderCatalogue);

async function openTestDialog(testId) {
  const test = testId ? await Tests.getTest(testId) : {
    testCode: "", name: "", category: "Lab Test", price: 0, sample: "", reportTime: "", parameters: [], isActive: true
  };
  if (testId && !test) return toastError("Test not found.");

  const paramRow = (p, i) => `
    <tr data-param-row="${i}">
      <td><input data-p="name" value="${esc(p.name || "")}" placeholder="Parameter"></td>
      <td><input data-p="unit" value="${esc(p.unit || "")}" placeholder="Unit" style="max-width:90px;"></td>
      <td><input data-p="normalRange" value="${esc(p.normalRange || "")}" placeholder="Reference range"></td>
      <td><input data-p="rangeMale" value="${esc(p.rangeMale || "")}" placeholder="Male" style="max-width:110px;"></td>
      <td><input data-p="rangeFemale" value="${esc(p.rangeFemale || "")}" placeholder="Female" style="max-width:110px;"></td>
      <td><input data-p="rangeChild" value="${esc(p.rangeChild || "")}" placeholder="Child" style="max-width:110px;"></td>
      <td><button class="btn btn-sm btn-ghost" data-remove-param="${i}" type="button">×</button></td>
    </tr>`;

  const { element, close } = openModal({
    title: testId ? `Edit ${test.name}` : "Add test",
    wide: true,
    body: `<form id="testForm"><div class="form-grid">
        <label class="field"><span>Test code *</span><input name="testCode" value="${esc(test.testCode)}" ${testId ? "readonly" : "required"}></label>
        <label class="field"><span>Test name *</span><input name="name" value="${esc(test.name)}" required></label>
        <label class="field"><span>Short name</span><input name="shortName" value="${esc(test.shortName || "")}"></label>
        <label class="field"><span>Category / department</span>
          <input name="category" value="${esc(test.category)}" list="catList">
          <datalist id="catList">${Tests.TEST_CATEGORIES.map((c) => `<option value="${esc(c)}">`).join("")}</datalist></label>
        <label class="field"><span>Sample type</span>
          <input name="sample" value="${esc(test.sample)}" list="sampleList">
          <datalist id="sampleList">${Tests.SAMPLE_TYPES.map((s) => `<option value="${esc(s)}">`).join("")}</datalist></label>
        <label class="field"><span>Price (₹) *</span><input name="price" type="number" min="0" value="${test.price}" required></label>
        <label class="field"><span>Reporting time</span><input name="reportTime" value="${esc(test.reportTime)}" placeholder="Same Day"></label>
        <label class="field"><span>Method</span><input name="method" value="${esc(test.method || "")}"></label>
      </div>
      <label class="field"><span>Notes printed on the report</span><textarea name="notes">${esc(test.notes || "")}</textarea></label>
      <label class="field"><input type="checkbox" name="isActive" ${test.isActive ? "checked" : ""}> Active in the catalogue</label>
      </form>
      <h4 style="margin-top:16px;">Parameters</h4>
      <div class="table-wrap"><table class="data">
        <thead><tr><th>Name</th><th>Unit</th><th>Reference range</th><th>Male</th><th>Female</th><th>Child</th><th></th></tr></thead>
        <tbody id="paramBody">${(test.parameters || []).map(paramRow).join("")}</tbody>
      </table></div>
      <button class="btn btn-outline btn-sm" id="addParamBtn" type="button" style="margin-top:10px;">Add parameter</button>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save test</button>`
  });

  let paramIndex = (test.parameters || []).length;
  element.querySelector("#addParamBtn").addEventListener("click", () => {
    element.querySelector("#paramBody").insertAdjacentHTML("beforeend", paramRow({}, paramIndex));
    paramIndex += 1;
  });
  element.addEventListener("click", (e) => {
    const remove = e.target.closest("[data-remove-param]");
    if (remove) remove.closest("tr").remove();
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readForm(element.querySelector("#testForm"));
      data.parameters = Array.from(element.querySelectorAll("#paramBody tr")).map((tr, i) => {
        const read = (key) => tr.querySelector(`[data-p="${key}"]`)?.value || "";
        return { name: read("name"), unit: read("unit"), normalRange: read("normalRange"),
                 rangeMale: read("rangeMale"), rangeFemale: read("rangeFemale"), rangeChild: read("rangeChild"),
                 sortOrder: i + 1 };
      }).filter((p) => p.name.trim());
      await Tests.saveTest(data.testCode, data);
      toastOk("Test saved.");
      close(); cache.tests = null; renderCatalogue();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

$("#addTestBtn")?.addEventListener("click", () => openTestDialog(null));

// ---------- finance ----------

function financeRange() {
  const kind = $("#financeRange").value;
  if (kind === "custom") return { from: $("#financeFrom").value, to: $("#financeTo").value };
  return Analytics.RANGES[kind]();
}

async function renderFinance() {
  const range = financeRange();
  const data = await Analytics.loadFinanceData(range);
  const summary = Analytics.revenueSummary(data);

  $("#financeStats").innerHTML = [
    ["Billed", rupees(summary.billed), `${summary.bookingCount} bookings`, "info"],
    ["Collected", rupees(summary.collected), "actually received", "ok"],
    ["Outstanding", rupees(summary.outstanding), "still due", summary.outstanding ? "danger" : ""],
    ["Discounts", rupees(summary.discount), "given away", ""],
    ["Cash", rupees(summary.cash), "", ""],
    ["UPI", rupees(summary.upi), "", ""],
    ["Card", rupees(summary.card), "", ""],
    ["Home collection", rupees(summary.homeCollectionRevenue), "of billed revenue", ""],
    ["Expenses", rupees(summary.expenses), "", ""],
    ["Net", rupees(summary.netRevenue), "collected − expenses", summary.netRevenue >= 0 ? "ok" : "danger"],
    ["Average bill", rupees(summary.averageBill), "per booking", ""]
  ].map(([label, value, hint, kind]) => `
    <div class="stat ${kind}"><div class="label">${esc(label)}</div>
      <div class="value" style="font-size:1.25rem;">${esc(value)}</div>
      ${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`).join("");

  renderRows("financeDailyBody", Analytics.revenueByDay(data).reverse(), (d) => `
    <tr><td>${esc(d.date)}</td><td class="right">${d.bookings}</td>
      <td class="right mono">${esc(rupees(d.billed))}</td>
      <td class="right mono">${esc(rupees(d.collected))}</td></tr>`,
    { colspan: 4, empty: "No activity in this range." });

  renderRows("financeDueBody", Analytics.outstandingList(data.bookings), (r) => `
    <tr><td class="mono">${esc(r.bookingId)}</td><td>${esc(r.patientName)}</td>
      <td class="right mono">${esc(rupees(r.totalAmount))}</td>
      <td class="right mono"><b style="color:var(--danger)">${esc(rupees(r.balanceDue))}</b></td>
      <td>${sessionCanWrite(P.PAYMENT_RECEIVE, session)
        ? `<button class="btn btn-sm" data-collect="${esc(r.bookingId)}" type="button">Collect</button>` : ""}</td></tr>`,
    { colspan: 5, empty: "Nothing outstanding." });

  renderRows("financeTestBody", Analytics.testWiseRevenue(data.bookings).sort((a, b) => b.revenue - a.revenue), (t) => `
    <tr><td>${esc(t.name)}</td><td class="mono">${esc(t.testCode)}</td>
      <td class="right">${t.count}</td><td class="right mono">${esc(rupees(t.revenue))}</td></tr>`,
    { colspan: 4, empty: "No tests billed in this range." });
}

$("#financeRange").addEventListener("change", (e) => {
  const custom = e.target.value === "custom";
  $("#financeFrom").classList.toggle("hidden", !custom);
  $("#financeTo").classList.toggle("hidden", !custom);
  if (!custom) renderFinance();
});
$("#financeFrom").addEventListener("change", renderFinance);
$("#financeTo").addEventListener("change", renderFinance);

$("#financeExportBtn")?.addEventListener("click", async () => {
  const data = await Analytics.loadFinanceData(financeRange());
  Analytics.downloadCsv(`revenue-${getLabId()}-${dateKey()}`, Analytics.toCsv(Analytics.revenueByDay(data), [
    { label: "Date", key: "date" }, { label: "Bookings", key: "bookings" },
    { label: "Billed", key: "billed" }, { label: "Collected", key: "collected" }
  ]));
  toastOk("Revenue report exported.");
});

// ---------- analytics ----------

async function renderAnalytics() {
  const data = await Analytics.loadFinanceData(Analytics.RANGES.month());
  const mix = Analytics.patientMix(data.bookings);
  const collection = Analytics.collectionMix(data.bookings);
  const summary = Analytics.revenueSummary(data);

  $("#analyticsStats").innerHTML = [
    ["New patients", mix.newPatients, "this month", "ok"],
    ["Returning patients", mix.returningPatients, "this month", "info"],
    ["Unique patients", mix.uniquePatients, "this month", ""],
    ["Bookings", data.bookings.length, "this month", ""],
    ["Home collection share", `${collection.homePercent}%`, `${collection.home} of ${data.bookings.length}`, ""],
    ["Average bill", rupees(summary.averageBill), "", ""],
    ["Outstanding", rupees(summary.outstanding), "unpaid", summary.outstanding ? "warn" : ""],
    ["Daily average", Math.round(data.bookings.length / Math.max(new Date().getDate(), 1)), "bookings per day", ""]
  ].map(([label, value, hint, kind]) => `
    <div class="stat ${kind}"><div class="label">${esc(label)}</div>
      <div class="value">${esc(value)}</div>${hint ? `<div class="hint">${esc(hint)}</div>` : ""}</div>`).join("");

  renderRows("topTestsBody", Analytics.mostBookedTests(data.bookings), (t, i) => `
    <tr><td>${i + 1}</td><td>${esc(t.name)}</td><td class="right">${t.count}</td></tr>`,
    { colspan: 3, empty: "No data yet." });
  renderRows("topRevenueBody", Analytics.highestRevenueTests(data.bookings), (t, i) => `
    <tr><td>${i + 1}</td><td>${esc(t.name)}</td><td class="right mono">${esc(rupees(t.revenue))}</td></tr>`,
    { colspan: 3, empty: "No data yet." });
}

// ---------- staff ----------

async function renderStaff() {
  const rows = await Staff.listStaff();
  cache.staff = rows;
  renderRows("staffBody", rows, (s) => `
    <tr>
      <td><b>${esc(s.name)}</b><br><span class="small muted">${esc(s.email)}</span></td>
      <td>${esc(s.roleLabel)}</td>
      <td class="mono small">${esc(s.phone || "—")}</td>
      <td>${esc(s.employeeId || "—")}</td>
      <td>${s.canSignReports ? '<span class="pill ok">Yes</span>' : "—"}</td>
      <td>${pill(s.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${sessionCanWrite(P.STAFF_MANAGE, session) ? `
        <button class="btn btn-sm btn-outline" data-edit-staff="${esc(s.uid)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-staff="${esc(s.uid)}" data-active="${s.isActive}" type="button">
          ${s.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td>
    </tr>`, { colspan: 7, empty: "No staff yet." });

  renderRows("rolesMatrixBody", STAFF_ROLES, (role) => `
    <tr><td><b>${esc(roleLabel(role))}</b></td>
      <td class="small">${(ROLE_PERMISSIONS[role] || []).length === Object.keys(P).length
        ? "Full access"
        : esc((ROLE_PERMISSIONS[role] || []).join(", "))}</td></tr>`, { colspan: 2 });
}

function openStaffDialog(staff = null) {
  const { element, close } = openModal({
    title: staff ? `Edit ${staff.name}` : "Add staff member",
    wide: true,
    body: `
      ${staff ? "" : `<div class="notice">A staff member needs a sign-in account. Create it first with:
        <code>node scripts/create-lab-admin.mjs --lab ${esc(getLabId())} --email … --role …</code>,
        then paste the UID it prints below.</div>`}
      <form id="staffForm"><div class="form-grid">
        <label class="field"><span>Firebase UID *</span><input name="uid" value="${esc(staff?.uid || "")}" ${staff ? "readonly" : "required"}></label>
        <label class="field"><span>Full name *</span><input name="name" value="${esc(staff?.name || "")}" required></label>
        <label class="field"><span>Email</span><input name="email" type="email" value="${esc(staff?.email || "")}"></label>
        <label class="field"><span>Mobile</span><input name="phone" value="${esc(staff?.phone || "")}"></label>
        <label class="field"><span>Role *</span><select name="role" required>
          ${STAFF_ROLES.map((r) => `<option value="${r}" ${r === staff?.role ? "selected" : ""}>${esc(roleLabel(r))}</option>`).join("")}
        </select></label>
        <label class="field"><span>Employee ID</span><input name="employeeId" value="${esc(staff?.employeeId || "")}"></label>
        <label class="field"><span>Qualification</span><input name="qualification" value="${esc(staff?.qualification || "")}" placeholder="MBBS, MD"></label>
        <label class="field"><span>Registration number</span><input name="registrationNumber" value="${esc(staff?.registrationNumber || "")}"></label>
        <label class="field"><span>Signature image URL</span><input name="signatureUrl" value="${esc(staff?.signatureUrl || "")}"></label>
      </div>
      <label class="field"><input type="checkbox" name="canSignReports" ${staff?.canSignReports ? "checked" : ""}> May sign reports</label>
      <label class="field"><input type="checkbox" name="isActive" ${staff?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readForm(element.querySelector("#staffForm"));
      await Staff.saveStaff(data.uid.trim(), data, { actor: session });
      toastOk("Staff saved."); close(); renderStaff();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

$("#addStaffBtn")?.addEventListener("click", () => openStaffDialog(null));

// ---------- audit ----------

async function renderAudit() {
  const snap = await getDocs(query(col("auditLogs"), orderBy("at", "desc"), limit(300)));
  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  cache.audit = rows;
  const term = $("#auditSearch").value.trim().toLowerCase();
  const filtered = term
    ? rows.filter((r) => [r.actorName, r.actorEmail, r.action, r.summary].some((v) => String(v || "").toLowerCase().includes(term)))
    : rows;

  renderRows("auditBody", filtered, (r) => `
    <tr>
      <td class="small nowrap">${esc(formatDateTime(r.at || r.atLocal))}</td>
      <td class="small">${esc(r.actorName || "—")}<br><span class="muted">${esc(r.actorEmail || "")}</span></td>
      <td class="small">${esc(roleLabel(r.actorRole))}</td>
      <td class="small"><code>${esc(r.action)}</code></td>
      <td class="small">${esc(r.summary || "")}</td>
      <td class="small muted">${esc(r.device || "")} ${esc(r.platform || "")}</td>
    </tr>`, { colspan: 6, empty: "No audit entries yet." });
}

$("#auditSearch").addEventListener("input", debounce(renderAudit, 250));

// ---------- global search (spec section 20) ----------

const globalSearch = debounce(async (term) => {
  const box = $("#globalSearchResults");
  if (!term || term.length < 2) { box.classList.add("hidden"); return; }
  box.classList.remove("hidden");
  box.innerHTML = `<p class="small muted">Searching…</p>`;
  try {
    const [patientRows, bookingRows, reportRows, testRows] = await Promise.all([
      Patients.searchPatients(term, { max: 8 }).catch(() => []),
      Bookings.searchBookings(term, { max: 8 }).catch(() => []),
      Reports.searchReports(term, { max: 8 }).catch(() => []),
      tests().then((all) => Tests.searchTests(all, term).slice(0, 6)).catch(() => [])
    ]);
    const total = patientRows.length + bookingRows.length + reportRows.length + testRows.length;
    if (!total) { box.innerHTML = `<p class="small muted">Nothing found for “${esc(term)}”.</p>`; return; }

    box.innerHTML = `
      <div class="card-head"><h3>Results for “${esc(term)}”</h3><span class="spacer"></span>
        <button class="btn btn-ghost btn-sm" id="closeSearchBtn" type="button">Close</button></div>
      ${section("Patients", patientRows, (p) =>
        `<button class="btn btn-sm btn-outline" data-patient-history="${esc(p.patientId)}" type="button">
          ${esc(p.name)} · ${esc(p.phone)} · ${esc(p.patientId)}</button>`)}
      ${section("Bookings", bookingRows, (b) =>
        `<button class="btn btn-sm btn-outline" data-open-report="${esc(b.bookingId)}" type="button">
          ${esc(b.billNo)} · ${esc(b.patientName)} · ${esc(rupees(b.totalAmount))}</button>`)}
      ${section("Reports", reportRows, (r) =>
        `<button class="btn btn-sm btn-outline" data-open-report="${esc(r.reportId)}" type="button">
          ${esc(r.billNo)} · ${esc(r.patientName)} · ${esc(r.reportStatus)}</button>`)}
      ${section("Tests", testRows, (t) =>
        `<span class="pill info">${esc(t.name)} · ${esc(rupees(t.price))}</span>`)}`;
    $("#closeSearchBtn").addEventListener("click", () => {
      box.classList.add("hidden"); $("#globalSearch").value = "";
    });
  } catch (error) { reportError(error, "Search failed."); }
}, 320);

function section(title, rows, render) {
  if (!rows.length) return "";
  return `<div style="margin-bottom:10px;">
    <div class="small muted" style="margin-bottom:5px;">${esc(title)}</div>
    <div class="btn-row">${rows.map(render).join("")}</div></div>`;
}

$("#globalSearch").addEventListener("input", (e) => globalSearch(e.target.value.trim()));

// ---------- delegated actions ----------

document.addEventListener("click", async (event) => {
  const t = event.target;
  const open = t.closest("[data-open-report]");
  if (open) { tabs.show("reportEntry"); return openReportFor(open.dataset.openReport); }

  const print = t.closest("[data-print-report]");
  if (print) return openReportFor(print.dataset.printReport, { print: true });

  const share = t.closest("[data-share-report]");
  if (share) return openReportFor(share.dataset.shareReport, { share: true });

  const collect = t.closest("[data-collect]");
  if (collect) return openCollectDialog(collect.dataset.collect);

  const wa = t.closest("[data-wa]");
  if (wa) return openWhatsAppDialog(wa.dataset.wa);

  const bill = t.closest("[data-bill]");
  if (bill) {
    try {
      const id = bill.dataset.bill;
      const b = (cache.bookings || []).find((x) => x.bookingId === id || x.billNo === id)
        || await Bookings.getBooking(id);
      if (!b) return toastError("Booking not found for this bill.");
      printReceipt(b, branding);
    } catch (error) {
      reportError(error, "Could not open the bill.");
    }
    return;
  }

  const history = t.closest("[data-patient-history]");
  if (history) return openPatientHistory(history.dataset.patientHistory);

  const editPatient = t.closest("[data-edit-patient]");
  if (editPatient) return openPatientDialog(await Patients.getPatient(editPatient.dataset.editPatient));

  const editTest = t.closest("[data-edit-test]");
  if (editTest) return openTestDialog(editTest.dataset.editTest);

  const hcAssign = t.closest("[data-hc-assign]");
  if (hcAssign) return openAssignDialog(hcAssign.dataset.hcAssign);

  const hcStatus = t.closest("[data-hc-status]");
  if (hcStatus) return openStatusDialog(hcStatus.dataset.hcStatus);

  const convert = t.closest("[data-convert]");
  if (convert) return convertOnlineBooking(convert.dataset.convert);

  const editStaff = t.closest("[data-edit-staff]");
  if (editStaff) return openStaffDialog(cache.staff?.find((s) => s.uid === editStaff.dataset.editStaff));

  const toggleStaff = t.closest("[data-toggle-staff]");
  if (toggleStaff) {
    const active = toggleStaff.dataset.active !== "true";
    if (!await confirmAction(`${active ? "Activate" : "Deactivate"} this staff member?`, { danger: !active })) return;
    try { await Staff.setStaffActive(toggleStaff.dataset.toggleStaff, active, { actor: session }); toastOk("Updated."); renderStaff(); }
    catch (error) { reportError(error); }
  }
});

export { cache, tests as loadTestsCached, bookings as loadBookingsCached, invalidate };
