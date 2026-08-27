// Settings → Medical: where a laboratory takes ownership of its clinical rules.
//
// Two things live here, and they are the two things an NABL assessor asks
// about. Which calculations does this laboratory run, and who checked them
// against its own methods. Which reference intervals does it report against,
// and who established or verified them for its own population and analysers.
//
// The screen is deliberately blunt about what has not been signed off. A rule
// inherited from the platform is useful — it saves typing — but it is not this
// laboratory's rule until this laboratory's pathologist says so, and until
// then the screen and the report both say REQUIRES MEDICAL VALIDATION.
import { getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { settingsDoc, getLabId } from "../core/tenant.js";
import { sessionCanWrite } from "../core/session.js";
import { PERMISSIONS as P } from "../core/roles.js";
import { logAudit, AUDIT } from "../core/audit.js";
import { calculationRules, ruleById } from "../core/medical/rules.js";
import { VALIDATION_STATUS, RULE_TYPE } from "../core/medical/schema.js";
import { dependencyGraph } from "../core/medical/engine.js";
import { PATTERN_RULES } from "../core/medical/interpretation.js";
import {
  loadMedicalConfig, setRuleEnabled, setRuleParams, validateRule, revokeRuleValidation,
  saveInterval, intervalOverride, validationSummary, clearMedicalConfigCache
} from "../core/medical/config.js";
import { loadTests } from "../core/data/tests.js";
import {
  $, esc, toastOk, toastError, reportError, setBusy, openModal, confirmAction
} from "../core/ui.js";

let ctx = { session: null, branding: null };
let config = null;
let signatories = [];
let catalogue = [];
let view = "calculations";

export function initMedicalScreen(context) {
  ctx = context;
  const host = $("#medicalPane");
  if (!host) return;

  host.addEventListener("click", async (event) => {
    const tab = event.target.closest("[data-med-view]");
    if (tab) { view = tab.dataset.medView; return paint(); }

    const toggle = event.target.closest("[data-med-toggle]");
    if (toggle) return onToggleRule(toggle.dataset.medToggle, toggle.checked);

    const validate = event.target.closest("[data-med-validate]");
    if (validate) return openValidationDialog(validate.dataset.medValidate);

    const revoke = event.target.closest("[data-med-revoke]");
    if (revoke) return onRevoke(revoke.dataset.medRevoke);

    const detail = event.target.closest("[data-med-detail]");
    if (detail) return openRuleDetail(detail.dataset.medDetail);

    const params = event.target.closest("[data-med-params]");
    if (params) return openParamsDialog(params.dataset.medParams);

    const interval = event.target.closest("[data-med-interval]");
    if (interval) return openIntervalDialog(interval.dataset.medInterval);
  });

  host.addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-med-toggle]");
    if (toggle) onToggleRule(toggle.dataset.medToggle, toggle.checked);
    const filter = event.target.closest("#medIntervalTest");
    if (filter) paint();
  });

  host.addEventListener("input", (event) => {
    if (event.target.closest("#medIntervalSearch")) paint();
  });
}

/** Called when the Medical tab is opened. */
export async function renderMedical() {
  const host = $("#medicalPane");
  if (!host) return;
  host.innerHTML = `<p class="muted">Loading medical configuration…</p>`;
  try {
    config = await loadMedicalConfig(getLabId(), { force: true });
    const snap = await getDoc(settingsDoc("report")).catch(() => null);
    signatories = Array.isArray(snap?.data()?.signatories) ? snap.data().signatories : [];
    if (!catalogue.length) catalogue = await loadTests({ activeOnly: false }).catch(() => []);
  } catch (error) {
    return reportError(error, "Could not load the medical configuration.");
  }
  paint();
}

// ---------------------------------------------------------------- painting

