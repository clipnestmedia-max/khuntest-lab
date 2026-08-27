// Card-based report entry (spec section 9).
//
// A patient booked for CBC + LFT + KFT + ESR sees four collapsed cards, not
// one long mixed list of 40 parameters. Opening a card reveals only that
// test's parameters; "Save & Close" persists and collapses it. This is the
// KhunTest admin panel's proven interaction, rebuilt on the tenant-aware data
// layer with live abnormal-value flagging added.
import * as Reports from "../core/data/reports.js";
import * as Bookings from "../core/data/bookings.js";
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { settingsDoc } from "../core/tenant.js";
import { sessionCan, sessionCanWrite } from "../core/session.js";
import { PERMISSIONS as P } from "../core/roles.js";
import { listSignatories } from "../core/data/staff.js";
import { printReport } from "../core/report-templates.js";
import { sendReportReady } from "../core/whatsapp.js";
import { createShareLink } from "./report-share.js";
import { rupees } from "../core/data/helpers.js";
import { logAudit, AUDIT } from "../core/audit.js";
import { analyseReport, releaseBlockers, validationFooter, isCalculatedParameterRow }
  from "../core/medical/report-integration.js";
import { loadMedicalConfig, emptyConfig } from "../core/medical/config.js";
import { newInterpretationRecord, applyEdit, approve as approveInterpretation, canRelease, releasableText }
  from "../core/medical/review.js";
import { VALUE_ORIGIN } from "../core/medical/schema.js";
import {
  $, esc, toastOk, toastError, toastWarn, reportError, setBusy, openModal, confirmAction,
  progressBar, pill
} from "../core/ui.js";

let ctx = { session: null, branding: null, onChanged: null };
let current = { booking: null, report: null, groups: [] };
let reportSettings = {};
let medicalConfig = emptyConfig();
let analysis = null;
let interpretation = null;

// Automatic calculation is ON by default and stays ON for normal staff. An
// authorised user (pathologist/admin/owner) may suspend it for the session;
// "Recalculate" always runs regardless. Never persisted — every report opens
// with it ON.
let autoCalcOn = true;

/**
 * Development trace (spec §27). Quiet unless switched on with
 * `localStorage.setItem("swati_report_debug", "1")` or `window.__REPORT_DEBUG = true`
 * in the console. Never logs in normal use, so there is nothing to strip.
 */
function dbg(tag, payload) {
  let on = false;
  try { on = localStorage.getItem("swati_report_debug") === "1"; } catch { /* private mode */ }
  if (!on && globalThis.__REPORT_DEBUG !== true) return;
  try { console.log(`[${tag}]`, payload); } catch { /* console unavailable */ }
}

export function initReportEntry(context) {
  ctx = context;
  loadReportSettings();
  loadMedicalConfig().then((c) => { medicalConfig = c; }).catch(() => { /* shipped defaults */ });
  refreshBookingList();

  $("#loadReportBtn").addEventListener("click", () => {
    const value = $("#reportBookingSelect").value;
    if (value) openReportFor(value);
  });
  $("#saveDraftBtn").addEventListener("click", () => saveDraft({ silent: false }));
  $("#approveReportBtn")?.addEventListener("click", approve);
  $("#previewReportBtn").addEventListener("click", preview);

  // Delegated so cards can be re-rendered freely.
  const cards = $("#reportEntryCards");
  cards.addEventListener("click", (event) => {
    const autocalc = event.target.closest("[data-autocalc-toggle]");
    if (autocalc) { event.stopPropagation(); return toggleAutoCalc(); }
    const recalc = event.target.closest("[data-recalc-card]");
    if (recalc) { event.stopPropagation(); return recalculateNow(); }
    const save = event.target.closest("[data-save-card]");
    if (save) return saveCard(save.dataset.saveCard);
    const clear = event.target.closest("[data-clear-card]");
    if (clear) return clearCard(clear.dataset.clearCard);
    const override = event.target.closest("[data-override-row]");
    if (override) return offerOverride(override.dataset.overrideRow);
    const toggle = event.target.closest("[data-toggle-card]");
    if (toggle) return toggleCard(toggle.dataset.toggleCard);
  });

  $("#interpretationPanel")?.addEventListener("click", (event) => {
    if (event.target.closest("[data-interp-approve]")) return openInterpretationReview();
    if (event.target.closest("[data-interp-edit]")) return openInterpretationReview();
  });
  cards.addEventListener("input", (event) => {
    const input = event.target.closest("[data-result-input]");
    if (input) onResultInput(input);
  });
  // Enter moves to the next field instead of submitting anything.
  cards.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const input = event.target.closest("[data-result-input]");
    if (!input) return;
    event.preventDefault();
    const inputs = Array.from(document.querySelectorAll('[data-result-input]:not([disabled])'));
    inputs[inputs.indexOf(input) + 1]?.focus();
  });
}

async function loadReportSettings() {
  try {
    const snap = await getDoc(settingsDoc("report"));
    if (snap.exists()) reportSettings = snap.data();
  } catch { /* defaults */ }
}

/**
 * Load the bookings a report can be entered against.
 *
 * Exported and re-run every time the tab is opened: this used to run once at
 * page load, so a booking created during the session never appeared here and
 * the screen looked empty while the booking plainly existed.
 */
export async function refreshBookingList() {
  const select = $("#reportBookingSelect");
  if (!select) return;
  const previous = select.value;
  try {
    const rows = await Bookings.listBookings({ max: 200 });

    if (!rows.length) {
      select.innerHTML = `<option value="">No bookings yet</option>`;
      select.disabled = true;
      $("#reportEntryMeta").innerHTML = `
        <div class="notice" style="margin-top:12px;">
          <b>No bookings to report on yet.</b>
          A report is entered against a booking, so create one first under
          <b>New Booking</b> — it will appear here immediately.
        </div>`;
      return;
    }

    select.disabled = false;
    // Reports still to finish come first: that is what someone opening this
    // screen is almost always looking for.
    const pending = rows.filter((b) => b.bookingStatus !== "Delivered");
    const done = rows.filter((b) => b.bookingStatus === "Delivered");
    const option = (b) =>
      `<option value="${esc(b.bookingId)}">${esc(b.billNo)} — ${esc(b.patientName)}` +
      `${b.testNames ? ` (${esc(b.testNames.slice(0, 40))})` : ""}</option>`;

    select.innerHTML = `<option value="">Select a booking…</option>`
      + (pending.length ? `<optgroup label="Awaiting report">${pending.map(option).join("")}</optgroup>` : "")
      + (done.length ? `<optgroup label="Delivered">${done.map(option).join("")}</optgroup>` : "");

    if (previous && rows.some((b) => b.bookingId === previous)) select.value = previous;
  } catch (error) {
    select.innerHTML = `<option value="">Could not load bookings</option>`;
    reportError(error, "Could not load the booking list.");
  }
}

