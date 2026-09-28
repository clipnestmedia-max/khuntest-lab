// Culture & Sensitivity result entry - the organism/antibiotic workflow that
// report-entry.js delegates to for any booked test whose catalogue entry has
// reportType === "cultureSensitivity" (see core/data/tests.js). Kept in its
// own module for the same reason machine-results-screen.js and
// booking-screen.js are separate: report-entry.js already drives the flat
// numeric-parameter grid for every other test and does not need this whole
// second, structurally different workflow mixed into it.
//
// State shape lives on the report document as `cultureResults[]` (see
// core/data/reports.js), one entry per C&S test booked. It never touches
// `groups[]`, so the numeric flagging/calculation engine and every existing
// report keep working completely unchanged.
import * as Culture from "../core/data/culture.js";
import { esc, toastError, toastWarn, confirmAction } from "../core/ui.js";

let masters = { specimens: [], organisms: [], antibiotics: [], panels: [], breakpoints: [] };
let mastersLoaded = false;

export async function loadCultureMasters(force = false) {
  if (mastersLoaded && !force) return masters;
  const [specimens, organisms, antibiotics, panels, breakpoints] = await Promise.all([
    Culture.loadSpecimens({ activeOnly: true }), Culture.loadOrganisms({ activeOnly: true }),
    Culture.loadAntibiotics({ activeOnly: true }), Culture.loadPanels({ activeOnly: true }),
    Culture.loadBreakpoints({ activeOnly: true })
  ]);
  masters = { specimens, organisms, antibiotics, panels, breakpoints };
  mastersLoaded = true;
  return masters;
}

export function isCultureTest(test) {
  return test?.reportType === "cultureSensitivity";
}

/** A blank C&S block for one booked test, or the saved one if this report already has it. */
export function cultureResultFor(test, existing = []) {
  const found = existing.find((c) => c.testId === (test.testId || test.id) || c.testCode === test.testCode);
  if (found) return { ...found, organisms: (found.organisms || []).map((o) => ({ ...o, sensitivities: [...(o.sensitivities || [])] })) };
  return {
    testId: test.testId || test.id || "", testCode: test.testCode || "", testName: test.name || test.testName || "",
    specimenId: "", cultureResult: "Pending",
    colonyCount: "", colonyCountUnit: "",
    gramStain: "", pusCells: "", rbc: "", epithelialCells: "", otherFindings: "",
    organisms: [],
    resistanceMarkers: {},
    comments: ""
  };
}

function newOrganismBlock() {
  return { organismId: "", organismName: "", sensitivities: [] };
}

function newSensitivityRow(antibioticId = "") {
  const abx = masters.antibiotics.find((a) => a.id === antibioticId);
  return {
    antibioticId, antibioticName: abx?.displayName || "",
    testingMethod: abx?.testingMethod || Culture.TESTING_METHODS[0],
    micValue: "", micUnit: abx?.micUnit || "µg/mL",
    zoneDiameter: "", zoneUnit: "mm",
    sir: "NT", auto: false, breakpointId: null, standard: "", standardVersion: "",
    // Optional zone-of-inhibition grading some labs print alongside a plain
    // S/R call (e.g. "S(++++)") instead of, or in addition to, a numeric MIC/
    // zone value - purely a display convention, never fed into interpretSIR().
    grade: "",
    comment: ""
  };
}

/** Recalculate S/I/R for one row from its current MIC/zone, in place. Never guesses without a breakpoint. */
export function recalcRow(organismId, row) {
  if (row.micValue === "" && row.zoneDiameter === "") { return; } // nothing entered - leave whatever the user chose (NT by default)
  const bp = Culture.findBreakpoint(masters.breakpoints, {
    organismId, antibioticId: row.antibioticId, testingMethod: row.testingMethod
  });
  const result = Culture.interpretSIR(bp, { micValue: row.micValue, zoneDiameter: row.zoneDiameter });
  if (result.sir) {
    row.sir = result.sir; row.auto = true;
    row.breakpointId = result.breakpointId; row.standard = result.standard; row.standardVersion = result.standardVersion;
  } else {
    row.auto = false; row.breakpointId = null;
  }
}