function paint() {
  const host = $("#medicalPane");
  const summary = validationSummary(config);
  host.innerHTML = `
    ${summaryCard(summary)}
    <div class="btn-row" style="margin:14px 0;">
      ${["calculations", "intervals", "interpretation", "dependencies"].map((v) => `
        <button class="btn btn-sm ${view === v ? "btn-green" : "btn-outline"}" data-med-view="${v}" type="button">
          ${esc(VIEW_LABELS[v])}</button>`).join("")}
    </div>
    ${view === "calculations" ? calculationsView()
      : view === "intervals" ? intervalsView()
      : view === "interpretation" ? interpretationView()
      : dependenciesView()}`;
}

const VIEW_LABELS = {
  calculations: "Calculations",
  intervals: "Reference intervals",
  interpretation: "Interpretive comments",
  dependencies: "Dependency map"
};

function summaryCard(summary) {
  const done = summary.complete;
  return `
    <div class="card" style="border-left:4px solid ${done ? "var(--ok)" : "var(--warn)"};">
      <div class="card-head"><h2>Clinical validation status</h2></div>
      <p class="small">
        <b>${summary.rulesValidated} of ${summary.rulesEnabled}</b> calculations in use have been signed off by
        a pathologist of this laboratory. <b>${summary.intervalsValidated}</b> reference intervals have been
        established or verified here.
      </p>
      ${done ? "" : `
        <p class="small" style="background:var(--warn-bg,#fff6e5);padding:10px;border-radius:6px;">
          <b>REQUIRES MEDICAL VALIDATION.</b>
          ${summary.rulesPending} calculation${summary.rulesPending === 1 ? " is" : "s are"} running against
          formulae supplied with the platform that no one at this laboratory has yet verified against its own
          methods and analysers. They still calculate, and every report carries this notice, but the clinical
          responsibility for them has not been accepted by anyone. A pathologist of this laboratory should
          review each one and sign it off below.
        </p>`}
      <p class="small muted">
        The platform supplies formulae and draft wording as a convenience. It cannot validate them: software
        has no clinical authority. Verification against this laboratory's own methods, populations and
        instruments rests with its authorised pathologist, as NABL 112 and ISO 15189 require.
      </p>
    </div>`;
}

function statusPill(status) {
  if (status === VALIDATION_STATUS.VALIDATED) return `<span class="pill ok">Validated</span>`;
  if (status === VALIDATION_STATUS.DISABLED) return `<span class="pill">Disabled on platform</span>`;
  if (status === VALIDATION_STATUS.RETIRED) return `<span class="pill">Retired</span>`;
  return `<span class="pill warn" title="Not yet verified by this laboratory">Requires medical validation</span>`;
}

function effective(rule) {
  const override = config?.rules?.[rule.id] || {};
  return {
    enabled: override.enabled ?? rule.defaultEnabled ?? true,
    status: override.validationStatus || rule.validationStatus,
    validatedBy: override.validatedBy || "",
    validatedOn: override.validatedOn || "",
    params: override.params || {},
    platformDisabled: rule.validationStatus === VALIDATION_STATUS.DISABLED
  };
}

/** Human-readable names and hints for the laboratory-specific constants a rule needs. */
const PARAM_HINTS = {
  mnpt: { label: "Mean Normal Prothrombin Time (MNPT)", unit: "seconds",
    hint: "The geometric mean PT of ≥20 healthy donors on your current reagent lot and analyser." },
  isi: { label: "International Sensitivity Index (ISI)", unit: "",
    hint: "From the thromboplastin reagent's pack insert, for your instrument. Reagent-lot specific." },
  fio2: { label: "Fraction of inspired oxygen (FiO₂)", unit: "fraction 0–1",
    hint: "0.21 for room air. Set only if your samples are drawn on a fixed supplemental oxygen setting." },
  patm: { label: "Barometric pressure", unit: "mmHg",
    hint: "760 at sea level. Lower at altitude — use your location's mean." }
};