/** Open a report by booking id or report id. Both resolve to the same doc. */
export async function openReportFor(id, { print = false, share = false } = {}) {
  try {
    const [booking, existing] = await Promise.all([
      Bookings.getBooking(id),
      Reports.getReportByBooking(id)
    ]);
    if (!booking && !existing) return toastError("No booking or report found for that reference.");

    const resolvedBooking = booking || {
      bookingId: existing.bookingId, billNo: existing.billNo, patientName: existing.patientName,
      patientId: existing.patientId, patientUid: existing.patientUid, phone: existing.phone,
      age: existing.age, gender: existing.gender, refBy: existing.refBy,
      tests: (existing.groups || []).map((g) => ({ testId: g.testId, testCode: g.testCode, name: g.testName })),
      totalAmount: 0, balanceDue: 0, paymentStatus: "", testNames: ""
    };

    const blankGrid = await Reports.buildResultGrid(resolvedBooking);
    // Overlay every saved value onto the fresh catalogue grid. A row is matched
    // by its stable parameterId first, then by a normalised name — never lost
    // because the catalogue was renumbered. This is the ONLY place saved
    // results are restored, and it never replaces a saved value with a blank.
    const groups = existing?.groups?.length
      ? Reports.mergeSavedResults(blankGrid, existing.groups)
      : blankGrid;

    dbg("REPORT LOAD", {
      reportId: existing?.reportId || "(new)",
      bookingId: resolvedBooking.bookingId,
      savedGroups: (existing?.groups || []).length,
      savedValues: (existing?.groups || []).flatMap((g) =>
        (g.rows || []).filter((r) => String(r.value ?? "").trim() !== "")
          .map((r) => `${g.testCode || g.testId}:${r.parameterId}=${r.value}`)),
      mergedNonBlank: groups.flatMap((g) =>
        g.rows.filter((r) => String(r.value ?? "").trim() !== "").map((r) => `${r.parameterId}=${r.value}`))
    });

    current = { booking: resolvedBooking, report: existing, groups };
    // Every report opens with automatic calculation ON.
    autoCalcOn = true;
    // A saved interpretation carries its own approval state; a fresh report
    // starts unapproved. Never inherit an approval from a previous report.
    interpretation = existing?.interpretationRecord || null;
    medicalConfig = await loadMedicalConfig().catch(() => emptyConfig());
    analyse();

    $("#reportBookingSelect").value = resolvedBooking.bookingId || "";
    renderMeta();
    renderCards();
    renderMedicalPanels();
    $("#reportEntryFoot").classList.remove("hidden");

    if (print) preview();
    if (share) shareOnWhatsApp();
  } catch (error) {
    reportError(error, "Could not open that report.");
  }
}

function renderMeta() {
  const b = current.booking;
  const r = current.report;
  const status = r?.reportStatus || "Not started";
  $("#reportEntryMeta").innerHTML = `
    <div class="grid grid-4" style="margin-top:12px;">
      <div class="stat"><div class="label">Patient</div><div class="value" style="font-size:1.05rem;">${esc(b.patientName)}</div>
        <div class="hint">${esc(b.patientId || "")}</div></div>
      <div class="stat"><div class="label">Bill</div><div class="value" style="font-size:1.05rem;">${esc(b.billNo)}</div>
        <div class="hint">${esc([b.age, b.gender].filter(Boolean).join(" / "))}</div></div>
      <div class="stat"><div class="label">Referred by</div><div class="value" style="font-size:1.05rem;">${esc(b.refBy || "Self")}</div></div>
      <div class="stat ${status === "Final" ? "ok" : "warn"}"><div class="label">Report status</div>
        <div class="value" style="font-size:1.05rem;">${esc(status)}</div>
        ${b.balanceDue > 0 ? `<div class="hint" style="color:var(--danger)">Balance ${esc(rupees(b.balanceDue))}</div>` : ""}</div>
    </div>
    ${status === "Final" ? `<div class="notice ok" style="margin-top:12px;">
      This report is released. Editing it will revert it to Draft and the patient's copy will be withdrawn until it is approved again.
    </div>` : ""}`;
}

function autoCalcControls(gi, canEdit) {
  const canToggle = canEdit && sessionCan(P.REPORT_APPROVE, ctx.session);
  return `
    <span class="autocalc-controls" style="display:inline-flex;gap:6px;align-items:center;">
      <button class="btn btn-sm ${autoCalcOn ? "btn-green" : "btn-outline"}" type="button"
        data-autocalc-toggle title="${canToggle
          ? "Automatic calculation is on. Only a pathologist/admin may suspend it."
          : "Automatic calculation is on for every report."}"
        ${canToggle ? "" : "disabled"}>
        ⚡ Auto Calculate: ${autoCalcOn ? "ON" : "OFF"}</button>
      ${canEdit ? `<button class="btn btn-sm btn-outline" type="button" data-recalc-card="${gi}"
        title="Recalculate every calculated parameter in this report now">Recalculate</button>` : ""}
    </span>`;
}

