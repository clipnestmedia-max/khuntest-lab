// Fast reception booking screen (spec section 7).
//
// Speed is the whole point here: the catalogue is loaded once and searched in
// memory, keyboard-first (type -> Enter adds the top match), and the phone
// field auto-fills a returning patient so a repeat visit is three keystrokes.
import * as Tests from "../core/data/tests.js";
import * as Bookings from "../core/data/bookings.js";
import * as Patients from "../core/data/patients.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { settingsDoc } from "../core/tenant.js";
import { rupees, toNumber, normalizePhone } from "../core/data/helpers.js";
import { $, esc, toastOk, toastError, reportError, setBusy, renderRows, debounce, readForm } from "../core/ui.js";
import { printReceipt } from "./receipt.js";

let ctx = { session: null, branding: null, onSaved: null };
let catalogue = [];
let selected = [];
let paymentSettings = { homeCollectionCharge: 0 };

export function initBookingScreen(context) {
  ctx = context;
  loadCatalogue();
  loadPaymentSettings();

  $("#testSearch").addEventListener("input", debounce(renderSuggestions, 120));
  $("#testSearch").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const first = document.querySelector("[data-add-test]");
    if (first) addTest(first.dataset.addTest);
  });

  $("#bookingForm").phone.addEventListener("blur", lookupPatient);
  $("#bookingForm").patientName.addEventListener("input", (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  ["#bkCharge", "#bkDiscount", "#bkPaid", "#bkCollectionType"].forEach((id) =>
    $(id).addEventListener("input", renderTotals));
  $("#bkCollectionType").addEventListener("change", () => {
    $("#bkCharge").value = $("#bkCollectionType").value === "Home Collection"
      ? paymentSettings.homeCollectionCharge : 0;
    renderTotals();
  });

  $("#clearTestsBtn").addEventListener("click", () => { selected = []; renderSelected(); });
  $("#saveBookingBtn").addEventListener("click", () => saveBooking({ print: true }));
  $("#saveBookingOnlyBtn").addEventListener("click", () => saveBooking({ print: false }));

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-test]");
    if (add) return addTest(add.dataset.addTest);
    const remove = event.target.closest("[data-remove-test]");
    if (remove) {
      selected = selected.filter((t) => t.testId !== remove.dataset.removeTest);
      renderSelected();
    }
  });

  renderSelected();
}

async function loadCatalogue() {
  try {
    catalogue = await Tests.loadTestSummaries({ activeOnly: true });
    $("#catalogueCount").textContent = `${catalogue.length} tests available`;
    renderSuggestions();
  } catch (error) {
    reportError(error, "Could not load the test catalogue.");
  }
}

async function loadPaymentSettings() {
  try {
    const snap = await getDoc(settingsDoc("payment"));
    if (snap.exists()) paymentSettings = { homeCollectionCharge: 0, ...snap.data() };
  } catch { /* defaults are fine */ }
}

function renderSuggestions() {
  const term = $("#testSearch").value.trim();
  const rows = Tests.searchTests(catalogue, term).slice(0, 40);
  const chosen = new Set(selected.map((t) => t.testId));

  $("#testSuggestions").innerHTML = rows.length ? `<table class="data"><tbody>${
    rows.map((t) => `
      <tr>
        <td><b>${esc(t.name)}</b><br><span class="small muted">${esc(t.testCode)} · ${esc(t.category)}</span></td>
        <td class="right mono nowrap">${esc(rupees(t.price))}</td>
        <td class="right">${chosen.has(t.id)
          ? `<span class="pill ok">Added</span>`
          : `<button class="btn btn-sm" data-add-test="${esc(t.id)}" type="button">Add</button>`}</td>
      </tr>`).join("")}</tbody></table>`
    : `<p class="small muted" style="padding:14px;">${term ? `No test matches “${esc(term)}”.` : "Start typing to search the catalogue."}</p>`;
}

function addTest(testId) {
  if (selected.some((t) => t.testId === testId)) return;
  const test = catalogue.find((t) => t.id === testId);
  if (!test) return;
  selected.push({
    testId: test.id, testCode: test.testCode, name: test.name,
    category: test.category, sample: test.sample, reportTime: test.reportTime,
    price: toNumber(test.price)
  });
  renderSelected();
  $("#testSearch").value = "";
  $("#testSearch").focus();
  renderSuggestions();
}

function renderSelected() {
  renderRows("selectedTestsBody", selected, (t) => `
    <tr>
      <td><b>${esc(t.name)}</b></td>
      <td class="mono small">${esc(t.testCode)}</td>
      <td class="small">${esc(t.category)}</td>
      <td class="right mono">${esc(rupees(t.price))}</td>
      <td class="right"><button class="btn btn-sm btn-ghost" data-remove-test="${esc(t.testId)}" type="button">Remove</button></td>
    </tr>`, { colspan: 5, empty: "No tests selected yet — search above and press Add." });
  renderTotals();
  renderSuggestions();
}