function calculationsView() {
  const canEdit = sessionCanWrite(P.SETTINGS_EDIT, ctx.session);
  const rules = calculationRules().slice().sort((a, b) => a.name.localeCompare(b.name));

  return `
    <div class="card">
      <div class="card-head"><h2>Calculated parameters</h2></div>
      <p class="small muted">
        A calculation that is switched off is not computed and its line is left for manual entry.
        Switching one on does not validate it — that is the separate sign-off on the right.
      </p>
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:4%">Use</th><th style="width:22%">Parameter</th><th style="width:10%">Type</th>
          <th style="width:26%">Formula</th>
          <th style="width:18%">Status</th><th style="width:6%">Ver.</th><th style="width:14%"></th>
        </tr></thead>
        <tbody>${rules.map((rule) => {
          const e = effective(rule);
          const needsParams = Array.isArray(rule.requires?.params) && rule.requires.params.length;
          const setParams = rule.requires?.params?.every((k) => Number(e.params?.[k]) > 0);
          return `
          <tr>
            <td>
              <input type="checkbox" data-med-toggle="${esc(rule.id)}" ${e.enabled ? "checked" : ""}
                ${canEdit && !e.platformDisabled ? "" : "disabled"}
                aria-label="Use ${esc(rule.name)}">
            </td>
            <td>
              <b>${esc(rule.name)}</b>
              <div class="small muted">${esc(rule.outputUnit || "")}</div>
              ${needsParams ? `<div class="small ${setParams ? "muted" : ""}" ${setParams ? "" : 'style="color:var(--danger)"'}>
                ${setParams ? "Lab constants set" : "Lab constants not set — will not calculate"}</div>` : ""}
            </td>
            <td class="small">${esc(labelForType(rule.type))}</td>
            <td class="small"><code>${esc(rule.formulaText)}</code></td>
            <td>
              ${statusPill(e.status)}
              ${e.validatedBy ? `<div class="small muted">${esc(e.validatedBy)} · ${esc(e.validatedOn)}</div>` : ""}
              ${e.platformDisabled ? `<div class="small muted">Not available for reporting on this platform.</div>` : ""}
            </td>
            <td class="small">v${rule.version}</td>
            <td class="btn-row">
              <button class="btn btn-sm btn-ghost" data-med-detail="${esc(rule.id)}" type="button">Details</button>
              ${canEdit && needsParams ? `<button class="btn btn-sm btn-outline" data-med-params="${esc(rule.id)}" type="button">Constants</button>` : ""}
              ${canEdit && !e.platformDisabled ? (e.status === VALIDATION_STATUS.VALIDATED
                ? `<button class="btn btn-sm btn-outline" data-med-revoke="${esc(rule.id)}" type="button">Withdraw</button>`
                : `<button class="btn btn-sm btn-outline" data-med-validate="${esc(rule.id)}" type="button">Sign off</button>`) : ""}
            </td>
          </tr>`;
        }).join("")}</tbody>
      </table></div>
    </div>`;
}

