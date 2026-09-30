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
import { cultureValidationError, cultureDraftError, isValidMic } from "../core/culture-logic.js";
import { esc, toastError, toastWarn, confirmAction } from "../core/ui.js";

let masters = { specimens: [], organisms: [], antibiotics: [], panels: [], breakpoints: [], ast: Culture.normalizeAstStandard() };
const CUSTOM_SPECIMEN = "__custom__";
let mastersLoaded = false;

export async function loadCultureMasters(force = false) {
  if (mastersLoaded && !force) return masters;
  const [specimens, organisms, antibiotics, panels, breakpoints, ast] = await Promise.all([
    Culture.loadSpecimens({ activeOnly: true }), Culture.loadOrganisms({ activeOnly: true }),
    Culture.loadAntibiotics({ activeOnly: true }), Culture.loadPanels({ activeOnly: true }),
    Culture.loadBreakpoints({ activeOnly: true }),
    Culture.loadAstStandard().catch(() => Culture.normalizeAstStandard())
  ]);
  masters = { specimens, organisms, antibiotics, panels, breakpoints, ast };
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
    specimenId: "", specimenName: "", cultureResult: "Pending",
    // Which standard/version this report was interpreted under. Captured when the
    // block is created so a later change in Lab Settings never rewrites a report.
    astStandard: { name: masters.ast.standardName, version: masters.ast.version, effectiveDate: masters.ast.effectiveDate, show: masters.ast.showOnReport !== false },
    colonyCount: "", colonyCountUnit: "",
    gramStain: "", pusCells: "", rbc: "", epithelialCells: "", otherFindings: "",
    organisms: [],
    resistanceMarkers: {},
    comments: ""
  };
}

function newOrganismBlock() {
  return { organismId: "", organismName: "", sensitivities: [], comments: "" };
}

