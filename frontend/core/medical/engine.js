// Calculation engine, dependency graph and validation gate.
// NO Firebase imports — this is pure logic and must be runnable under Node.
//
// The contract: given a set of entered values and a patient context, produce
// derived values, or an explicit reason why not. It NEVER guesses, never
// silently substitutes a default, and never overwrites a measured result.
import { VALUE_ORIGIN, SKIP_REASON, SKIP_KIND, VALIDATION_STATUS, isComputable } from "./schema.js";
import { calculationRules, ruleById } from "./rules.js";
import { resolveRowCode, codeUnit, normalise } from "./codes.js";

/**
 * Development trace (§33). Off by default. Turn on from the browser console
 * with `window.__MEDICAL_TRACE = true` (or set globalThis.__MEDICAL_TRACE in a
 * test) to see every rule's inputs, output and status. Never logs in normal
 * operation, so nothing to strip for production.
 */
function trace(ruleId, payload) {
  try {
    if (!globalThis.__MEDICAL_TRACE) return;
    // eslint-disable-next-line no-console
    console.log(`[CALCULATION ENGINE] ${ruleId}`, payload);
  } catch { /* never let logging break a calculation */ }
}

/** An origin whose value a person stands behind — the engine must not recompute over it. */
function isProtectedOrigin(origin) {
  return origin === VALUE_ORIGIN.MEASURED || origin === VALUE_ORIGIN.MANUALLY_VERIFIED;
}

/**
 * Plausible analytical limits. These are NOT reference intervals — they are
 * "could an analyser have produced this at all" bounds, used to stop a typo
 * (a misplaced decimal, a transposed digit) propagating into a calculation.
 * Deliberately very wide: rejecting a real extreme result would be worse.
 */
export const PLAUSIBLE = Object.freeze({
  TOTAL_BILIRUBIN: [0, 60], DIRECT_BILIRUBIN: [0, 50],
  AST: [0, 20000], ALT: [0, 20000], ALP: [0, 5000],
  TOTAL_PROTEIN: [1, 15], ALBUMIN: [0.5, 8],
  TOTAL_CHOLESTEROL: [20, 1200], HDL: [1, 200], TRIGLYCERIDES: [10, 10000],
  UREA: [1, 500], BUN: [1, 250], CREATININE: [0.05, 25],
  SODIUM: [90, 200], POTASSIUM: [1, 10], CHLORIDE: [50, 160], BICARBONATE: [2, 60],
  CALCIUM: [3, 20],
  WBC: [10, 500000], HAEMOGLOBIN: [1, 25], PLATELETS: [1000, 3000000],
  RBC: [0.3, 12], PCV: [5, 80],
  NEUTROPHILS_PCT: [0, 100], LYMPHOCYTES_PCT: [0, 100], MONOCYTES_PCT: [0, 100],
  EOSINOPHILS_PCT: [0, 100], BASOPHILS_PCT: [0, 100],
  SERUM_IRON: [1, 1500], TIBC: [50, 1200],
  HBA1C: [2, 20], GLUCOSE_FASTING: [10, 1500], INSULIN_FASTING: [0.1, 1000],
  // Anthropometry
  HEIGHT: [20, 260], WEIGHT: [0.3, 500],
  // Coagulation
  PT: [5, 200], APTT: [10, 300],
  // Cardiac
  CK_TOTAL: [1, 500000], CK_MB: [0, 200000],
  // Renal clearance / urine chemistry
  URINE_CREATININE: [1, 1000], URINE_VOLUME: [1, 20000], COLLECTION_HOURS: [1, 168],
  URINE_ALBUMIN: [0, 30000], URINE_PROTEIN: [0, 40000],
  // Arterial blood gas
  PH_BLOOD: [6.5, 8], PCO2: [3, 200], PO2: [10, 700],
  // Body fluids
  FLUID_ALBUMIN: [0, 10], FLUID_TOTAL_PROTEIN: [0, 15],
  FLUID_LDH: [1, 200000], SERUM_LDH: [10, 200000],
  // Semen analysis
  SEMEN_VOLUME: [0, 15], SPERM_CONCENTRATION: [0, 3000],
  TOTAL_MOTILITY: [0, 100], PROGRESSIVE_MOTILITY: [0, 100]
});

/** Is `value` inside its plausible analytical window? Unknown codes pass. */
export function isPlausible(code, value) {
  const window = PLAUSIBLE[code];
  if (!window) return true;
  return value >= window[0] && value <= window[1];
}