function intervalsView() {
  const canEdit = sessionCanWrite(P.SETTINGS_EDIT, ctx.session);
  const search = $("#medIntervalSearch")?.value?.toLowerCase().trim() || "";
  const testFilter = $("#medIntervalTest")?.value || "";

  const rows = [];
  catalogue.forEach((test) => {
    if (testFilter && test.code !== testFilter) return;
    (test.parameters || []).forEach((param) => {
      if (param.isHeading) return;
      if (search && !`${test.name} ${param.name}`.toLowerCase().includes(search)) return;
      rows.push({ test, param, override: intervalOverride(config, test.code, param.name) });
    });
  });

  return `
    <div class="card">
      <div class="card-head"><h2>Reference intervals</h2></div>
      <p class="small muted">
        The ranges supplied with the catalogue are a starting point drawn from general literature.
        They were not established on this laboratory's population, methods or analysers, so until a
        pathologist here verifies one it is reported as inherited and unvalidated. Enter this
        laboratory's own limits — and the critical limits that trigger an urgent telephone call — below.
      </p>
      <div class="row-flex" style="gap:10px;margin-bottom:12px;">
        <input id="medIntervalSearch" class="input" placeholder="Search parameter…" value="${esc(search)}"
          style="max-width:280px;" autocomplete="off">
        <select id="medIntervalTest" class="input" style="max-width:260px;">
          <option value="">All tests</option>
          ${catalogue.map((t) => `<option value="${esc(t.code)}" ${testFilter === t.code ? "selected" : ""}>${esc(t.name)}</option>`).join("")}
        </select>
        <span class="small muted" style="align-self:center;">${rows.length} parameter${rows.length === 1 ? "" : "s"}</span>
      </div>
      ${rows.length > 400 ? `<p class="small muted">Showing the first 400. Narrow the search to see the rest.</p>` : ""}
      <div class="table-wrap"><table class="data">
        <thead><tr>
          <th style="width:26%">Parameter</th><th style="width:18%">Test</th>
          <th style="width:16%">Reference</th><th style="width:16%">Critical</th>
          <th style="width:16%">Source</th><th style="width:8%"></th>
        </tr></thead>
        <tbody>${rows.slice(0, 400).map(({ test, param, override }) => {
          const validated = override?.validationStatus === VALIDATION_STATUS.VALIDATED;
          return `
          <tr>
            <td><b>${esc(param.name)}</b><div class="small muted">${esc(param.unit || "")}</div></td>
            <td class="small">${esc(test.name)}</td>
            <td class="small">${override
              ? esc(limitText(override.low, override.high))
              : `<span class="muted">${esc(param.normalRange || "—")}</span>`}</td>
            <td class="small">${override && (override.criticalLow !== null || override.criticalHigh !== null)
              ? esc(limitText(override.criticalLow, override.criticalHigh))
              : `<span class="muted">not set</span>`}</td>
            <td>
              ${validated
                ? `<span class="pill ok">This laboratory</span><div class="small muted">${esc(override.validatedBy)} · ${esc(override.validatedOn)}</div>`
                : override
                  ? `<span class="pill warn">Entered, not signed off</span>`
                  : `<span class="pill warn">Inherited</span>`}
            </td>
            <td>${canEdit ? `<button class="btn btn-sm btn-outline" data-med-interval="${esc(test.code)}||${esc(param.name)}" type="button">Set</button>` : ""}</td>
          </tr>`;
        }).join("") || `<tr><td colspan="6" class="muted">No parameters match.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

function limitText(low, high) {
  if (low === null && high === null) return "—";
  if (low === null) return `up to ${high}`;
  if (high === null) return `${low} and above`;
  return `${low} – ${high}`;
}

function interpretationView() {
  const enabled = config?.interpretation?.enabled === true;
  return `
    <div class="card">
      <div class="card-head"><h2>Interpretive comments</h2></div>
      <p class="small">
        The platform can draft a comment describing what a set of results may be consistent with. It is a
        <b>draft for the pathologist</b>, never a finding. Nothing it writes reaches a patient until an
        authorised pathologist of this laboratory has read it, edited it if needed, and approved it.
      </p>
      <p class="small muted">
        These comments do not diagnose and do not recommend treatment. Every one of them is phrased as a
        possibility and hands the question back to the treating clinician. A result that is critical, or a
        report that rests on unvalidated intervals, is held for review regardless of this setting.
      </p>
      <p class="small">
        <b>${enabled ? "Drafting is on." : "Drafting is off."}</b>
        ${enabled
          ? "Reports arrive at the pathologist with a suggested comment attached."
          : "Reports arrive with an empty comment box for the pathologist to write in."}
        This is changed in the pathologist review panel on the report itself.
      </p>
      <div class="table-wrap"><table class="data">
        <thead><tr><th style="width:34%">Pattern</th><th style="width:50%">Wording it may propose</th><th style="width:16%">Status</th></tr></thead>
        <tbody>${PATTERN_RULES.map((rule) => `
          <tr>
            <td><b>${esc(rule.name)}</b><div class="small muted">${esc(rule.id)}</div></td>
            <td class="small">${esc(rule.describes || "")}</td>
            <td>${statusPill(rule.validationStatus)}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </div>`;
}

function dependenciesView() {
  const graph = dependencyGraph(config?.rules || {});
  const producers = new Map();
  graph.nodes.forEach((n) => producers.set(n.id, n));

  return `
    <div class="card">
      <div class="card-head"><h2>Calculation order</h2></div>
      <p class="small muted">
        Calculations run top to bottom. A parameter that feeds another is computed first, so changing one
        entered value updates everything below it in one pass. Full precision is carried between steps;
        rounding happens only at the point of printing.
      </p>
      ${graph.cycles.length ? `
        <p class="small" style="background:var(--danger-bg,#ffe9e9);padding:10px;border-radius:6px;">
          <b>Circular dependency detected</b> in: ${esc(graph.cycles.join(", "))}. These are not calculated.
        </p>` : ""}
      <ol class="small" style="line-height:1.9;">
        ${graph.nodes.map((node) => `
          <li>
            <b>${esc(node.name)}</b>
            <span class="muted">← ${esc(node.inputs.join(", ") || "no inputs")}</span>
            ${node.dependsOn.length
              ? `<div class="small muted" style="margin-left:6px;">waits for ${esc(node.dependsOn.map((d) => producers.get(d)?.name || d).join(", "))}</div>`
              : ""}
          </li>`).join("")}
      </ol>
    </div>`;
}

// ---------------------------------------------------------------- actions

async function onToggleRule(ruleId, enabled) {
  const rule = ruleById(ruleId);
  if (!rule) return;
  try {
    await setRuleEnabled(ruleId, enabled, { by: ctx.session?.name || ctx.session?.email || "" });
    config = await loadMedicalConfig(getLabId(), { force: true });
    logAudit(AUDIT.SETTINGS_UPDATED, {
      entityType: "settings", entityId: "medical",
      summary: `${rule.name} calculation ${enabled ? "enabled" : "disabled"}`
    });
    toastOk(`${rule.name} ${enabled ? "will now be calculated" : "will no longer be calculated"}.`);
    paint();
  } catch (error) {
    reportError(error, "Could not change that setting.");
    paint();
  }
}

function pathologistOptions() {
  // Only a person the laboratory has recorded as authorised to approve reports
  // may sign off a clinical rule. A technician's name in the signatory list
  // does not confer that.
  return signatories.filter((s) => s.canApproveReports === true);
}

function openValidationDialog(ruleId) {
  const rule = ruleById(ruleId);
  if (!rule) return;
  const eligible = pathologistOptions();

  if (!eligible.length) {
    const { element, close } = openModal({
      title: "No authorised pathologist on record",
      body: `<p class="small">
        A clinical rule can only be signed off by a pathologist this laboratory has authorised to approve
        reports. None is recorded yet.</p>
        <p class="small muted">Add one under <b>Settings → Report signatories</b>, and tick
        <i>May approve and sign clinical reports</i> on their entry.</p>`,
      footer: `<button class="btn btn-outline" data-act="close" type="button">Close</button>`
    });
    element.querySelector('[data-act="close"]').addEventListener("click", close);
    return;
  }

  const { element, close } = openModal({
    title: `Sign off — ${rule.name}`,
    body: `
      <p class="small">You are recording that this laboratory has verified this calculation against its own
      methods and accepts clinical responsibility for the values it produces.</p>
      <div class="card" style="background:var(--surface-2);">
        <p class="small" style="margin:0;"><b>Formula</b><br><code>${esc(rule.formulaText)}</code></p>
        <p class="small" style="margin:8px 0 0;"><b>Source</b><br>${esc(rule.source || "—")}</p>
        <p class="small" style="margin:8px 0 0;"><b>Known limitations</b><br>${esc(rule.limitations || "—")}</p>
      </div>
      <label class="small">Pathologist giving this validation
        <select id="mvPathologist" class="input">
          ${eligible.map((s) => `<option value="${esc(s.name)}" data-reg="${esc(s.registrationNumber || "")}">${esc(s.name)}${s.registrationNumber ? ` · Reg. ${esc(s.registrationNumber)}` : ""}</option>`).join("")}
        </select>
      </label>
      <label class="small">Date of validation
        <input id="mvDate" type="date" class="input" value="${new Date().toISOString().slice(0, 10)}">
      </label>
      <label class="small">What was checked <span class="muted">(kept as evidence)</span>
        <textarea id="mvNote" class="input" rows="3"
          placeholder="e.g. Verified against 40 paired results on the Beckman AU480, September 2026."></textarea>
      </label>
      <p class="small muted">This is recorded in the audit log with your name and cannot be edited afterwards,
      only withdrawn.</p>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn btn-green" data-act="save" type="button">Record validation</button>`
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (event) => {
    const select = element.querySelector("#mvPathologist");
    const name = select.value;
    const registration = select.selectedOptions[0]?.dataset.reg || "";
    const note = element.querySelector("#mvNote").value.trim();
    if (!note) {
      return toastError("Please record what was checked. A validation with no evidence behind it proves nothing.");
    }
    setBusy(event.target, true, "Recording...");
    try {
      await validateRule(ruleId, {
        pathologist: name, registrationNumber: registration, note,
        on: element.querySelector("#mvDate").value
      });
      config = await loadMedicalConfig(getLabId(), { force: true });
      logAudit(AUDIT.SETTINGS_UPDATED, {
        entityType: "settings", entityId: "medical",
        summary: `${rule.name} validated by ${name}: ${note}`
      });
      toastOk(`${rule.name} recorded as validated by ${name}.`);
      close();
      paint();
    } catch (error) {
      reportError(error, "Could not record the validation.");
      setBusy(event.target, false);
    }
  });
}