/** "Auto Fill Sensitivity Panel": load the configured antibiotics for this organism's Gram reaction + the block's specimen. */
export function autoFillPanel(cultureResult, organismBlock) {
  const organism = masters.organisms.find((o) => o.id === organismBlock.organismId);
  if (!organism) return { added: 0 };
  const matches = Culture.matchPanels(masters.panels, {
    specimenId: cultureResult.specimenId, gramReaction: organism.gramReaction
  });
  if (!matches.length) return { added: 0, noPanel: true };
  const existingIds = new Set(organismBlock.sensitivities.map((s) => s.antibioticId));
  let added = 0;
  matches.forEach((panel) => {
    panel.antibioticIds.forEach((id) => {
      if (existingIds.has(id)) return;
      const abx = masters.antibiotics.find((a) => a.id === id);
      if (!abx || !abx.isActive) return; // never select an antibiotic the admin deactivated
      organismBlock.sensitivities.push(newSensitivityRow(id));
      existingIds.add(id);
      added += 1;
    });
  });
  return { added };
}

// ---------- rendering ----------

function sirBadgeClass(sir) {
  if (sir === "S") return "ok"; if (sir === "R") return "danger"; if (sir === "I") return "warn"; return "";
}

function specimenOptions(selected) {
  return `<option value="">Select specimen…</option>` +
    masters.specimens.map((s) => `<option value="${esc(s.id)}" ${s.id === selected ? "selected" : ""}>${esc(s.name)}</option>`).join("");
}

function organismOptions(selected) {
  return `<option value="">Select organism…</option>` +
    masters.organisms.map((o) => `<option value="${esc(o.id)}" ${o.id === selected ? "selected" : ""}>${esc(o.name)}</option>`).join("");
}