/** Parse an entered result to a number, or null. Handles "12.4", " 12.4 g/dL". */
export function toNumeric(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  const text = String(raw).trim();
  if (!text) return null;
  // A qualitative result ("Negative", "Nil", "Trace") is not a number and must
  // not be coerced into one.
  const match = text.match(/^-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a code -> {value, raw, origin, unit} map from report groups.
 *
 * ROUNDING (§16). `value` is the RAW entered number, never a display-rounded
 * one. Downstream calculations use raw; only presentation rounds.
 */
export function collectValues(groups = []) {
  const values = {};
  // Every analyte the panel has a line for, whether or not it was filled in.
  // A blank line the laboratory intended to report is the one case where
  // "not calculated" must be said out loud.
  // Non-enumerable so it never shows up as an analyte to anything walking
  // this object.
  const requested = new Set();
  Object.defineProperty(values, "__requested", { value: requested, enumerable: false });
  groups.forEach((group) => {
    (group.rows || []).forEach((row) => {
      if (row.isHeading) return;
      // ONE resolver, shared with the flag engine and the write-back. A row's
      // own `code` is only trusted when it is genuinely a canonical analyte
      // code; otherwise the display name is resolved.
      const code = resolveRowCode(row);
      if (!code) return;
      const numeric = toNumeric(row.rawValue ?? row.value);
      requested.add(code);
      // A row this engine (or a manual override) produced carries its origin.
      // A plain measured row has none, and defaulting that to MEASURED is
      // correct. The trap this depends on avoiding: a previously-calculated
      // value reloaded WITHOUT its origin would be read as a measurement and
      // never refreshed — so the reopen path (mergeSavedResults) must carry
      // `origin` forward, which it now does.
      values[code] = {
        code,
        value: numeric,
        raw: row.rawValue ?? row.value,
        origin: row.origin || VALUE_ORIGIN.MEASURED,
        unit: row.unit || codeUnit(code),
        present: String(row.rawValue ?? row.value ?? "").trim() !== ""
      };
    });
  });
  return values;
}

/**
 * Order rules so a rule runs after everything it depends on.
 * Kahn's algorithm; a cycle is reported rather than silently dropped.
 */
export function orderRules(rules) {
  const byOutput = new Map();
  rules.forEach((r) => {
    if (!byOutput.has(r.outputCode)) byOutput.set(r.outputCode, []);
    byOutput.get(r.outputCode).push(r.id);
  });

  const edges = new Map();   // ruleId -> Set(ruleIds it must follow)
  rules.forEach((r) => {
    const deps = new Set(r.dependsOn || []);
    r.inputs.forEach((input) => {
      (byOutput.get(input.code) || []).forEach((producerId) => {
        if (producerId !== r.id) deps.add(producerId);
      });
    });
    edges.set(r.id, deps);
  });

  const ordered = [];
  const remaining = new Map(edges);
  const cycles = [];

  while (remaining.size) {
    const ready = [...remaining.entries()]
      .filter(([, deps]) => [...deps].every((d) => !remaining.has(d)))
      .map(([id]) => id);

    if (!ready.length) {
      cycles.push(...remaining.keys());
      break;   // a cycle: stop rather than loop forever
    }
    ready.sort();
    ready.forEach((id) => { ordered.push(id); remaining.delete(id); });
  }

  return { ordered: ordered.map((id) => rules.find((r) => r.id === id)), cycles };
}

/**
 * The validation gate (§15). Returns a skip reason, or null to proceed.
 * Runs BEFORE any arithmetic.
 *
 * @param {object} params  laboratory-specific constants for this rule (reagent
 *                          ISI, mean normal PT, …). Configured per lab, never
 *                          shipped as a default — some formulas are meaningless
 *                          without the laboratory's own value.
 */
export function validateInputs(rule, values, context = {}, params = {}) {
  // Required demographics first — a missing one is the most common cause and
  // deserves its own message.
  if (rule.requires?.age && !(Number(context.age) > 0)) return SKIP_REASON.MISSING_AGE;
  if (rule.requires?.sex && !String(context.sex || "").trim()) return SKIP_REASON.MISSING_SEX;
  if (rule.requires?.fasting && context.fasting !== true) return SKIP_REASON.MISSING_FASTING;

  // Laboratory-specific constants a formula cannot be run without. Not
  // demographics and not entered results — values like a reagent's ISI that
  // the laboratory configures once. A missing one is a configuration gap, and
  // guessing it would put a wrong number on a report.
  if (Array.isArray(rule.requires?.params)) {
    for (const key of rule.requires.params) {
      const value = Number(params?.[key]);
      if (!Number.isFinite(value) || value <= 0) return SKIP_REASON.MISSING_PARAM;
    }
  }

  for (const input of rule.inputs) {
    const entry = values[input.code];
    if (!entry || !entry.present) return SKIP_REASON.MISSING_INPUT;
    if (entry.value === null) return SKIP_REASON.NON_NUMERIC;

    // Unit check BEFORE the plausibility check. An empty unit on the entered
    // row means the laboratory did not record one; we accept it rather than
    // block, but a MISMATCH is refused — feeding mmol/L into an mg/dL formula
    // is exactly the failure this exists to prevent.
    //
    // The order matters twice over. The plausible limits below are expressed
    // in the formula's own unit, so checking them against a value in some
    // other unit is meaningless: it either reports "outside analytical limits"
    // when the real fault is the unit, or — for an analyte whose two unit
    // scales overlap — passes a wrongly scaled number straight into the
    // arithmetic.
    if (entry.unit && input.unit && normalise(entry.unit) !== normalise(input.unit)) {
      return SKIP_REASON.UNIT_MISMATCH;
    }
    if (!isPlausible(input.code, entry.value)) return SKIP_REASON.OUT_OF_RANGE;
  }
  return null;
}

/** Round for presentation only. Calculations always pass the raw number on. */
export function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/**
 * Run every enabled calculation over `groups`.
 *
 * @param {Array}  groups   report groups (test -> rows)
 * @param {object} context  { age, sex, fasting }
 * @param {object} labConfig per-rule overrides: { [ruleId]: {enabled, validationStatus} }
 * @param {object} options  { includeUnvalidated } — true in report entry so
 *                          staff see what they would get; false for a released
 *                          report, where only VALIDATED rules contribute.
 * @returns {{results: object, skipped: array, cycles: array}}
 */
export function runCalculations(groups, context = {}, labConfig = {}, options = {}) {
  const includeUnvalidated = options.includeUnvalidated !== false;
  const values = collectValues(groups);
  const all = calculationRules();
  const active = all.filter((rule) => {
    if (!isComputable(rule, labConfig)) return false;
    if (includeUnvalidated) return true;
    const status = labConfig[rule.id]?.validationStatus || rule.validationStatus;
    return status === VALIDATION_STATUS.VALIDATED;
  });

  const { ordered, cycles } = orderRules(active);
  const results = {};
  const skipped = [];

  // A rule that is switched off should SAY so rather than silently vanish —
  // otherwise a laboratory wondering why a value is missing has nothing to go
  // on. Only reported where the inputs are actually present, so a lipid panel
  // does not list every haematology rule as "disabled".
  if (options.explainDisabled !== false) {
    all.filter((rule) => !active.includes(rule)).forEach((rule) => {
      const inputsPresent = rule.inputs.every((i) => values[i.code]?.present);
      if (!inputsPresent) return;
      const status = labConfig[rule.id]?.validationStatus || rule.validationStatus;
      skipped.push({
        rule: rule.id, outputCode: rule.outputCode, name: rule.name,
        reason: status === VALIDATION_STATUS.DISABLED
          ? `Not calculated — ${rule.name} is disabled on this platform. ${rule.limitations || ""}`.trim()
          : SKIP_REASON.DISABLED,
        kind: SKIP_KIND.NOT_ENABLED,
        validationStatus: status
      });
    });
  }

  ordered.forEach((rule) => {
    // NEVER overwrite a value a person stands behind — a measured result, or
    // one a pathologist manually verified in place of the formula. A value
    // this engine itself produced last time (origin CALCULATED) is NOT
    // protected: it must be recomputed, or the reopen path would freeze a
    // stale number in the grid.
    const target = values[rule.outputCode];
    if (target?.present && isProtectedOrigin(target.origin)) {
      trace(rule.id, { skipped: SKIP_REASON.MEASURED_PRESENT, origin: target.origin });
      skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: SKIP_REASON.MEASURED_PRESENT, kind: SKIP_KIND.MEASURED_PRESENT });
      return;
    }
    // Some rules also defer to a different measured analyte (direct LDL).
    if (rule.supersededByMeasured) {
      const measured = values[rule.supersededByMeasured];
      if (measured?.present && isProtectedOrigin(measured.origin)) {
        skipped.push({
          rule: rule.id, outputCode: rule.outputCode, name: rule.name,
          reason: `Not calculated — a measured ${measured.code.replace(/_/g, " ").toLowerCase()} is present.`,
          kind: SKIP_KIND.MEASURED_PRESENT
        });
        return;
      }
    }

    const inputsComplete = rule.inputs.every((i) => values[i.code]?.present);
    const params = labConfig[rule.id]?.params || {};

    const gateFailure = validateInputs(rule, values, context, params);
    if (gateFailure) {
      skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: gateFailure, kind: SKIP_KIND.WITHHELD, inputsComplete });
      return;
    }

    const inputValues = {};
    rule.inputs.forEach((i) => { inputValues[i.code] = values[i.code].value; });

    const guardFailure = rule.guard?.(inputValues, context, params);
    if (guardFailure) {
      skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: guardFailure, kind: SKIP_KIND.WITHHELD, inputsComplete });
      return;
    }

    let raw;
    try {
      raw = rule.compute(inputValues, context, params);
    } catch (error) {
      skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: `Not calculated — ${error.message}`, kind: SKIP_KIND.WITHHELD, inputsComplete });
      return;
    }
    if (!Number.isFinite(raw)) {
      skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: SKIP_REASON.CONDITION_UNMET, kind: SKIP_KIND.WITHHELD, inputsComplete });
      return;
    }

    let note = "";
    if (rule.postCheck) {
      const checked = rule.postCheck(raw);
      if (checked.skip) {
        skipped.push({ rule: rule.id, outputCode: rule.outputCode, name: rule.name, reason: checked.skip, kind: SKIP_KIND.WITHHELD, inputsComplete });
        return;
      }
      raw = checked.value;
      note = checked.note || "";
    }

    const status = labConfig[rule.id]?.validationStatus || rule.validationStatus;
    results[rule.outputCode] = {
      code: rule.outputCode,
      ruleId: rule.id,
      ruleVersion: rule.version,
      name: rule.name,
      raw,                              // full precision, for downstream rules
      value: round(raw, rule.precision ?? 2),
      display: (rule.precision ?? 2) === 0
        ? String(Math.round(raw))
        : round(raw, rule.precision ?? 2).toFixed(rule.precision ?? 2),
      unit: rule.outputUnit,
      origin: VALUE_ORIGIN.CALCULATED,
      formulaText: rule.formulaText,
      validationStatus: status,
      reportNote: rule.reportNote || "",
      note,
      limitations: rule.limitations || ""
    };

    // Feed the result back so dependent rules see it at FULL precision.
    values[rule.outputCode] = {
      code: rule.outputCode, value: raw, raw,
      origin: VALUE_ORIGIN.CALCULATED, unit: rule.outputUnit, present: true
    };
    trace(rule.id, {
      inputs: inputValues, output: results[rule.outputCode].display,
      unit: rule.outputUnit, status: "SUCCESS"
    });
  });

  return { results, skipped, cycles, values };
}