async function onRevoke(ruleId) {
  const rule = ruleById(ruleId);
  if (!rule) return;
  const ok = await confirmAction(
    `The calculation keeps running, but reports will again carry REQUIRES MEDICAL VALIDATION against `
    + `it until someone signs it off afresh. The original sign-off stays in the audit log.`,
    { title: `Withdraw validation — ${rule.name}`, confirmLabel: "Withdraw" });
  if (!ok) return;
  try {
    await revokeRuleValidation(ruleId, { by: ctx.session?.name || ctx.session?.email || "" });
    config = await loadMedicalConfig(getLabId(), { force: true });
    logAudit(AUDIT.SETTINGS_UPDATED, {
      entityType: "settings", entityId: "medical",
      summary: `Validation withdrawn for ${rule.name}`
    });
    toastOk("Validation withdrawn.");
    paint();
  } catch (error) {
    reportError(error, "Could not withdraw the validation.");
  }
}

function openRuleDetail(ruleId) {
  const rule = ruleById(ruleId);
  if (!rule) return;
  const e = effective(rule);
  const detail = openModal({
    title: rule.name,
    body: `
      <table class="data small">
        <tr><th style="width:32%">Type</th><td>${esc(labelForType(rule.type))}</td></tr>
        <tr><th>Formula</th><td><code>${esc(rule.formulaText)}</code></td></tr>
        <tr><th>Inputs</th><td>${esc(rule.inputs.map((i) => `${i.code}${i.unit ? ` (${i.unit})` : ""}`).join(", "))}</td></tr>
        <tr><th>Result unit</th><td>${esc(rule.outputUnit || "—")}</td></tr>
        <tr><th>Decimal places</th><td>${rule.precision ?? 2}</td></tr>
        <tr><th>Source</th><td>${esc(rule.source || "—")}</td></tr>
        <tr><th>Limitations</th><td>${esc(rule.limitations || "—")}</td></tr>
        <tr><th>Printed note</th><td>${esc(rule.reportNote || "—")}</td></tr>
        <tr><th>Version</th><td>v${rule.version}${rule.supersedes ? ` (replaces ${esc(rule.supersedes)})` : ""}</td></tr>
        <tr><th>Status here</th><td>${statusPill(e.status)}
          ${e.validatedBy ? `<div class="small muted">${esc(e.validatedBy)} · ${esc(e.validatedOn)}</div>` : ""}</td></tr>
      </table>
      <p class="small muted" style="margin-top:10px;">
        Reports keep the version number of the rule that produced each value, so a report reissued years
        later can be traced to the formula in force on the day it was authorised.</p>`,
    footer: `<button class="btn btn-outline" data-act="close" type="button">Close</button>`
  });
  detail.element.querySelector('[data-act="close"]').addEventListener("click", detail.close);
}