function antibioticOptions(selected) {
  return `<option value="">Select antibiotic…</option>` +
    masters.antibiotics.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.displayName)}</option>`).join("");
}

function sensitivityRowHtml(ti, oi, si, row) {
  return `<tr data-sens-row="${ti}:${oi}:${si}">
    <td><select data-sens-antibiotic style="min-width:170px;">${antibioticOptions(row.antibioticId)}</select></td>
    <td class="small">${esc(row.testingMethod)}</td>
    <td><input data-sens-mic type="text" inputmode="decimal" value="${esc(row.micValue)}" style="width:70px;" placeholder="MIC"></td>
    <td class="small">${esc(row.micUnit)}</td>
    <td><input data-sens-zone type="text" inputmode="decimal" value="${esc(row.zoneDiameter)}" style="width:60px;" placeholder="Zone"></td>
    <td><select data-sens-sir class="pill ${sirBadgeClass(row.sir)}">
      ${Culture.SIR_VALUES.map((v) => `<option value="${v}" ${v === row.sir ? "selected" : ""}>${esc(v)}</option>`).join("")}
    </select>${row.auto ? ` <span class="small muted" title="Auto-interpreted from ${esc(row.standard)} ${esc(row.standardVersion)}">auto</span>` : ""}</td>
    <td><select data-sens-grade title="Optional zone-of-inhibition grading, printed as e.g. S(++++)" style="width:70px;">
      ${["", "+", "++", "+++", "++++"].map((g) => `<option value="${g}" ${g === (row.grade || "") ? "selected" : ""}>${g || "—"}</option>`).join("")}
    </select></td>
    <td><input data-sens-comment type="text" value="${esc(row.comment)}" placeholder="Comment" style="width:110px;"></td>
    <td><button class="btn btn-sm btn-ghost" data-remove-sens type="button">×</button></td>
  </tr>`;
}

function organismBlockHtml(ti, oi, organismBlock) {
  return `<div class="card" style="margin:10px 0;background:var(--surface-2);" data-organism-block="${ti}:${oi}">
    <div class="row-flex">
      <label class="field" style="flex:1;margin:0;"><span>Organism ${oi + 1}</span>
        <select data-organism-select>${organismOptions(organismBlock.organismId)}</select></label>
      <button class="btn btn-sm btn-outline" data-autofill-panel type="button" style="margin-top:20px;">Auto Fill Sensitivity Panel</button>
      <button class="btn btn-sm btn-ghost" data-remove-organism type="button" style="margin-top:20px;">Remove organism</button>
    </div>
    <div class="table-wrap" style="margin-top:8px;"><table class="data">
      <thead><tr><th>Antibiotic</th><th>Method</th><th>MIC</th><th>Unit</th><th>Zone</th><th>S/I/R</th><th>Grade</th><th>Comment</th><th></th></tr></thead>
      <tbody>${organismBlock.sensitivities.map((row, si) => sensitivityRowHtml(ti, oi, si, row)).join("")
        || `<tr><td colspan="9" class="small muted" style="text-align:center;padding:10px;">No antibiotics yet - use Auto Fill or add one.</td></tr>`}</tbody>
    </table></div>
    <p class="small muted" style="margin:6px 0 0;">MIC/Zone are optional — leave them blank and just pick S/I/R (and, if this lab reports it, a grade) when precise values aren't recorded. The printed report shows only what's actually filled in.</p>
    <button class="btn btn-sm btn-ghost" data-add-sens type="button" style="margin-top:8px;">+ Add Antibiotic</button>
  </div>`;
}

function resistanceMarkerRow(ti, marker, value) {
  return `<label class="field" style="max-width:220px;"><span>${esc(marker)}</span>
    <select data-marker="${esc(marker)}">
      ${Culture.RESISTANCE_MARKER_VALUES.map((v) => `<option ${v === (value || "Not Tested") ? "selected" : ""}>${esc(v)}</option>`).join("")}
    </select></label>`;
}

/** Render every C&S block for this report. `ti` (test index into cultureResults[]) keys all delegated handlers. */
export function renderCultureBlocks(cultureResults, canEdit) {
  if (!cultureResults.length) return "";
  return cultureResults.map((cr, ti) => `
    <div class="card" style="margin-top:16px;" data-culture-block="${ti}">
      <div class="card-head"><h2>Culture &amp; Sensitivity — ${esc(cr.testName)}</h2></div>
      <div class="form-grid">
        <label class="field"><span>Specimen</span><select data-cr-specimen ${canEdit ? "" : "disabled"}>${specimenOptions(cr.specimenId)}</select></label>
        <label class="field"><span>Culture Result</span><select data-cr-result ${canEdit ? "" : "disabled"}>
          ${Culture.CULTURE_RESULTS.map((r) => `<option ${r === cr.cultureResult ? "selected" : ""}>${esc(r)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Colony count</span><input data-cr-colony type="text" value="${esc(cr.colonyCount)}" ${canEdit ? "" : "disabled"}></label>
        <label class="field"><span>Unit</span><select data-cr-colony-unit ${canEdit ? "" : "disabled"}>
          <option value="">—</option>
          ${Culture.COLONY_COUNT_UNITS.map((u) => `<option ${u === cr.colonyCountUnit ? "selected" : ""}>${esc(u)}</option>`).join("")}
        </select></label>
      </div>

      <details style="margin:10px 0;">
        <summary class="small" style="cursor:pointer;font-weight:600;">Microscopy / Gram stain (optional)</summary>
        <div class="form-grid" style="margin-top:8px;">
          <label class="field"><span>Gram stain</span><input data-cr-gram type="text" value="${esc(cr.gramStain)}" placeholder="e.g. Gram Negative Bacilli" ${canEdit ? "" : "disabled"}></label>
          <label class="field"><span>Pus cells</span><input data-cr-pus type="text" value="${esc(cr.pusCells)}" ${canEdit ? "" : "disabled"}></label>
          <label class="field"><span>RBC</span><input data-cr-rbc type="text" value="${esc(cr.rbc)}" ${canEdit ? "" : "disabled"}></label>
          <label class="field"><span>Epithelial cells</span><input data-cr-epithelial type="text" value="${esc(cr.epithelialCells)}" ${canEdit ? "" : "disabled"}></label>
        </div>
        <label class="field"><span>Other findings</span><input data-cr-other type="text" value="${esc(cr.otherFindings)}" ${canEdit ? "" : "disabled"}></label>
      </details>

      ${cr.cultureResult !== "No Growth" && cr.cultureResult !== "Pending" ? `
        <h4 style="margin:14px 0 4px;">Organisms</h4>
        ${cr.organisms.map((o, oi) => organismBlockHtml(ti, oi, o)).join("")}
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-add-organism type="button">+ Add Organism</button>` : ""}

        <h4 style="margin:16px 0 4px;">Resistance markers</h4>
        <div class="row-flex">
          ${Culture.DEFAULT_RESISTANCE_MARKERS.map((m) => resistanceMarkerRow(ti, m, cr.resistanceMarkers[m])).join("")}
        </div>` : ""}

      <label class="field" style="margin-top:14px;"><span>Comments / interpretation</span>
        <textarea data-cr-comments rows="3" ${canEdit ? "" : "disabled"}>${esc(cr.comments)}</textarea></label>
    </div>`).join("");
}

/**
 * Wire delegated events for a rendered culture section. `getState`/`onChange`
 * let the caller (report-entry.js) own `current.cultureResults` as the single
 * source of truth - this module only mutates it and asks for a re-render (or,
 * for a plain text field, just updates state with no re-render so typing
 * never loses focus).
 */
export function bindCultureSection(container, { getState, rerender, onChange }) {
  const cr = () => getState();

  container.addEventListener("change", (event) => {
    const el = event.target;
    const block = el.closest("[data-culture-block]");
    if (!block) return;
    const ti = Number(block.dataset.cultureBlock);
    const result = cr()[ti];
    if (!result) return;

    if (el.matches("[data-cr-specimen]")) { result.specimenId = el.value; onChange(); return rerender(); }
    if (el.matches("[data-cr-result]")) { result.cultureResult = el.value; onChange(); return rerender(); }
    if (el.matches("[data-cr-colony]")) { result.colonyCount = el.value; return onChange(); }
    if (el.matches("[data-cr-colony-unit]")) { result.colonyCountUnit = el.value; return onChange(); }
    if (el.matches("[data-cr-gram]")) { result.gramStain = el.value; return onChange(); }
    if (el.matches("[data-cr-pus]")) { result.pusCells = el.value; return onChange(); }
    if (el.matches("[data-cr-rbc]")) { result.rbc = el.value; return onChange(); }
    if (el.matches("[data-cr-epithelial]")) { result.epithelialCells = el.value; return onChange(); }
    if (el.matches("[data-cr-other]")) { result.otherFindings = el.value; return onChange(); }
    if (el.matches("[data-marker]")) { result.resistanceMarkers[el.dataset.marker] = el.value; return onChange(); }

    const orgBlockEl = el.closest("[data-organism-block]");
    if (orgBlockEl) {
      const [, oi] = orgBlockEl.dataset.organismBlock.split(":").map(Number);
      const organism = result.organisms[oi];
      if (!organism) return;
      if (el.matches("[data-organism-select]")) {
        organism.organismId = el.value;
        organism.organismName = masters.organisms.find((o) => o.id === el.value)?.name || "";
        onChange(); return rerender();
      }
      const sensRow = el.closest("[data-sens-row]");
      if (sensRow) {
        const [, , si] = sensRow.dataset.sensRow.split(":").map(Number);
        const row = organism.sensitivities[si];
        if (!row) return;
        if (el.matches("[data-sens-antibiotic]")) {
          const abx = masters.antibiotics.find((a) => a.id === el.value);
          row.antibioticId = el.value; row.antibioticName = abx?.displayName || "";
          row.testingMethod = abx?.testingMethod || row.testingMethod; row.micUnit = abx?.micUnit || row.micUnit;
          recalcRow(organism.organismId, row);
          onChange(); return rerender();
        }
        if (el.matches("[data-sens-sir]")) { row.sir = el.value; row.auto = false; return onChange(); }
        if (el.matches("[data-sens-grade]")) { row.grade = el.value; return onChange(); }
      }
    }
  });

  container.addEventListener("input", (event) => {
    const el = event.target;
    const block = el.closest("[data-culture-block]");
    if (!block) return;
    const ti = Number(block.dataset.cultureBlock);
    const result = cr()[ti];
    if (!result) return;
    if (el.matches("[data-cr-comments]")) { result.comments = el.value; return onChange(); }

    const sensRow = el.closest("[data-sens-row]");
    if (!sensRow) return;
    const [, oi, si] = sensRow.dataset.sensRow.split(":").map(Number);
    const organism = result.organisms[oi];
    const row = organism?.sensitivities[si];
    if (!row) return;
    if (el.matches("[data-sens-mic]")) row.micValue = el.value;
    else if (el.matches("[data-sens-zone]")) row.zoneDiameter = el.value;
    else if (el.matches("[data-sens-comment]")) { row.comment = el.value; return onChange(); }
    else return;

    recalcRow(organism.organismId, row);
    onChange();
    // Targeted patch, not a full re-render, so the field the user is typing
    // in never loses focus - only the S/I/R cell in this same row updates.
    const sirSelect = sensRow.querySelector("[data-sens-sir]");
    if (sirSelect) {
      sirSelect.value = row.sir;
      sirSelect.className = `pill ${sirBadgeClass(row.sir)}`;
      const autoTag = sensRow.querySelector(".muted");
      if (row.auto && !autoTag) sirSelect.insertAdjacentHTML("afterend", ` <span class="small muted">auto</span>`);
      if (!row.auto && autoTag) autoTag.remove();
    }
  });

  container.addEventListener("click", async (event) => {
    const el = event.target;
    const block = el.closest("[data-culture-block]");
    if (!block) return;
    const ti = Number(block.dataset.cultureBlock);
    const result = cr()[ti];
    if (!result) return;

    if (el.closest("[data-add-organism]")) {
      result.organisms.push(newOrganismBlock());
      onChange(); return rerender();
    }
    const orgBlockEl = el.closest("[data-organism-block]");
    if (orgBlockEl) {
      const [, oi] = orgBlockEl.dataset.organismBlock.split(":").map(Number);
      const organism = result.organisms[oi];
      if (!organism) return;

      if (el.closest("[data-remove-organism]")) {
        if (!await confirmAction("Remove this organism and its sensitivity results?", { danger: true })) return;
        result.organisms.splice(oi, 1);
        onChange(); return rerender();
      }
      if (el.closest("[data-autofill-panel]")) {
        if (!organism.organismId) return toastWarn("Select an organism first.");
        const { added, noPanel } = autoFillPanel(result, organism);
        if (noPanel) toastWarn("No antibiotic panel is configured for this specimen/organism yet. Add one under Culture & Sensitivity → Antibiotic panels.");
        else if (!added) toastWarn("Every antibiotic in the configured panel is already listed.");
        onChange(); return rerender();
      }
      if (el.closest("[data-add-sens]")) {
        organism.sensitivities.push(newSensitivityRow());
        onChange(); return rerender();
      }
      const sensRow = el.closest("[data-sens-row]");
      if (sensRow && el.closest("[data-remove-sens]")) {
        const [, , si] = sensRow.dataset.sensRow.split(":").map(Number);
        organism.sensitivities.splice(si, 1);
        onChange(); return rerender();
      }
    }
  });
}

/** Release-time sanity check, not a bureaucratic approval gate - see spec item 9. */
export function cultureValidationError(cultureResults) {
  for (const cr of cultureResults) {
    if (cr.cultureResult === "No Growth" || cr.cultureResult === "Pending") continue;
    if (!cr.organisms.length) {
      return `${cr.testName}: "${cr.cultureResult}" needs at least one organism before this report can be released.`;
    }
    for (const o of cr.organisms) {
      if (!o.organismId) return `${cr.testName}: every organism row needs an organism selected.`;
    }
  }
  return "";
}
