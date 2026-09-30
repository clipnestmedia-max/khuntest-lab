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
import { esc, toastError, toastWarn, confirmAction, openModal } from "../core/ui.js";

let masters = { specimens: [], organisms: [], antibiotics: [], panels: [], breakpoints: [], ast: Culture.normalizeAstStandard() };
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
//
// Progressive disclosure: the basic culture fields are always visible; each
// organism is a compact summary card that expands on demand; antibiotics are
// picked from a searchable dialog (or typed into a quick-add box) so only the
// selected ones ever appear; advanced sections (microscopy, resistance
// markers, comments) start collapsed. None of this changes what is stored -
// every field written before this redesign is still written and still read.

// UI-only state (never persisted, never sent to Firestore): which organism
// cards / collapsible sections the technician has opened.
const uiOpen = new Set();

function sirBadgeClass(sir) {
  if (sir === "S") return "ok"; if (sir === "R") return "danger"; if (sir === "I") return "warn"; return "";
}

/** Expand/collapse an organism card (UI state only - nothing is stored). */
export function setOrganismOpen(ti, oi, open = true) {
  const key = `org:${ti}:${oi}`;
  if (open) uiOpen.add(key); else uiOpen.delete(key);
}

function ensureStyles() {
  if (typeof document === "undefined" || document.getElementById("csEntryStyles")) return;
  const style = document.createElement("style");
  style.id = "csEntryStyles";
  style.textContent = `
    .cs-card { margin-top: 16px; }
    .cs-basic { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .cs-basic .field { margin: 0; }
    .cs-h { margin: 18px 0 8px; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted, #64748b); }
    .cs-help { font-size: 13px; color: var(--muted, #64748b); margin: 6px 0; }
    .cs-details { margin: 12px 0 0; border: 1px solid var(--border, #e2e8f0); border-radius: 8px; padding: 0 12px; background: var(--surface, #fff); }
    .cs-details > summary { cursor: pointer; padding: 10px 0; font-weight: 600; font-size: 13.5px; list-style-position: inside; }
    .cs-details[open] > summary { border-bottom: 1px solid var(--border, #e2e8f0); margin-bottom: 10px; }
    .cs-details > .cs-details-body { padding-bottom: 12px; }
    .cs-badge { font-weight: 500; font-size: 12px; color: var(--muted, #64748b); margin-left: 6px; }
    .cs-org { border: 1px solid var(--border, #e2e8f0); border-radius: 10px; padding: 12px 14px; margin: 10px 0; background: var(--surface, #fff); }
    .cs-org-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .cs-org-num { font-size: 11px; font-weight: 700; letter-spacing: .06em; color: var(--muted, #64748b); }
    .cs-org-name { font-weight: 700; font-size: 15px; overflow-wrap: anywhere; }
    .cs-org-meta { font-size: 12.5px; color: var(--muted, #64748b); }
    .cs-org-head .spacer { flex: 1; }
    .cs-org-body { margin-top: 12px; }
    .cs-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 10px 0 8px; }
    .cs-toolbar input { flex: 1 1 220px; min-width: 160px; max-width: 320px; }
    .cs-count { font-size: 13px; font-weight: 600; margin: 6px 0; }
    .cs-rows { width: 100%; border-collapse: collapse; }
    .cs-rows th { text-align: left; font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted, #64748b); padding: 6px 6px; border-bottom: 1px solid var(--border, #e2e8f0); }
    .cs-rows td { padding: 6px; border-bottom: 1px solid var(--border, #eef2f7); vertical-align: middle; }
    .cs-rows .cs-drug { font-weight: 600; min-width: 150px; overflow-wrap: anywhere; }
    .cs-rows .cs-drug small { display: block; font-weight: 400; color: var(--muted, #64748b); }
    .cs-rows input, .cs-rows select { width: 100%; min-width: 0; }
    .cs-rows .cs-c-mic, .cs-rows .cs-c-zone { width: 92px; }
    .cs-rows .cs-c-sir { width: 150px; }
    .cs-rows .cs-c-grade { width: 92px; }
    .cs-rows .cs-c-x { width: 34px; text-align: center; }
    .cs-modal-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 2px 14px; max-height: 340px; overflow: auto; margin-top: 10px; }
    .cs-modal-list label { display: flex; gap: 8px; align-items: center; padding: 5px 2px; font-size: 14px; }
    .cs-modal-list label.is-added { opacity: .55; }
    .cs-markers { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; }
    .cs-markers .field { margin: 0; }
    @media (max-width: 720px) {
      .cs-rows thead { display: none; }
      .cs-rows, .cs-rows tbody, .cs-rows tr, .cs-rows td { display: block; width: 100%; }
      .cs-rows tr { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; padding: 10px 0; border-bottom: 1px solid var(--border, #e2e8f0); }
      .cs-rows td { border: 0; padding: 0; width: auto !important; }
      .cs-rows td.cs-drug, .cs-rows td.cs-c-comment { grid-column: 1 / -1; }
      .cs-rows td.cs-c-x { text-align: right; grid-column: 1 / -1; }
      .cs-rows td[data-label]::before { content: attr(data-label); display: block; font-size: 11px; color: var(--muted, #64748b); text-transform: uppercase; letter-spacing: .04em; }
      .cs-toolbar input { max-width: none; }
    }`;
  document.head.appendChild(style);
}