function renderCards() {
  const canEdit = sessionCanWrite(P.REPORT_ENTER, ctx.session);
  $("#reportEntryCards").innerHTML = current.groups.map((group, gi) => {
    const progress = Reports.groupProgress(group);
    const complete = progress.label === "Completed";
    const calcBit = progress.calculatedTotal
      ? ` · ${progress.calculatedOk}/${progress.calculatedTotal} calculated` : "";
    return `
      <div class="test-card ${complete ? "is-complete" : ""}" data-open="false" data-card="${gi}">
        <div class="test-card-head" data-toggle-card="${gi}">
          <div>
            <div class="title">${esc(group.testName)}</div>
            <div class="meta">${esc(group.testCode)}${group.sample ? ` · ${esc(group.sample)}` : ""} ·
              ${progress.measuredEntered} of ${progress.measuredTotal} values entered${esc(calcBit)}</div>
          </div>
          ${progressBar(progress.measuredEntered, progress.measuredTotal)}
          <span class="pill ${complete ? "ok" : progress.measuredEntered ? "warn" : ""}" data-card-status="${gi}">${esc(progress.label)}</span>
          <button class="btn btn-sm btn-outline" data-toggle-card="${gi}" type="button">Open Parameters</button>
        </div>
        <div class="test-card-body">
          <div class="row-flex" style="justify-content:flex-end;margin-bottom:8px;">${autoCalcControls(gi, canEdit)}</div>
          <div class="table-wrap"><table class="data">
            <thead><tr><th style="width:30%">Parameter</th><th style="width:22%">Result</th>
              <th style="width:12%">Unit</th><th style="width:22%">Reference Range</th><th style="width:14%">Flag / Status</th></tr></thead>
            <tbody>${group.rows.map((row, ri) => rowHtml(group, gi, row, ri, canEdit)).join("")}</tbody>
          </table></div>
          ${group.notes ? `<p class="small muted">${esc(group.notes)}</p>` : ""}
          <div class="btn-row" style="margin-top:12px;">
            ${canEdit ? `<button class="btn btn-green btn-sm" data-save-card="${gi}" type="button">Save &amp; Close</button>` : ""}
            <button class="btn btn-outline btn-sm" data-toggle-card="${gi}" type="button">Close</button>
            ${canEdit ? `<button class="btn btn-ghost btn-sm" data-clear-card="${gi}" type="button">Clear this test</button>` : ""}
          </div>
        </div>
      </div>`;
  }).join("") || `<div class="card"><p class="muted">Select a booking above to start entering results.</p></div>`;

  renderProgress();
}

/** Turn automatic calculation on or off for this session (authorised users only). */
function toggleAutoCalc() {
  if (!sessionCan(P.REPORT_APPROVE, ctx.session)) {
    return toastWarn("Automatic calculation stays on for laboratory staff. A pathologist or admin can suspend it.");
  }
  autoCalcOn = !autoCalcOn;
  dbg("STATE UPDATE", { autoCalcOn });
  if (autoCalcOn) {
    analyse();
    toastOk("Automatic calculation resumed. Every calculated parameter has been refreshed.");
  } else {
    toastWarn("Automatic calculation suspended for this session. Use “Recalculate” to run it manually.");
  }
  renderCards();
  renderMedicalPanels();
}

/** Manual trigger — always recalculates, whether or not auto-calc is on. */
function recalculateNow() {
  dbg("CALCULATION", { trigger: "manual Recalculate button" });
  analyse();
  renderCards();
  renderMedicalPanels();
  toastOk(analyseError ? `Recalculated with an error: ${analyseError}` : "All calculated parameters recalculated.");
}

function rowHtml(group, gi, row, ri, canEdit) {
  const canOverride = canEdit && sessionCan(P.REPORT_APPROVE, ctx.session);
  if (row.isHeading) {
    return `<tr class="param-row"><td colspan="5" style="background:var(--surface-2);"><b>${esc(row.name)}</b></td></tr>`;
  }
  const flagClass = row.flag
    ? (row.flag.startsWith("Critical") ? "flag-critical" : "flag-abnormal")
    : "";
  // A calculated parameter is shown, not typed. It is read-only so nobody can
  // quietly disagree with the arithmetic, and it is labelled so nobody
  // mistakes it for something the analyser measured. A calculated line that
  // cannot resolve yet is still NOT an editable field — it shows a waiting
  // state, so a technician never hand-types (say) an Indirect Bilirubin.
  const calculated = row.calculated === true;
  const overridden = row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED;
  const pending = !calculated && !overridden && (row.calcPending === true || isCalculatedParameterRow(row));

  const calcError = pending && Boolean(analyseError);

  const valueCell = calculated
    ? `<div class="calc-value" title="${esc(row.formulaText || "")}">
         <span class="calc-number">${esc(row.value)}</span>
         <span class="calc-tag">AUTO CALCULATED</span>
       </div>
       ${row.calculationNote ? `<div class="small muted">${esc(row.calculationNote)}</div>` : ""}
       ${canOverride ? `<button class="btn btn-ghost btn-sm" data-override-row="${gi}:${ri}" type="button">Override</button>` : ""}`
    : pending
    ? `<div class="calc-value is-pending" title="${esc(row.formulaText || row.calcPendingReason || "")}">
         <span class="calc-number">—</span>
         <span class="calc-tag">${calcError ? "CALCULATION ERROR" : "WAITING FOR INPUT"}</span>
       </div>
       <div class="small muted">${esc(calcError ? analyseError : (row.calcPendingReason || "Waiting for the required parameters."))}</div>`
    : `<input class="result-input ${overridden ? "is-overridden" : ""}" data-result-input data-g="${gi}" data-r="${ri}"
            value="${esc(row.value)}" ${canEdit ? "" : "disabled"}
            inputmode="decimal" autocomplete="off" aria-label="${esc(row.name)} result">
       ${overridden ? `<div class="small muted">Entered manually in place of the calculated value.
         ${canOverride ? `<button class="btn btn-ghost btn-sm" data-override-row="${gi}:${ri}" type="button">Change</button>` : ""}</div>` : ""}`;

  return `
    <tr class="param-row ${flagClass} ${calculated || pending ? "is-calculated" : ""}" data-row="${gi}:${ri}">
      <td>${esc(row.name)}</td>
      <td data-value-cell="${gi}:${ri}">${valueCell}</td>
      <td class="small">${esc(row.unit)}</td>
      <td class="small muted">${esc(row.referenceRange)}
        ${row.intervalUnvalidated ? `<span class="pill warn" style="font-size:.62rem;" title="Not established or verified by this laboratory">unvalidated</span>` : ""}</td>
      <td><span class="flag-tag ${statusClass(row)}" data-flag="${gi}:${ri}">${esc(statusLabel(row))}</span></td>
    </tr>`;
}