/**
 * The subset of skipped calculations that belongs in front of a human.
 *
 * `runCalculations().skipped` is the audit record and holds every attempt.
 * This is what a report or the entry screen should show: the analyte was
 * expected, it is not there, and here is why. Configuration noise ("the
 * laboratory does not use this method") and cases where the measured value
 * is being shown instead are left out.
 */
export function displayNotices(run) {
  const produced = new Set(Object.keys(run.results || {}));
  const requested = run.values?.__requested || new Set();
  const seen = new Set();
  return (run.skipped || [])
    .filter((s) => s.kind === SKIP_KIND.WITHHELD)
    .filter((s) => !produced.has(s.outputCode))   // another method supplied it
    // A lipid profile must not carry "Absolute Basophil Count — not
    // calculated". A notice earns its place only when the panel has a line for
    // the analyte, or when every input was there and the rule still declined —
    // that second case is the substantive one (wrong unit, implausible input,
    // missing age, method limit exceeded).
    .filter((s) => requested.has(s.outputCode) || s.inputsComplete)
    .filter((s) => {
      if (seen.has(s.outputCode)) return false;   // one notice per analyte
      seen.add(s.outputCode);
      return true;
    });
}

/**
 * A readable dependency graph for the admin screen (§39).
 * @returns {Array<{id, name, output, inputs, dependsOn}>}
 */
export function dependencyGraph(labConfig = {}) {
  const rules = calculationRules().filter((r) => isComputable(r, labConfig));
  const { ordered, cycles } = orderRules(rules);
  const producedBy = new Map();
  rules.forEach((r) => producedBy.set(r.outputCode, r.id));

  return {
    cycles,
    nodes: ordered.map((rule) => ({
      id: rule.id,
      name: rule.name,
      panel: rule.panel,
      output: rule.outputCode,
      inputs: rule.inputs.map((i) => i.code),
      dependsOn: rule.inputs
        .map((i) => producedBy.get(i.code))
        .filter((id) => id && id !== rule.id),
      validationStatus: labConfig[rule.id]?.validationStatus || rule.validationStatus,
      enabled: labConfig[rule.id]?.enabled ?? rule.defaultEnabled ?? false
    }))
  };
}

export { ruleById };