const isOther = (name) => String(name || "").trim().toLowerCase() === "other";
const specimenShown = (cr) => (cr.specimenCustom ? "Other" : (cr.specimenName || ""));

function specimenDatalist() {
  return `<datalist id="csSpecimenList">${masters.specimens.map((s) => `<option value="${esc(s.name)}"></option>`).join("")}</datalist>`;
}
function organismDatalist() {
  return `<datalist id="csOrganismList">${masters.organisms.map((o) => `<option value="${esc(o.name)}"></option>`).join("")}</datalist>`;
}
function antibioticDatalist() {
  return `<datalist id="csAbxList">${masters.antibiotics.map((a) => `<option value="${esc(a.displayName)}"></option>`).join("")}</datalist>`;
}

/** Stored value -> readable dropdown; "" = not entered yet (row is left off the printed report). */
function resultOptions(current) {
  const sir = Culture.normalizeSir(current);
  const opt = (v, label) => `<option value="${v}" ${v === sir ? "selected" : ""}>${esc(label)}</option>`;
  return opt("", "Select…") + opt("S", "S — Sensitive") + opt("I", "I — Intermediate") + opt("R", "R — Resistant")
    + `<optgroup label="Other">${opt("NA", "NA — Not applicable")}${opt("NT", "X — Not tested")}</optgroup>`;
}

function details(key, title, body, { open = false, badge = "" } = {}) {
  const isOpen = uiOpen.has(key) || open;
  return `<details class="cs-details" data-ui="${key}" ${isOpen ? "open" : ""}>
    <summary>${title}${badge ? `<span class="cs-badge">${badge}</span>` : ""}</summary>
    <div class="cs-details-body">${body}</div></details>`;
}