function flagTagClass(flag) {
  if (!flag) return "";
  if (flag.startsWith("Critical")) return "critical";
  return flag === "High" ? "high" : "low";
}

/**
 * The Flag / Status column (spec §14). A measured row shows its abnormal flag;
 * a calculated row shows where it is in its lifecycle.
 */
function statusLabel(row) {
  if (row.calculated === true) return "AUTO CALCULATED";
  if (row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED) return row.flag || "Manual";
  if (row.calcPending === true || (isCalculatedParameterRow(row) && !row.flag)) {
    return analyseError ? "CALCULATION ERROR" : "WAITING FOR INPUT";
  }
  return row.flag || "";
}
function statusClass(row) {
  if (row.calculated === true) return "calc";
  if (row.calcPending === true || (isCalculatedParameterRow(row) && !row.flag && row.calculated !== true)) {
    return analyseError ? "critical" : "waiting";
  }
  return flagTagClass(row.flag);
}

function toggleCard(index) {
  const card = document.querySelector(`[data-card="${index}"]`);
  if (!card) return;
  const open = card.dataset.open === "true";
  card.dataset.open = open ? "false" : "true";
  card.querySelectorAll("[data-toggle-card]").forEach((b) => {
    if (b.tagName === "BUTTON" && b.closest(".test-card-head")) {
      b.textContent = open ? "Open Parameters" : "Close Parameters";
    }
  });
  if (!open) card.querySelector("[data-result-input]")?.focus();
}

/**
 * The technician typed. Update state, then run the whole engine immediately -
 * one entered value can fill several calculated ones below it, so this happens
 * on the keystroke, never on Save.
 */
function onResultInput(input) {
  const gi = Number(input.dataset.g);
  const ri = Number(input.dataset.r);
  const group = current.groups[gi];
  const row = group?.rows[ri];
  if (!row) return;

  row.value = input.value;
  dbg("STATE UPDATE", { param: row.parameterId || row.name, value: input.value });

  // Recalculate now, unless an authorised user has suspended auto-calc for the
  // session (in which case only flags/interpretation refresh, and the stale
  // calculated values stay put until "Recalculate" is pressed).
  if (autoCalcOn) analyse();
  repaintValues();

  updateCardStatus(gi);
  renderProgress();
  renderMedicalPanels();
}

let analyseError = "";

/**
 * Run the medical engine over the current grid — the ONE
 * `recalculateAllCalculatedParameters()` entry point. Every calculated value
 * in `current.groups` is re-derived from the current inputs, in dependency
 * order, on every call. Called on load, on every keystroke, on override, and
 * again before save / approve / preview so a stored or printed report can
 * never carry a stale calculation.
 */
function analyse() {
  if (!current.groups?.length) { analysis = null; return; }
  try {
    analysis = analyseReport(current.groups, {
      age: current.booking?.age, gender: current.booking?.gender
    }, medicalConfig);
    analyseError = "";
    dbg("CALCULATION", {
      calculated: (analysis.calculated || []).map((c) => `${c.code}=${c.display}`),
      waiting: current.groups.flatMap((g) => g.rows.filter((r) => r.calcPending)
        .map((r) => `${r.parameterId || r.name}: ${r.calcPendingReason}`)),
      patterns: (analysis.patterns || []).map((p) => p.ruleId)
    });
  } catch (error) {
    // A failure here must not cost the technician their typing, but it must
    // NOT be silent either — a swallowed error is why calculated fields sat
    // empty with no explanation.
    console.error("[CALCULATION ENGINE] analysis failed", error);
    analyseError = error?.message || "The calculation engine failed to run.";
    analysis = null;
  }
}

/** The three shapes a result cell can take. */
function rowKind(row) {
  if (row.calculated === true) return "calc";
  if (row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED) return "input";
  if (row.calcPending === true || isCalculatedParameterRow(row)) return "pending";
  return "input";
}
function renderedRowKind(cell) {
  if (!cell) return "none";
  if (cell.querySelector("[data-result-input]")) return "input";
  if (cell.querySelector(".calc-value.is-pending")) return "pending";
  if (cell.querySelector(".calc-value")) return "calc";
  return "none";
}

/**
 * Push the current `current.groups` state into the open cards without a full
 * re-render, so a calculated value appears the instant its inputs are in and
 * the caret is never lost. A cell whose KIND changed (measured input ⇄
 * calculated value ⇄ waiting-for-input) is rebuilt from rowHtml; an unchanged
 * cell just has its number synced. Focus and selection are captured before and
 * restored after, so a rebuild elsewhere in the table never interrupts typing.
 */
function repaintValues() {
  const canEdit = sessionCanWrite(P.REPORT_ENTER, ctx.session);
  const active = document.activeElement;
  const focused = active && active.matches && active.matches("[data-result-input]")
    ? { key: `${active.dataset.g}:${active.dataset.r}`, start: active.selectionStart, end: active.selectionEnd }
    : null;

  current.groups.forEach((group, gi) => {
    group.rows.forEach((row, ri) => {
      if (row.isHeading) return;
      const key = `${gi}:${ri}`;
      const tr = document.querySelector(`[data-row="${key}"]`);
      if (!tr) return;

      const critical = String(row.flag || "").startsWith("Critical");
      tr.classList.toggle("flag-abnormal", Boolean(row.flag) && !critical);
      tr.classList.toggle("flag-critical", critical);
      tr.classList.toggle("is-calculated", row.calculated === true || row.calcPending === true);

      const tag = tr.querySelector("[data-flag]");
      if (tag) { tag.textContent = statusLabel(row); tag.className = `flag-tag ${statusClass(row)}`; }

      const cell = tr.querySelector(`[data-value-cell="${key}"]`);
      if (!cell) return;
      const want = rowKind(row);
      const have = renderedRowKind(cell);

      if (have !== want || have === "none") {
        // Rebuild just this cell. None of the three kinds holds a caret unless
        // it is the focused measured input, which only ever stays "input".
        const fresh = document.createElement("tbody");
        fresh.innerHTML = rowHtml(group, gi, row, ri, canEdit);
        const newCell = fresh.querySelector(`[data-value-cell="${key}"]`);
        if (newCell) cell.replaceWith(newCell);
      } else if (want === "calc") {
        const number = cell.querySelector(".calc-number");
        if (number && number.textContent !== String(row.value)) number.textContent = row.value;
      } else if (want === "input" && key !== focused?.key) {
        // Keep an un-focused measured box in step with state (e.g. after a
        // "Clear this test" or an override change elsewhere).
        const box = cell.querySelector("[data-result-input]");
        if (box && box.value !== String(row.value ?? "")) box.value = String(row.value ?? "");
      }
    });
  });

  // Typing is never interrupted: put the caret back exactly where it was.
  if (focused) {
    const box = document.querySelector(`[data-value-cell="${focused.key}"] [data-result-input]`);
    if (box && document.activeElement !== box) {
      box.focus();
      try { box.setSelectionRange(focused.start, focused.end); } catch { /* number inputs disallow it */ }
    }
  }
}