function labelForType(type) {
  return {
    [RULE_TYPE.CALCULATION]: "Calculation",
    [RULE_TYPE.REFERENCE]: "Reference interval",
    [RULE_TYPE.CRITICAL]: "Critical limit",
    [RULE_TYPE.INTERPRETATION]: "Interpretation",
    [RULE_TYPE.PATTERN]: "Pattern"
  }[type] || String(type || "");
}

/** Set the laboratory's own instrument/reagent constants for a rule that needs them. */
function openParamsDialog(ruleId) {
  const rule = ruleById(ruleId);
  if (!rule || !Array.isArray(rule.requires?.params)) return;
  const canEdit = sessionCanWrite(P.SETTINGS_EDIT, ctx.session);
  const current = effective(rule).params || {};

  const { element, close } = openModal({
    title: `Laboratory constants — ${rule.name}`,
    body: `
      <p class="small muted">
        These are your laboratory's own reagent and instrument values. The platform cannot know them and
        must not guess them, so <b>${esc(rule.name)}</b> does not calculate until they are entered. They are
        not a clinical sign-off and they are not a formula change — only Swati Softtech can version a formula.
      </p>
      <div class="card" style="background:var(--surface-2);">
        <p class="small" style="margin:0;"><b>Formula</b><br><code>${esc(rule.formulaText)}</code></p>
      </div>
      ${rule.requires.params.map((key) => {
        const meta = PARAM_HINTS[key] || { label: key, unit: "", hint: "" };
        return `<label class="small">${esc(meta.label)}${meta.unit ? ` <span class="muted">(${esc(meta.unit)})</span>` : ""}
          <input id="mp_${esc(key)}" class="input" inputmode="decimal" value="${esc(current[key] ?? "")}"
            ${canEdit ? "" : "disabled"}>
          ${meta.hint ? `<span class="muted">${esc(meta.hint)}</span>` : ""}
        </label>`;
      }).join("")}
      <p class="small muted">Stored with your medical configuration and recorded in the audit log.</p>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             ${canEdit ? `<button class="btn btn-green" data-act="save" type="button">Save constants</button>` : ""}`
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]')?.addEventListener("click", async (event) => {
    const params = {};
    let bad = "";
    rule.requires.params.forEach((key) => {
      const raw = element.querySelector(`#mp_${key}`).value.trim();
      if (raw === "") return;
      const num = Number(raw);
      if (!Number.isFinite(num) || num <= 0) bad = key;
      else params[key] = num;
    });
    if (bad) return toastError(`"${PARAM_HINTS[bad]?.label || bad}" must be a positive number.`);
    setBusy(event.target, true, "Saving...");
    try {
      await setRuleParams(ruleId, params, { by: ctx.session?.name || ctx.session?.email || "" });
      config = await loadMedicalConfig(getLabId(), { force: true });
      logAudit(AUDIT.SETTINGS_UPDATED, {
        entityType: "settings", entityId: "medical",
        summary: `Laboratory constants set for ${rule.name}: ${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")}`
      });
      toastOk(`Constants saved for ${rule.name}.`);
      close();
      paint();
    } catch (error) {
      reportError(error, "Could not save the constants.");
      setBusy(event.target, false);
    }
  });
}