function sensitivityRowHtml(ti, oi, si, row, canEdit) {
  const dis = canEdit ? "" : "disabled";
  const abx = masters.antibiotics.find((a) => a.id === row.antibioticId);
  const micOk = isValidMic(row.micValue);
  return `<tr data-sens-row="${ti}:${oi}:${si}">
    <td class="cs-drug" data-label="Antibiotic">${esc(row.antibioticName || "(no antibiotic selected)")}${abx?.abbreviation ? `<small>${esc(abx.abbreviation)}</small>` : ""}</td>
    <td class="cs-c-sir" data-label="Result"><select data-sens-sir class="pill ${sirBadgeClass(Culture.normalizeSir(row.sir))}" aria-label="Result for ${esc(row.antibioticName)}" ${dis}>${resultOptions(row.sir)}</select>${row.auto ? `<small class="muted" title="Auto-interpreted from ${esc(row.standard)} ${esc(row.standardVersion)}">auto</small>` : ""}</td>
    <td class="cs-c-mic" data-label="MIC"><input data-sens-mic type="text" inputmode="text" value="${esc(row.micValue)}" placeholder="${esc(row.micUnit || "µg/mL")}" title="e.g. 0.5, 16, >16, ≤0.25" style="${micOk ? "" : "border-color:var(--danger,#c0392b);"}" aria-invalid="${micOk ? "false" : "true"}" ${dis}></td>
    <td class="cs-c-zone" data-label="Zone"><input data-sens-zone type="text" inputmode="decimal" value="${esc(row.zoneDiameter)}" placeholder="${esc(row.zoneUnit || "mm")}" ${dis}></td>
    <td class="cs-c-grade" data-label="Grade"><select data-sens-grade title="Optional grading, printed as e.g. S(++++)" ${dis}>
      ${["", "+", "++", "+++", "++++"].map((g) => `<option value="${g}" ${g === (row.grade || "") ? "selected" : ""}>${g || "—"}</option>`).join("")}</select></td>
    <td class="cs-c-comment" data-label="Comment"><input data-sens-comment type="text" value="${esc(row.comment)}" placeholder="Comment" ${dis}></td>
    <td class="cs-c-x">${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove-sens type="button" title="Remove ${esc(row.antibioticName)}" aria-label="Remove ${esc(row.antibioticName)}">×</button>` : ""}</td>
  </tr>`;
}

function organismSummary(o) {
  const rows = o.sensitivities || [];
  const tally = ["S", "I", "R"].map((k) => [k, rows.filter((r) => Culture.normalizeSir(r.sir) === k).length]).filter(([, n]) => n);
  return `${rows.length} antibiotic${rows.length === 1 ? "" : "s"}${tally.length ? " · " + tally.map(([k, n]) => `${k} ${n}`).join(" · ") : ""}`;
}

function organismBlockHtml(ti, oi, o, canEdit) {
  const key = `org:${ti}:${oi}`;
  const named = Boolean(String(o.organismName || "").trim());
  const open = uiOpen.has(key) || !named;
  const dis = canEdit ? "" : "disabled";
  const head = `<div class="cs-org-head">
      <span class="cs-org-num">ORGANISM ${oi + 1}</span>
      ${named ? `<span class="cs-org-name">${esc(o.organismName)}</span><span class="cs-org-meta">${esc(organismSummary(o))}</span>` : ""}
      <span class="spacer"></span>
      ${named ? `<button class="btn btn-sm btn-outline" data-org-toggle type="button">${open ? "Done" : "Edit"}</button>` : ""}
      ${canEdit ? `<button class="btn btn-sm btn-ghost" data-remove-organism type="button">Remove</button>` : ""}
    </div>`;
  if (!open) return `<div class="cs-org" data-organism-block="${ti}:${oi}">${head}</div>`;

  const rows = o.sensitivities || [];
  const body = named ? `
      <div class="cs-toolbar">
        <input data-abx-quick type="text" list="csAbxList" autocomplete="off" placeholder="Search antibiotic and press Enter…" aria-label="Search antibiotic" ${dis}>
        ${canEdit ? `<button class="btn btn-sm" data-abx-open type="button">+ Add Antibiotic</button>
        <button class="btn btn-sm btn-outline" data-autofill-panel type="button" title="Adds the antibiotics your lab configured as a panel for this specimen/organism">Add from panel</button>` : ""}
      </div>
      <div class="cs-count">Selected antibiotics: ${rows.length}</div>
      ${rows.length ? `<table class="cs-rows"><thead><tr><th>Antibiotic</th><th>Result</th><th>MIC</th><th>Zone</th><th>Grade</th><th>Comment</th><th></th></tr></thead>
        <tbody>${rows.map((r, si) => sensitivityRowHtml(ti, oi, si, r, canEdit)).join("")}</tbody></table>`
        : `<p class="cs-help">No antibiotics yet — search above or use <b>+ Add Antibiotic</b>.</p>`}
      ${details(`ocom:${ti}:${oi}`, "Organism comment", `<input data-organism-comment type="text" value="${esc(o.comments || "")}" placeholder="Optional note for this organism" style="width:100%;" ${dis}>`, { open: Boolean(o.comments) })}`
    : `<p class="cs-help">Select an organism to enter antibiotic sensitivity.</p>`;

  return `<div class="cs-org" data-organism-block="${ti}:${oi}">${head}
    <div class="cs-org-body">
      <label class="field" style="margin:0;"><span>Organism <span class="cs-badge">search the list, or type any organism</span></span>
        <input data-organism-input type="text" list="csOrganismList" autocomplete="off" value="${esc(o.organismName)}" placeholder="Search or select organism…" ${dis}></label>
      ${body}
    </div></div>`;
}

function markersHtml(ti, cr, canEdit) {
  return `<div class="cs-markers">${Culture.DEFAULT_RESISTANCE_MARKERS.map((m) => `<label class="field"><span>${esc(m)}</span>
    <select data-marker="${esc(m)}" ${canEdit ? "" : "disabled"}>${Culture.RESISTANCE_MARKER_VALUES.map((v) => `<option ${v === (cr.resistanceMarkers[m] || "Not Tested") ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>`).join("")}</div>`;
}

/** Render every C&S block for this report. `ti` (test index into cultureResults[]) keys all delegated handlers. */
export function renderCultureBlocks(cultureResults, canEdit) {
  if (!cultureResults.length) return "";
  ensureStyles();
  const dis = canEdit ? "" : "disabled";
  return specimenDatalist() + organismDatalist() + antibioticDatalist() + cultureResults.map((cr, ti) => {
    const showOrganisms = !["No Growth", "Pending", "Sterile"].includes(cr.cultureResult) || cr.organisms.length > 0;
    const microFilled = ["gramStain", "pusCells", "rbc", "epithelialCells", "otherFindings"].filter((k) => String(cr[k] || "").trim()).length;
    const markersSet = Object.values(cr.resistanceMarkers || {}).filter((v) => v && v !== "Not Tested").length;
    return `
    <div class="card cs-card" data-culture-block="${ti}">
      <div class="card-head"><h2>Culture &amp; Sensitivity — ${esc(cr.testName)}</h2></div>
      <div class="cs-basic">
        <label class="field"><span>Specimen *</span>
          <input data-cr-specimen type="text" list="csSpecimenList" autocomplete="off" value="${esc(specimenShown(cr))}" placeholder="Select or type specimen…" ${dis}></label>
        <label class="field"><span>Culture result</span><select data-cr-result ${dis}>
          ${Culture.CULTURE_RESULTS.map((r) => `<option ${r === cr.cultureResult ? "selected" : ""}>${esc(r)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Colony count</span><input data-cr-colony type="text" value="${esc(cr.colonyCount)}" ${dis}></label>
        <label class="field"><span>Unit</span><select data-cr-colony-unit ${dis}>
          <option value="">—</option>
          ${Culture.COLONY_COUNT_UNITS.map((u) => `<option ${u === cr.colonyCountUnit ? "selected" : ""}>${esc(u)}</option>`).join("")}
        </select></label>
      </div>
      ${cr.specimenCustom ? `<label class="field" style="margin-top:10px;"><span>Specify specimen *</span>
        <input data-cr-specimen-custom type="text" value="${esc(cr.specimenName)}" placeholder="Type the specimen" ${dis}></label>` : ""}

      ${showOrganisms ? `
        <h4 class="cs-h">Organisms</h4>
        ${cr.organisms.map((o, oi) => organismBlockHtml(ti, oi, o, canEdit)).join("")}
        ${cr.organisms.length ? "" : `<p class="cs-help">Add the organism isolated to enter antibiotic sensitivity.</p>`}
        ${canEdit ? `<button class="btn btn-sm btn-outline" data-add-organism type="button">+ Add Organism</button>` : ""}` : ""}

      ${details(`micro:${ti}`, "Microscopy / Gram stain", `
        <div class="cs-basic">
          <label class="field"><span>Gram stain</span><input data-cr-gram type="text" value="${esc(cr.gramStain)}" placeholder="e.g. Gram Negative Bacilli" ${dis}></label>
          <label class="field"><span>Pus cells</span><input data-cr-pus type="text" value="${esc(cr.pusCells)}" ${dis}></label>
          <label class="field"><span>RBC</span><input data-cr-rbc type="text" value="${esc(cr.rbc)}" ${dis}></label>
          <label class="field"><span>Epithelial cells</span><input data-cr-epithelial type="text" value="${esc(cr.epithelialCells)}" ${dis}></label>
        </div>
        <label class="field" style="margin-top:10px;"><span>Other findings</span><input data-cr-other type="text" value="${esc(cr.otherFindings)}" ${dis}></label>`,
        { badge: microFilled ? `${microFilled} filled` : "" })}
      ${showOrganisms ? details(`markers:${ti}`, "Resistance markers", markersHtml(ti, cr, canEdit), { badge: markersSet ? `${markersSet} recorded` : "" }) : ""}
      ${details(`comments:${ti}`, "Comments / interpretation", `<textarea data-cr-comments rows="3" style="width:100%;" ${dis}>${esc(cr.comments)}</textarea>`, { open: Boolean(String(cr.comments || "").trim()) })}
    </div>`;
  }).join("");
}

// ---------- antibiotic picker dialog ----------

function openAntibioticPicker(organism, { onAdded }) {
  const have = new Set(organism.sensitivities.map((s) => s.antibioticId).filter(Boolean));
  const list = masters.antibiotics.map((a) => `
    <label class="${have.has(a.id) ? "is-added" : ""}" data-abx-name="${esc(`${a.displayName} ${a.abbreviation || ""} ${a.genericName || ""} ${a.antibioticClass || ""}`.toLowerCase())}">
      <input type="checkbox" value="${esc(a.id)}" ${have.has(a.id) ? "checked disabled" : ""}> <span>${esc(a.displayName)}${a.abbreviation ? ` <small class="muted">${esc(a.abbreviation)}</small>` : ""}</span></label>`).join("");
  const { element, close } = openModal({
    title: `Add antibiotics — ${organism.organismName || "organism"}`,
    wide: true,
    body: masters.antibiotics.length
      ? `<input type="search" data-pick-filter placeholder="Search antibiotic or class…" autocomplete="off" style="width:100%;" autofocus>
         <div class="cs-modal-list">${list}</div>
         <p class="small muted" data-pick-empty style="display:none;">No antibiotic matches your search.</p>`
      : `<p>No antibiotics are configured yet. Add them under <b>Culture &amp; Sensitivity → Antibiotics</b>.</p>`,
    footer: `<span class="small muted" data-pick-count style="margin-right:auto;">Nothing selected</span>
             <button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="add" type="button" ${masters.antibiotics.length ? "" : "disabled"}>Add selected</button>`
  });
  const boxes = () => Array.from(element.querySelectorAll('.cs-modal-list input[type="checkbox"]:not(:disabled)'));
  const refresh = () => {
    const n = boxes().filter((b) => b.checked).length;
    const c = element.querySelector("[data-pick-count]"); if (c) c.textContent = n ? `${n} selected` : "Nothing selected";
  };
  element.querySelector("[data-pick-filter]")?.addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase(); let shown = 0;
    element.querySelectorAll("[data-abx-name]").forEach((l) => { const hit = !q || l.dataset.abxName.includes(q); l.style.display = hit ? "" : "none"; if (hit) shown += 1; });
    const empty = element.querySelector("[data-pick-empty]"); if (empty) empty.style.display = shown ? "none" : "";
  });
  element.addEventListener("change", refresh);
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="add"]').addEventListener("click", () => {
    const ids = boxes().filter((b) => b.checked).map((b) => b.value);
    if (!ids.length) return toastWarn("Tick at least one antibiotic first.");
    const added = addAntibiotics(organism, ids);
    close(); onAdded(added);
  });
}

// ---------- events ----------

/**
 * Wire delegated events for a rendered culture section. `getState`/`onChange`
 * let the caller (report-entry.js) own `current.cultureResults` as the single
 * source of truth - this module only mutates it and asks for a re-render (or,
 * for a plain text field, just updates state with no re-render so typing
 * never loses focus).
 */
export function bindCultureSection(container, { getState, rerender, onChange }) {
  const cr = () => getState();

  // <details> "toggle" does not bubble - capture it so open/closed survives re-renders.
  container.addEventListener("toggle", (event) => {
    const key = event.target?.dataset?.ui;
    if (!key) return;
    if (event.target.open) uiOpen.add(key); else uiOpen.delete(key);
  }, true);

  container.addEventListener("change", (event) => {
    const el = event.target;
    const block = el.closest("[data-culture-block]");
    if (!block) return;
    const ti = Number(block.dataset.cultureBlock);
    const result = cr()[ti];
    if (!result) return;

    if (el.matches("[data-cr-specimen]")) {
      const typed = el.value.trim();
      const match = masters.specimens.find((s) => s.name.toLowerCase() === typed.toLowerCase());
      if (!typed) { result.specimenId = ""; result.specimenName = ""; result.specimenCustom = false; }
      else if (match && !isOther(match.name)) { result.specimenId = match.id; result.specimenName = match.name; result.specimenCustom = false; }
      else if (match) { result.specimenId = ""; result.specimenName = ""; result.specimenCustom = true; }   // "Other": ask what it is
      else { result.specimenId = ""; result.specimenName = typed; result.specimenCustom = false; }        // any typed specimen is allowed
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
    if (!orgBlockEl) return;
    const [, oi] = orgBlockEl.dataset.organismBlock.split(":").map(Number);
    const organism = result.organisms[oi];
    if (!organism) return;

    if (el.matches("[data-organism-input]")) {
      const typed = el.value.trim();
      const match = masters.organisms.find((o) => o.name.toLowerCase() === typed.toLowerCase());
      const hadName = Boolean(organism.organismName);
      organism.organismId = match?.id || ""; // "" = a lab-typed organism with no master record (manual S/I/R only)
      organism.organismName = match?.name || typed;
      (organism.sensitivities || []).forEach((row) => recalcRow(organism.organismId, row));
      if (organism.organismName && !hadName) uiOpen.add(`org:${ti}:${oi}`); // stay open so antibiotics can be added right away
      onChange(); return rerender();
    }
    if (el.matches("[data-abx-quick]")) {
      const typed = el.value.trim().toLowerCase();
      if (!typed) return;
      const abx = masters.antibiotics.find((a) => a.displayName.toLowerCase() === typed || (a.abbreviation && a.abbreviation.toLowerCase() === typed));
      if (!abx) return toastWarn(`"${el.value.trim()}" is not in your antibiotic list. Use + Add Antibiotic to browse it.`);
      if (!addAntibiotics(organism, [abx.id])) { el.value = ""; return toastWarn(`${abx.displayName} is already listed for this organism.`); }
      onChange(); return rerender();
    }
    const sensRow = el.closest("[data-sens-row]");
    if (sensRow) {
      const [, , si] = sensRow.dataset.sensRow.split(":").map(Number);
      const row = organism.sensitivities[si];
      if (!row) return;
      if (el.matches("[data-sens-sir]")) { row.sir = el.value; row.auto = false; el.className = `pill ${sirBadgeClass(el.value)}`; return onChange(); }
      if (el.matches("[data-sens-grade]")) { row.grade = el.value; return onChange(); }
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
    } else if (el.matches("[data-sens-zone]")) row.zoneDiameter = el.value;
    else if (el.matches("[data-sens-comment]")) { row.comment = el.value; return onChange(); }
    else return;

    recalcRow(organism.organismId, row);
    onChange();
    // Targeted patch, not a full re-render, so the field being typed in never
    // loses focus - only the Result cell in this same row updates.
    const sirSelect = sensRow.querySelector("[data-sens-sir]");
    if (sirSelect) {
      sirSelect.value = Culture.normalizeSir(row.sir);
      sirSelect.className = `pill ${sirBadgeClass(Culture.normalizeSir(row.sir))}`;
      const cell = sirSelect.parentElement;
      const autoTag = cell.querySelector("small.muted");
      if (row.auto && !autoTag) sirSelect.insertAdjacentHTML("afterend", ` <small class="muted">auto</small>`);
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
      uiOpen.add(`org:${ti}:${result.organisms.length - 1}`);
      onChange(); return rerender();
    }
    const orgBlockEl = el.closest("[data-organism-block]");
    if (!orgBlockEl) return;
    const [, oi] = orgBlockEl.dataset.organismBlock.split(":").map(Number);
    const organism = result.organisms[oi];
    if (!organism) return;
    const key = `org:${ti}:${oi}`;

    if (el.closest("[data-org-toggle]")) {
      if (uiOpen.has(key)) uiOpen.delete(key); else uiOpen.add(key);
      return rerender();
    }
    if (el.closest("[data-remove-organism]")) {
      const label = organism.organismName || `Organism ${oi + 1}`;
      if ((organism.sensitivities.length || organism.organismName) && !await confirmAction(`Remove ${label} and its sensitivity results?`, { danger: true })) return;
      result.organisms.splice(oi, 1);
      Array.from(uiOpen).filter((k) => k.startsWith(`org:${ti}:`) || k.startsWith(`ocom:${ti}:`)).forEach((k) => uiOpen.delete(k)); // indexes shifted
      onChange(); return rerender();
    }
    if (el.closest("[data-abx-open]")) {
      if (!masters.antibiotics.length) toastWarn("The antibiotic list is empty or failed to load. Check Culture & Sensitivity → Antibiotics.");
      return openAntibioticPicker(organism, {
        onAdded: (added) => { if (!added) toastWarn("Those antibiotics are already listed."); onChange(); rerender(); }
      });
    }
    if (el.closest("[data-autofill-panel]")) {
      if (!organism.organismId) return toastWarn("Pick an organism from the list first — panels are configured per organism/specimen.");
      const { added, noPanel } = autoFillPanel(result, organism);
      if (noPanel) toastWarn("No antibiotic panel is configured for this specimen/organism yet. Use + Add Antibiotic, or set one up under Culture & Sensitivity → Antibiotic panels.");
      else if (!added) toastWarn("Every antibiotic in the configured panel is already listed.");
      onChange(); return rerender();
    }
    const sensRow = el.closest("[data-sens-row]");
    if (sensRow && el.closest("[data-remove-sens]")) {
      const [, , si] = sensRow.dataset.sensRow.split(":").map(Number);
      organism.sensitivities.splice(si, 1);
      onChange(); return rerender();
    }
  });
}

// Release-time and draft validation live in ../core/culture-logic.js (unit-tested).
export { cultureValidationError, cultureDraftError };