// ---------------------------------------------------------------- panels

/**
 * The notices and the pathologist's comment box.
 *
 * Everything the engine could not do, and everything it proposes to say, is
 * shown to the person entering the report rather than discovered later by
 * whoever reads it.
 */
function renderMedicalPanels() {
  renderNotices();
  renderInterpretationPanel();
}

function renderNotices() {
  const host = $("#medicalNotices");
  if (!host) return;

  if (!analysis) {
    host.innerHTML = analyseError
      ? `<div class="card" style="margin-top:14px;border-left:4px solid var(--danger);">
           <div class="card-head"><h2>Calculation engine error</h2></div>
           <p class="small">The automatic calculations could not run: ${esc(analyseError)}.
           Entered values are safe. Reload the page; if it persists, report this message.</p>
         </div>`
      : "";
    return;
  }

  const items = [];
  analysis.notices.forEach((n) => items.push(`<li><b>${esc(n.name)}</b> — ${esc(n.reason)}</li>`));
  if (analysis.cycles.length) {
    items.push(`<li><b>Circular dependency</b> — ${esc(analysis.cycles.join(", "))} were not calculated.</li>`);
  }
  const footer = validationFooter(analysis, medicalConfig);

  if (!items.length && !footer.length) { host.innerHTML = ""; return; }
  host.innerHTML = `
    <div class="card" style="margin-top:14px;border-left:4px solid var(--warn);">
      <div class="card-head"><h2>Calculation notices</h2></div>
      ${items.length ? `<ul class="small" style="margin:0 0 10px;padding-left:18px;line-height:1.7;">${items.join("")}</ul>` : ""}
      ${footer.map((line) => `<p class="small muted" style="margin:0 0 6px;">${esc(line)}</p>`).join("")}
    </div>`;
}

function renderInterpretationPanel() {
  const host = $("#interpretationPanel");
  if (!host) return;
  if (!analysis || !current.booking) { host.innerHTML = ""; return; }

  const draft = analysis.draft;
  const record = interpretation;
  const approved = record?.clinicallyValidated === true;
  const blockers = releaseBlockers(analysis, { interpretationRecord: record, signatories: reportSettings.signatories || [] });
  const canReview = sessionCan(P.REPORT_APPROVE, ctx.session);

  host.innerHTML = `
    <div class="card" style="margin-top:14px;border-left:4px solid ${approved ? "var(--ok)" : "var(--warn)"};">
      <div class="card-head"><h2>Interpretation</h2><span class="spacer"></span>
        ${approved
          ? `<span class="pill ok">Approved by ${esc(record.approvedBy)}</span>`
          : `<span class="pill warn">Pathologist review required</span>`}
      </div>

      ${analysis.criticalRows.length ? `
        <p class="small" style="background:var(--danger-bg,#ffe9e9);padding:10px;border-radius:6px;">
          <b>CRITICAL RESULT.</b> ${esc(analysis.criticalRows.map((r) => `${r.name} ${r.value} ${r.unit || ""}`.trim()).join("; "))}.
          A result in this range is usually telephoned to the treating clinician before the report is sent,
          and the call recorded. This report is held for pathologist review.
        </p>` : ""}

      ${analysis.lights?.applicable ? `
        <div class="small" style="background:var(--surface-2);padding:10px;border-radius:6px;margin-bottom:8px;">
          <b>Light's criteria</b> <span class="pill warn" style="font-size:.62rem;">requires medical validation</span>
          <ul style="margin:6px 0 4px;padding-left:18px;line-height:1.6;">
            ${analysis.lights.criteria.map((c) => `<li>Criterion ${c.n} — ${esc(c.name)}:
              <b>${c.met === null ? "not evaluated" : (c.met ? "MET" : "not met")}</b>
              <span class="muted">${esc(c.detail)}</span></li>`).join("")}
          </ul>
          <div class="muted">${esc(analysis.lights.summary)}</div>
        </div>` : ""}

      <div class="small" style="white-space:pre-wrap;background:var(--surface-2);padding:12px;border-radius:6px;">${
        esc(approved ? releasableText(record) : (record?.finalText || draft.text || "No comment proposed."))
      }</div>

      ${approved ? `
        <p class="small muted" style="margin-top:8px;">
          Approved by ${esc(record.approvedBy)}${record.approvedAt ? ` on ${esc(String(record.approvedAt).slice(0, 10))}` : ""}.
          This text prints on the report.
        </p>`
      : `<p class="small muted" style="margin-top:8px;">
          This is a draft written by the software from the flagged results. It is not a finding and it does
          not print until a pathologist of this laboratory has read it, edited it if needed, and approved it.
        </p>`}

      ${blockers.length ? `
        <ul class="small" style="margin:10px 0 0;padding-left:18px;line-height:1.7;">
          ${blockers.map((b) => `<li>${esc(b.text)}</li>`).join("")}
        </ul>` : ""}

      ${canReview ? `<div class="btn-row" style="margin-top:12px;">
        <button class="btn btn-sm ${approved ? "btn-outline" : "btn-green"}" data-interp-approve type="button">
          ${approved ? "Review again" : "Review and approve"}</button>
      </div>` : `<p class="small muted" style="margin-top:10px;">Only a pathologist, admin or owner may approve this.</p>`}
    </div>`;
}