function openIntervalDialog(key) {
  const [testCode, ...rest] = key.split("||");
  const parameterName = rest.join("||");
  const test = catalogue.find((t) => t.code === testCode);
  const param = (test?.parameters || []).find((p) => p.name === parameterName);
  if (!param) return;
  const existing = intervalOverride(config, testCode, parameterName) || {};
  const eligible = pathologistOptions();
  const val = (v) => (v === null || v === undefined ? "" : String(v));

  const { element, close } = openModal({
    title: parameterName,
    body: `
      <p class="small muted">${esc(test.name)}${param.unit ? ` · ${esc(param.unit)}` : ""}</p>
      ${param.normalRange ? `<p class="small">Inherited range supplied with the catalogue:
        <b>${esc(param.normalRange)}</b>. It was not established here.</p>` : ""}
      <div class="row-flex" style="gap:10px;">
        <label class="small" style="flex:1;">Reference low
          <input id="ivLow" class="input" inputmode="decimal" value="${esc(val(existing.low))}"></label>
        <label class="small" style="flex:1;">Reference high
          <input id="ivHigh" class="input" inputmode="decimal" value="${esc(val(existing.high))}"></label>
      </div>
      <div class="row-flex" style="gap:10px;">
        <label class="small" style="flex:1;">Critical low
          <input id="ivCritLow" class="input" inputmode="decimal" value="${esc(val(existing.criticalLow))}"></label>
        <label class="small" style="flex:1;">Critical high
          <input id="ivCritHigh" class="input" inputmode="decimal" value="${esc(val(existing.criticalHigh))}"></label>
      </div>
      <p class="small muted">A critical limit marks a result that needs a telephone call to the treating
      clinician, not merely a printed report. Leave blank if this laboratory has not set one.</p>
      <label class="small">How this interval was established
        <textarea id="ivBasis" class="input" rows="2"
          placeholder="e.g. Verified on 25 healthy local donors, or transferred from the kit insert and confirmed against 20 samples.">${esc(existing.basis || "")}</textarea>
      </label>
      ${eligible.length ? `
        <label class="small">Signed off by
          <select id="ivBy" class="input">
            <option value="">Save without sign-off — keep marked as requiring validation</option>
            ${eligible.map((s) => `<option value="${esc(s.name)}" ${existing.validatedBy === s.name ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
          </select>
        </label>`
        : `<p class="small muted">No pathologist is recorded as authorised to approve reports, so this
           interval can be saved but not signed off. Add one under Settings → Report signatories.</p>`}`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn btn-green" data-act="save" type="button">Save interval</button>`
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (event) => {
    setBusy(event.target, true, "Saving...");
    try {
      const by = element.querySelector("#ivBy")?.value || "";
      await saveInterval(testCode, parameterName, {
        low: element.querySelector("#ivLow").value,
        high: element.querySelector("#ivHigh").value,
        criticalLow: element.querySelector("#ivCritLow").value,
        criticalHigh: element.querySelector("#ivCritHigh").value,
        basis: element.querySelector("#ivBasis").value,
        unit: param.unit || "",
        validatedBy: by
      });
      config = await loadMedicalConfig(getLabId(), { force: true });
      logAudit(AUDIT.SETTINGS_UPDATED, {
        entityType: "settings", entityId: "medical",
        summary: `Reference interval set for ${parameterName} (${test.name})${by ? `, signed off by ${by}` : ", not signed off"}`
      });
      toastOk(by
        ? `Interval saved and signed off by ${by}.`
        : "Interval saved. It stays marked as requiring validation.");
      close();
      paint();
    } catch (error) {
      toastError(error.message || "Could not save the interval.");
      setBusy(event.target, false);
    }
  });
}