function newSensitivityRow(antibioticId = "") {
  const abx = masters.antibiotics.find((a) => a.id === antibioticId);
  return {
    antibioticId, antibioticName: abx?.displayName || "",
    testingMethod: abx?.testingMethod || Culture.TESTING_METHODS[0],
    micValue: "", micUnit: abx?.micUnit || "µg/mL",
    zoneDiameter: "", zoneUnit: "mm",
    sir: "", auto: false, breakpointId: null, standard: "", standardVersion: "",
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
  if (!organism) return { added: 0, noPanel: true };
  const matches = Culture.matchPanels(masters.panels, {
    specimenId: cultureResult.specimenId, organismId: organism.id, gramReaction: organism.gramReaction
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

/** Add every antibiotic in `ids` that this organism block does not already list. Returns how many were added. */
export function addAntibiotics(organismBlock, ids) {
  const have = new Set(organismBlock.sensitivities.map((s) => s.antibioticId).filter(Boolean));
  let added = 0;
  ids.forEach((id) => {
    if (have.has(id)) return;
    const abx = masters.antibiotics.find((a) => a.id === id);
    if (!abx) return;
    organismBlock.sensitivities.push(newSensitivityRow(id));
    have.add(id); added += 1;
  });
  return added;
}

// ---------- rendering ----------

function sirBadgeClass(sir) {
  if (sir === "S") return "ok"; if (sir === "R") return "danger"; if (sir === "I") return "warn"; return "";
}

const isCustomSpecimen = (cr) => !cr.specimenId && Boolean(cr.specimenName);

function specimenOptions(cr) {
  return `<option value="">Select specimen…</option>` +
    masters.specimens.map((s) => `<option value="${esc(s.id)}" ${s.id === cr.specimenId ? "selected" : ""}>${esc(s.name)}</option>`).join("") +
    `<option value="${CUSTOM_SPECIMEN}" ${isCustomSpecimen(cr) ? "selected" : ""}>Other / type your own…</option>`;
}

function organismDatalist() {
  return `<datalist id="csOrganismList">${masters.organisms.map((o) => `<option value="${esc(o.name)}"></option>`).join("")}</datalist>`;
}

function antibioticOptions(selected) {
  return `<option value="">Select antibiotic…</option>` +
    masters.antibiotics.map((a) => `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.displayName)}</option>`).join("");
}

function sensitivityRowHtml(ti, oi, si, row) {
  return `<tr data-sens-row="${ti}:${oi}:${si}">
    <td><select data-sens-antibiotic style="min-width:170px;">${antibioticOptions(row.antibioticId)}</select></td>
    <td class="small">${esc(row.testingMethod)}</td>
    <td><input data-sens-mic type="text" inputmode="text" value="${esc(row.micValue)}" style="width:80px;${isValidMic(row.micValue) ? "" : "border-color:var(--danger,#c0392b);"}" placeholder="MIC" title="e.g. 0.5, 16, >16, ≤0.25" aria-invalid="${isValidMic(row.micValue) ? "false" : "true"}"></td>
    <td class="small">${esc(row.micUnit)}</td>
    <td><input data-sens-zone type="text" inputmode="decimal" value="${esc(row.zoneDiameter)}" style="width:60px;" placeholder="Zone"></td>
    <td><select data-sens-sir class="pill ${sirBadgeClass(Culture.normalizeSir(row.sir))}" aria-label="Result">
      ${Culture.SIR_VALUES.map((v) => `<option value="${v}" ${v === Culture.normalizeSir(row.sir) ? "selected" : ""} title="${esc(Culture.SIR_LABELS[v] || "")}">${esc(v ? `${v} — ${Culture.SIR_LABELS[v]}` : "—")}</option>`).join("")}
    </select>${row.auto ? ` <span class="small muted" title="Auto-interpreted from ${esc(row.standard)} ${esc(row.standardVersion)}">auto</span>` : ""}</td>
    <td><select data-sens-grade title="Optional zone-of-inhibition grading, printed as e.g. S(++++)" style="width:70px;">
      ${["", "+", "++", "+++", "++++"].map((g) => `<option value="${g}" ${g === (row.grade || "") ? "selected" : ""}>${g || "—"}</option>`).join("")}
    </select></td>
    <td><input data-sens-comment type="text" value="${esc(row.comment)}" placeholder="Comment" style="width:110px;"></td>
    <td><button class="btn btn-sm btn-ghost" data-remove-sens type="button">×</button></td>
  </tr>`;
}

function antibioticPickerHtml(ti, oi, organismBlock) {
  const have = new Set(organismBlock.sensitivities.map((s) => s.antibioticId));
  return `<details style="margin-top:8px;" data-abx-picker>
    <summary class="small" style="cursor:pointer;font-weight:600;">Select antibiotics (checklist)</summary>
    <input data-abx-filter type="search" placeholder="Search antibiotic…" style="margin:6px 0;width:100%;max-width:280px;">
    <div class="abx-picklist" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:2px 12px;max-height:220px;overflow:auto;">
      ${masters.antibiotics.map((a) => `<label class="small" data-abx-name="${esc((a.displayName + " " + (a.abbreviation || "") + " " + (a.genericName || "")).toLowerCase())}" style="display:flex;gap:6px;align-items:center;">
        <input type="checkbox" data-abx-check value="${esc(a.id)}" ${have.has(a.id) ? "checked disabled" : ""}> ${esc(a.displayName)}</label>`).join("") || `<span class="small muted">No antibiotics in the master list yet.</span>`}
    </div>
    <button class="btn btn-sm btn-outline" data-abx-add type="button" style="margin-top:6px;">Add checked antibiotics</button>
  </details>`;
}

function organismBlockHtml(ti, oi, organismBlock) {
  return `<div class="card" style="margin:10px 0;background:var(--surface-2);" data-organism-block="${ti}:${oi}">
    <div class="row-flex">
      <label class="field" style="flex:1;margin:0;"><span>Organism ${oi + 1} * <span class="small muted">(search the list, or type any organism)</span></span>
        <input data-organism-input type="text" list="csOrganismList" autocomplete="off" value="${esc(organismBlock.organismName)}" placeholder="Search or type organism…"></label>
      <button class="btn btn-sm btn-outline" data-autofill-panel type="button" style="margin-top:20px;">Auto Fill Sensitivity Panel</button>
      <button class="btn btn-sm btn-ghost" data-remove-organism type="button" style="margin-top:20px;">Remove organism</button>
    </div>
    ${antibioticPickerHtml(ti, oi, organismBlock)}
    <div class="table-wrap" style="margin-top:8px;"><table class="data">
      <thead><tr><th>Antibiotic</th><th>Method</th><th>MIC</th><th>Unit</th><th>Zone</th><th>S/I/R</th><th>Grade</th><th>Comment</th><th></th></tr></thead>
      <tbody>${organismBlock.sensitivities.map((row, si) => sensitivityRowHtml(ti, oi, si, row)).join("")
        || `<tr><td colspan="9" class="small muted" style="text-align:center;padding:10px;">No antibiotics yet - use Auto Fill or add one.</td></tr>`}</tbody>
    </table></div>
    <label class="field" style="margin-top:8px;"><span>Organism comment</span>
      <input data-organism-comment type="text" value="${esc(organismBlock.comments || "")}" placeholder="Optional note for this organism"></label>
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
        <label class="field"><span>Specimen *</span><select data-cr-specimen ${canEdit ? "" : "disabled"}>${specimenOptions(cr)}</select>
          ${isCustomSpecimen(cr) || cr.specimenCustom ? `<input data-cr-specimen-custom type="text" value="${esc(cr.specimenName)}" placeholder="Type the specimen" style="margin-top:6px;" ${canEdit ? "" : "disabled"}>` : ""}</label>
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
        ${organismDatalist()}
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

    if (el.matches("[data-cr-specimen]")) {
      if (el.value === CUSTOM_SPECIMEN) { result.specimenId = ""; result.specimenName = ""; result.specimenCustom = true; }
      else {
        result.specimenId = el.value; result.specimenCustom = false;
        result.specimenName = masters.specimens.find((s) => s.id === el.value)?.name || "";
      }
      onChange(); return rerender();
    }
    if (el.matches("[data-cr-specimen-custom]")) { result.specimenName = el.value.trim(); result.specimenId = ""; return onChange(); }
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
      if (el.matches("[data-organism-input]")) {
        const typed = el.value.trim();
        const match = masters.organisms.find((o) => o.name.toLowerCase() === typed.toLowerCase());
        organism.organismId = match?.id || ""; // "" = a lab-typed organism with no master record (manual S/I/R only)
        organism.organismName = match?.name || typed;
        el.value = organism.organismName;
        (organism.sensitivities || []).forEach((row) => recalcRow(organism.organismId, row));
        onChange(); return;
      }
      const sensRow = el.closest("[data-sens-row]");
      if (sensRow) {
        const [, , si] = sensRow.dataset.sensRow.split(":").map(Number);
        const row = organism.sensitivities[si];
        if (!row) return;
        if (el.matches("[data-sens-antibiotic]")) {
          const abx = masters.antibiotics.find((a) => a.id === el.value);
          if (el.value && organism.sensitivities.some((r, i) => i !== si && r.antibioticId === el.value)) {
            toastWarn(`${abx?.displayName || "That antibiotic"} is already listed for this organism.`);
            return rerender();
          }
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
    if (el.matches("[data-abx-filter]")) {
      const q = el.value.trim().toLowerCase();
      el.closest("[data-abx-picker]").querySelectorAll("[data-abx-name]").forEach((l) => { l.style.display = !q || l.dataset.abxName.includes(q) ? "flex" : "none"; });
      return;
    }

    if (el.matches("[data-organism-comment]")) {
      const [, ooi] = el.closest("[data-organism-block]").dataset.organismBlock.split(":").map(Number);
      if (result.organisms[ooi]) result.organisms[ooi].comments = el.value;
      return onChange();
    }
    const sensRow = el.closest("[data-sens-row]");
    if (!sensRow) return;
    const [, oi, si] = sensRow.dataset.sensRow.split(":").map(Number);
    const organism = result.organisms[oi];
    const row = organism?.sensitivities[si];
    if (!row) return;
    if (el.matches("[data-sens-mic]")) {
      row.micValue = el.value;
      const ok = isValidMic(el.value);
      el.style.borderColor = ok ? "" : "var(--danger,#c0392b)";
      el.setAttribute("aria-invalid", ok ? "false" : "true");
      if (!ok) { onChange(); return; } // don't interpret text that is not a MIC
    }
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
      if (el.closest("[data-abx-add]")) {
        const ids = Array.from(orgBlockEl.querySelectorAll("[data-abx-check]:checked:not(:disabled)")).map((c) => c.value);
        if (!ids.length) return toastWarn("Tick at least one antibiotic first.");
        addAntibiotics(organism, ids);
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

// Release-time and draft validation live in ../core/culture-logic.js (unit-tested).
export { cultureValidationError, cultureDraftError };