/** The pathologist's own screen: read the draft, change it, put a name to it. */
function openInterpretationReview() {
  if (!analysis) return;
  const authorised = (reportSettings.signatories || []).filter((s) => s.canApproveReports === true);
  const record = interpretation || newInterpretationRecord(analysis.draft);
  const startingText = record.finalText || record.generatedText || analysis.draft.text || "";

  if (!authorised.length) {
    const { element, close } = openModal({
      title: "No authorised pathologist on record",
      body: `<p class="small">An interpretation can only be approved by a pathologist this laboratory has
        authorised to sign clinical reports. None is recorded yet, so this comment cannot be released.</p>
        <p class="small muted">Add one under <b>Settings → Report signatories</b> and tick
        <i>May approve and sign clinical reports</i>.</p>`,
      footer: `<button class="btn btn-outline" data-act="close" type="button">Close</button>`
    });
    element.querySelector('[data-act="close"]').addEventListener("click", close);
    return;
  }

  const { element, close } = openModal({
    title: "Pathologist review",
    wide: true,
    body: `
      <p class="small muted">
        The software proposes wording from the flagged results. It does not diagnose, and it has no clinical
        authority. What you approve below is your comment, in your words, over your name.
      </p>
      ${analysis.criticalRows.length ? `
        <p class="small" style="background:var(--danger-bg,#ffe9e9);padding:10px;border-radius:6px;">
          <b>Critical result on this report:</b>
          ${esc(analysis.criticalRows.map((r) => `${r.name} ${r.value} ${r.unit || ""}`.trim()).join("; "))}.
        </p>` : ""}
      <label class="small">Comment as it will print
        <textarea id="interpText" class="input" rows="10" style="font-family:inherit;">${esc(startingText)}</textarea>
      </label>
      <label class="small">Approving pathologist
        <select id="interpBy" class="input">
          ${authorised.map((s) => `<option value="${esc(s.name)}">${esc(s.name)}${s.registrationNumber ? ` · Reg. ${esc(s.registrationNumber)}` : ""}</option>`).join("")}
        </select>
      </label>
      <p class="small muted">
        Approving records your name and the time against this text. The software's original draft is kept
        alongside it, so what was proposed and what was released can always be compared.
      </p>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn btn-outline" data-act="save" type="button">Save without approving</button>
             <button class="btn btn-green" data-act="approve" type="button">Approve</button>`
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);

  element.querySelector('[data-act="save"]').addEventListener("click", async (event) => {
    setBusy(event.target, true, "Saving...");
    try {
      interpretation = applyEdit(record, element.querySelector("#interpText").value,
        { name: ctx.session?.name || ctx.session?.email || "" });
      await saveDraft({ silent: true });
      toastOk("Comment saved. It stays unapproved and will not print.");
      close();
      renderMedicalPanels();
    } catch (error) {
      reportError(error, "Could not save the comment.");
      setBusy(event.target, false);
    }
  });

  element.querySelector('[data-act="approve"]').addEventListener("click", async (event) => {
    const text = element.querySelector("#interpText").value.trim();
    if (!text) return toastError("There is nothing to approve. Write a comment, or cancel.");
    const name = element.querySelector("#interpBy").value;
    setBusy(event.target, true, "Approving...");
    try {
      const edited = applyEdit(record, text, { name: ctx.session?.name || ctx.session?.email || "" });
      interpretation = approveInterpretation(edited, { name }, { authorisedSignatories: authorised });
      await saveDraft({ silent: true });
      logAudit(AUDIT.REPORT_APPROVED, {
        entityType: "report", entityId: current.report?.reportId || current.booking?.bookingId,
        summary: `Interpretation approved by ${name}`
      });
      toastOk(`Interpretation approved by ${name}.`);
      close();
      renderMedicalPanels();
    } catch (error) {
      toastError(error.message || "Could not approve the interpretation.");
      setBusy(event.target, false);
    }
  });
}

/**
 * Replace a calculated value with a typed one.
 *
 * Allowed, because an analyser or a pathologist can be right where a formula
 * is not - but never silently. The override is recorded as manually verified,
 * the reason is kept, and the value stops being recalculated.
 */
async function offerOverride(key) {
  const [gi, ri] = key.split(":").map(Number);
  const row = current.groups[gi]?.rows[ri];
  if (!row) return;

  const { element, close } = openModal({
    title: `Override ${row.name}`,
    body: `
      <p class="small">This value is calculated as <b>${esc(row.value)}${row.unit ? ` ${esc(row.unit)}` : ""}</b>
      from <code>${esc(row.formulaText || "")}</code>.</p>
      <label class="small">Value to report instead
        <input id="ovValue" class="input" inputmode="decimal" value="${esc(row.value)}"></label>
      <label class="small">Reason
        <input id="ovReason" class="input" placeholder="e.g. Direct measurement on the analyser."></label>
      <p class="small muted">The entered value replaces the calculated one and is no longer recalculated.
      The reason is kept with the report.</p>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Use this value</button>`
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", () => {
    const reason = element.querySelector("#ovReason").value.trim();
    if (!reason) return toastError("Please give a reason. An unexplained override cannot be reviewed.");
    row.value = element.querySelector("#ovValue").value.trim();
    row.origin = VALUE_ORIGIN.MANUALLY_VERIFIED;
    row.overrideReason = reason;
    row.overriddenBy = ctx.session?.name || ctx.session?.email || "";
    delete row.calculated;
    logAudit(AUDIT.REPORT_SAVED, {
      entityType: "report", entityId: current.report?.reportId || current.booking?.bookingId,
      summary: `${row.name} overridden to ${row.value}: ${reason}`
    });
    close();
    analyse();
    renderCards();
    renderMedicalPanels();
    toastOk("Override recorded.");
  });
}

function updateCardStatus(gi) {
  const group = current.groups[gi];
  const progress = Reports.groupProgress(group);
  const card = document.querySelector(`[data-card="${gi}"]`);
  if (!card) return;
  const complete = progress.label === "Completed";
  card.classList.toggle("is-complete", complete);
  const status = card.querySelector(`[data-card-status="${gi}"]`);
  if (status) {
    status.textContent = progress.label;
    status.className = `pill ${complete ? "ok" : progress.measuredEntered ? "warn" : ""}`;
  }
  const calcBit = progress.calculatedTotal ? ` · ${progress.calculatedOk}/${progress.calculatedTotal} calculated` : "";
  const meta = card.querySelector(".meta");
  if (meta) {
    meta.textContent = `${group.testCode}${group.sample ? ` · ${group.sample}` : ""} · `
      + `${progress.measuredEntered} of ${progress.measuredTotal} values entered${calcBit}`;
  }
  const bar = card.querySelector(".progress-bar > i");
  if (bar) bar.style.width = `${progress.measuredTotal ? Math.round((progress.measuredEntered / progress.measuredTotal) * 100) : 0}%`;
}

function renderProgress() {
  const p = Reports.gridProgress(current.groups);
  const calcBit = p.calculatedTotal
    ? ` <span class="muted">· ${p.calculatedOk}/${p.calculatedTotal} calculated</span>` : "";
  $("#reportEntryProgress").innerHTML = `
    <div class="row-flex">
      ${progressBar(p.measuredEntered, p.measuredTotal)}
      <span class="small"><b>${p.measuredEntered}</b> of <b>${p.measuredTotal}</b> measured values entered${calcBit}</span>
      ${p.complete ? '<span class="pill ok">All results complete</span>' : ""}
    </div>`;
}

async function saveCard(index) {
  const ok = await saveDraft({ silent: true });
  if (!ok) return;
  const card = document.querySelector(`[data-card="${index}"]`);
  if (card) card.dataset.open = "false";
  toastOk(`${current.groups[index]?.testName || "Test"} saved.`);
}

async function clearCard(index) {
  const group = current.groups[index];
  if (!await confirmAction(`Clear every result entered for ${group.testName}?`, { danger: true, confirmLabel: "Clear" })) return;
  group.rows.forEach((row) => {
    row.value = ""; row.flag = "";
    delete row.calculated; delete row.calcPending; delete row.calcPendingReason;
    if (row.origin !== VALUE_ORIGIN.MEASURED) delete row.origin;
  });
  analyse();            // re-derive: calculated rows go back to "waiting for input"
  renderCards();
  await saveDraft({ silent: true });
  toastOk(`${group.testName} cleared.`);
}

async function saveDraft({ silent = false } = {}) {
  if (!current.booking) { toastError("Open a booking first."); return false; }
  if (!sessionCanWrite(P.REPORT_ENTER, ctx.session)) { toastError("You do not have permission to enter results."); return false; }
  // Recalculate before persisting, so a stored report never carries a stale or
  // missing calculated value even if the grid was not touched since it loaded.
  analyse();
  if (!silent) setBusy("#saveDraftBtn", true, "Saving...");
  try {
    const saved = await Reports.saveReportDraft({
      bookingId: current.booking.bookingId,
      booking: current.booking,
      groups: current.groups,
      templateId: reportSettings.templateId || ctx.branding.reportTemplate,
      sampleType: current.groups[0]?.sample || "",
      createdAt: current.report?.createdAt,
      // What PRINTS is only ever what a pathologist approved. releasableText()
      // returns an empty string until then, so an unapproved draft cannot
      // reach a report by any path.
      interpretation: interpretation ? releasableText(interpretation) : "",
      // The record behind it - the software's draft, the edit, the approval -
      // travels with the report so a reissued copy can always be traced.
      interpretationRecord: interpretation || null,
      medicalNotices: analysis ? validationFooter(analysis, medicalConfig) : [],
      // Keep the verification link across re-saves so the QR is never lost.
      verifyUrl: current.report?.verifyUrl || ""
    }, { actor: ctx.session });
    current.report = saved;
    dbg("PERSISTENCE", {
      reportId: saved.reportId,
      saved: current.groups.flatMap((g) => g.rows
        .filter((r) => !r.isHeading && String(r.value ?? "").trim() !== "")
        .map((r) => `${r.parameterId || r.name}=${r.value}${r.calculated ? " (calc)" : ""}`)),
      status: "saved successfully"
    });
    if (!silent) toastOk("Draft saved.");
    renderMeta();
    ctx.onChanged?.();
    return true;
  } catch (error) {
    reportError(error, "Could not save the report.");
    return false;
  } finally {
    if (!silent) setBusy("#saveDraftBtn", false);
  }
}

async function approve() {
  if (!current.report && !(await saveDraft({ silent: true }))) return;
  if (!sessionCan(P.REPORT_APPROVE, ctx.session)) return toastError("Only a pathologist, admin or owner may approve reports.");

  // Recalculate everything one last time, and refuse to release if the engine
  // itself failed - a report must not go out with calculations in an unknown
  // state.
  analyse();
  if (analyseError) {
    return toastError(`Cannot approve: the calculation engine failed (${analyseError}). Reload and try again.`);
  }

  // A pathologist must have seen anything the engine held back, before a
  // patient can. Blocking, not advisory: this is the gate the whole review
  // workflow exists for.
  if (analysis) {
    const blockers = releaseBlockers(analysis, {
      interpretationRecord: interpretation,
      signatories: reportSettings.signatories || []
    });
    const hard = blockers.filter((b) => b.kind === "CRITICAL" || b.kind === "REVIEW");
    const unapproved = interpretation && !interpretation.clinicallyValidated
      && String(interpretation.generatedText || "").trim();

    if (hard.length && !interpretation?.clinicallyValidated) {
      const proceed = await confirmAction(
        `${hard.map((b) => b.text).join(" ")} Open the pathologist review now?`,
        { title: "Pathologist review required", confirmLabel: "Open review" });
      if (proceed) openInterpretationReview();
      return;
    }
    if (unapproved) {
      const proceed = await confirmAction(
        "The interpretive comment has not been approved by a pathologist, so it will NOT be printed on the "
        + "report. Release the report without it?",
        { danger: true, confirmLabel: "Release without the comment" });
      if (!proceed) return;
    }
  }

  const progress = Reports.gridProgress(current.groups);
  if (progress.entered < progress.total) {
    const proceed = await confirmAction(
      `${progress.total - progress.entered} parameter(s) are still blank. Approve and release anyway?`,
      { danger: true, confirmLabel: "Approve anyway" });
    if (!proceed) return;
  }

  const signatories = await listSignatories().catch(() => []);
  let signatory = signatories.find((s) => s.uid === ctx.session.uid) || signatories[0] || null;

  if (signatories.length > 1) {
    signatory = await pickSignatory(signatories);
    if (!signatory) return;
  }

  setBusy("#approveReportBtn", true, "Approving...");
  try {
    await saveDraft({ silent: true });
    await Reports.approveReport(current.report.reportId, {
      actor: ctx.session,
      signatory: signatory ? {
        name: signatory.name, qualification: signatory.qualification,
        designation: signatory.designation, registrationNumber: signatory.registrationNumber,
        signatureUrl: signatory.signatureUrl
      } : null
    });
    current.report = await Reports.getReport(current.report.reportId);

    // Mint the share link now, so the QR printed on the report resolves. A
    // patient scanning the page with a phone camera must land on their report;
    // a QR that 404s is worse than no QR. Persist it on the report so the QR
    // also prints from a reopened report and from the patient portal - not
    // only from this session or the WhatsApp viewer.
    try {
      const { url } = await createShareLink({
        report: current.report, booking: current.booking, actor: ctx.session
      });
      current.report.verifyUrl = url;
      await Reports.saveReportVerifyUrl(current.report.reportId, url);
    } catch (error) {
      console.warn("[REPORT QR] share link not created; the printed QR will be omitted", error?.message);
    }

    renderMeta();
    toastOk("Report approved and released to the patient.");
    ctx.onChanged?.();
    offerShare();
  } catch (error) {
    reportError(error, "Could not approve the report.");
  } finally {
    setBusy("#approveReportBtn", false);
  }
}

function pickSignatory(signatories) {
  return new Promise((resolve) => {
    const { element, close } = openModal({
      title: "Who is signing this report?",
      body: `<label class="field"><span>Signatory</span><select id="sigPick">
        ${signatories.map((s) => `<option value="${esc(s.uid)}">${esc(s.name)} — ${esc(s.qualification || s.designation || "")}</option>`).join("")}
      </select></label>`,
      footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
               <button class="btn" data-act="ok" type="button">Approve</button>`,
      onClose: () => resolve(null)
    });
    element.querySelector('[data-act="cancel"]').addEventListener("click", () => { close(); resolve(null); });
    element.querySelector('[data-act="ok"]').addEventListener("click", () => {
      const uid = element.querySelector("#sigPick").value;
      element.remove();
      resolve(signatories.find((s) => s.uid === uid) || null);
    });
  });
}

async function preview() {
  if (!current.booking) return toastError("Open a booking first.");

  // Recalculate so the PDF shows the current calculated values, not whatever
  // was last painted.
  analyse();

  // A released report gets its real link so the QR in the preview is the one
  // that will be printed. A draft has none yet, and prints without a QR.
  let verifyUrl = current.report?.verifyUrl || "";
  if (!verifyUrl && current.report?.reportStatus === "Final") {
    try {
      const { url } = await createShareLink({
        report: current.report, booking: current.booking, actor: ctx.session
      });
      verifyUrl = url;
      // Persist it so it is on the document next time, and the patient portal
      // and any later reopen print the same QR without minting again.
      current.report.verifyUrl = url;
      await Reports.saveReportVerifyUrl(current.report.reportId, url).catch(() => {});
    } catch { /* preview without the QR rather than blocking the print */ }
  }
  if (!verifyUrl && current.report?.reportStatus === "Final") {
    console.warn("[REPORT QR] a released report is being previewed without a verification link; the QR will be omitted");
  }

  const report = {
    ...(current.report || {}),
    ...current.booking,
    reportId: current.report?.reportId || current.booking.bookingId,
    groups: current.groups,
    reportStatus: current.report?.reportStatus || "Draft",
    reportingDate: current.report?.reportingDate || new Date().toISOString(),
    collectionDate: current.report?.collectionDate || current.booking.scheduledAt || "",
    registeredDate: current.booking.createdAt || "",
    verifyUrl
  };
  try { printReport(report, ctx.branding, reportSettings); }
  catch (error) { toastError(error.message); }
}

function offerShare() {
  if (!sessionCan(P.REPORT_SHARE, ctx.session)) return;
  const { element, close } = openModal({
    title: "Send the report to the patient",
    body: `<p>The report for <b>${esc(current.booking.patientName)}</b> is released.</p>
      <p class="small muted">A secure link is generated that only works while the bill is settled.
      ${current.booking.balanceDue > 0
        ? `<b style="color:var(--danger)">This bill still has ${esc(rupees(current.booking.balanceDue))} outstanding — the patient will see a payment-pending message until it is cleared.</b>`
        : ""}</p>`,
    footer: `<button class="btn btn-outline" data-act="later" type="button">Later</button>
             <button class="btn btn-green" data-act="send" type="button">Send on WhatsApp</button>`
  });
  element.querySelector('[data-act="later"]').addEventListener("click", close);
  element.querySelector('[data-act="send"]').addEventListener("click", async (e) => {
    setBusy(e.target, true, "Preparing link...");
    close();
    await shareOnWhatsApp();
  });
}

async function shareOnWhatsApp() {
  if (!current.report) return toastError("Save and approve the report first.");
  if (current.report.reportStatus !== "Final") return toastError("Only a released report can be shared.");
  try {
    const { url } = await createShareLink({
      report: current.report, booking: current.booking, actor: ctx.session
    });
    const result = await sendReportReady({
      report: { ...current.report, phone: current.booking.phone, whatsapp: current.booking.whatsapp },
      branding: ctx.branding,
      reportLink: url
    });
    if (result.delivered) toastOk("Report sent on WhatsApp.");
    else if (result.mode === "disabled") toastWarn(result.note);
    else toastOk(result.note);
  } catch (error) {
    reportError(error, "Could not create the share link.");
  }
}