function currentPricing() {
  return Bookings.priceBooking({
    tests: selected,
    collectionCharge: $("#bkCharge").value,
    discount: $("#bkDiscount").value,
    paidAmount: $("#bkPaid").value
  });
}

function renderTotals() {
  const p = currentPricing();
  $("#bookingTotals").innerHTML = `
    <div class="row-flex"><span>Subtotal</span><span class="spacer"></span><b class="mono">${esc(rupees(p.subtotal))}</b></div>
    <div class="row-flex"><span>Home collection</span><span class="spacer"></span><b class="mono">${esc(rupees(p.collectionCharge))}</b></div>
    <div class="row-flex"><span>Discount</span><span class="spacer"></span><b class="mono">− ${esc(rupees(p.discount))}</b></div>
    <hr style="border:0;border-top:1px solid var(--line);margin:8px 0;">
    <div class="row-flex" style="font-size:1.15rem;"><b>Grand total</b><span class="spacer"></span>
      <b class="mono">${esc(rupees(p.totalAmount))}</b></div>
    <div class="row-flex"><span>Received</span><span class="spacer"></span><b class="mono">${esc(rupees(p.paidAmount))}</b></div>
    <div class="row-flex" style="color:${p.balanceDue ? "var(--danger)" : "var(--ok)"};">
      <b>Balance due</b><span class="spacer"></span><b class="mono">${esc(rupees(p.balanceDue))}</b></div>
    <div style="margin-top:8px;"><span class="pill ${p.paymentStatus === "Paid" ? "ok" : "warn"}">${esc(p.paymentStatus)}</span>
      <span class="pill info">${selected.length} test${selected.length === 1 ? "" : "s"}</span></div>`;
}

/** Auto-fill a returning patient from their mobile number. */
async function lookupPatient() {
  const form = $("#bookingForm");
  const phone = normalizePhone(form.phone.value);
  const notice = $("#patientFoundNotice");
  if (!phone) { notice.classList.add("hidden"); return; }
  try {
    const patient = await Patients.findPatientByPhone(phone);
    if (!patient) {
      notice.className = "notice";
      notice.textContent = "New patient — a patient ID will be created when you save.";
      notice.classList.remove("hidden");
      form.patientId.value = "";
      return;
    }
    form.patientId.value = patient.patientId;
    form.patientUid.value = patient.uid || "";
    ["patientName", "age", "gender", "email", "address"].forEach((key) => {
      const field = form[key === "patientName" ? "patientName" : key];
      if (field && !field.value) field.value = key === "patientName" ? patient.name : (patient[key] || "");
    });
    notice.className = "notice ok";
    notice.innerHTML = `Returning patient <b>${esc(patient.name)}</b> (${esc(patient.patientId)}) — ${patient.totalBookings} previous visit(s).`;
    notice.classList.remove("hidden");
  } catch (error) {
    console.warn("patient lookup failed", error?.message);
  }
}

async function saveBooking({ print }) {
  const form = $("#bookingForm");
  const buttonId = print ? "#saveBookingBtn" : "#saveBookingOnlyBtn";
  if (!selected.length) return toastError("Add at least one test before saving.");
  if (!form.patientName.value.trim()) { form.patientName.focus(); return toastError("Patient name is required."); }
  if (!normalizePhone(form.phone.value)) { form.phone.focus(); return toastError("Enter a valid 10-digit mobile number."); }

  setBusy(buttonId, true, "Saving...");
  try {
    const data = readForm(form);
    const booking = await Bookings.createBooking({
      ...data,
      tests: selected,
      collectionType: $("#bkCollectionType").value,
      collectionCharge: $("#bkCharge").value,
      discount: $("#bkDiscount").value,
      paidAmount: $("#bkPaid").value,
      paymentMode: $("#bkMode").value,
      scheduledAt: $("#bkScheduled").value,
      remarks: $("#bkRemarks").value,
      source: "walkin"
    }, { actor: ctx.session });

    toastOk(`Booking ${booking.billNo} saved.`);
    if (print) {
      try { printReceipt(booking, ctx.branding); }
      catch (error) { toastError(error.message); }
    }
    resetScreen();
    ctx.onSaved?.(booking);
  } catch (error) {
    reportError(error, "Could not save the booking.");
  } finally {
    setBusy(buttonId, false);
  }
}

function resetScreen() {
  $("#bookingForm").reset();
  selected = [];
  ["#bkCharge", "#bkDiscount", "#bkPaid"].forEach((id) => { $(id).value = 0; });
  $("#bkRemarks").value = "";
  $("#bkScheduled").value = "";
  $("#patientFoundNotice").classList.add("hidden");
  renderSelected();
  $("#bookingForm").phone.focus();
}
