// One pass over a report: calculate, resolve intervals, flag, interpret.
//
// This is the seam between the medical engine and the rest of the product. It
// exists so report entry, the printed report and the patient's shared copy
// all reason about the same numbers. Two places deciding independently
// whether a value is high is how a report ends up printing one thing and
// saying another.
import { runCalculations, displayNotices } from "./engine.js";
import { resolveInterval } from "./intervals.js";
import { flagValue, runPatterns, buildDraftInterpretation } from "./interpretation.js";
import { FLAG, FLAG_LABEL, VALUE_ORIGIN, VALIDATION_STATUS, COMMENT_LEVEL } from "./schema.js";
import { resolveRowCode } from "./codes.js";
import { calculationRules } from "./rules.js";
import { isComputable } from "./schema.js";
import { emptyConfig, intervalOverride } from "./config.js";
import { evaluateLightsCriteria, lightsInputFromValues } from "./lights-criteria.js";

/**
 * The canonical code for a row, or null. Never a guess.
 * Delegates to the shared resolver so the value collector, the flag engine
 * and this write-back can never disagree about what a row is.
 */
export function codeForRow(row) {
  return resolveRowCode(row);
}

/** Every analyte code some calculation rule COULD produce (any config). */
const CALCULATED_OUTPUT_CODES = new Set(calculationRules().map((r) => r.outputCode));

/**
 * The output codes an ENABLED calculation rule produces for this laboratory.
 *
 * This is the distinction that stops a MEASURED value being hidden: BUN, MCV,
 * MCH, MCHC, INR and the total sperm count are all codes SOME rule can
 * produce, but a laboratory that measures them (and does not enable the
 * derivation) reports them as ordinary typed results. Only a code in this set
 * is treated as "calculated" on the entry screen.
 */
function activeCalcOutputs(config = {}) {
  const rulesCfg = config.rules || {};
  const out = new Set();
  calculationRules().forEach((rule) => {
    if (isComputable(rule, rulesCfg)) out.add(rule.outputCode);
  });
  return out;
}

/**
 * Does a person's own typed value stand on this row right now? A measured
 * result, or a manual override — either way the row is being reported as
 * entered, not calculated, even if some rule could also produce its code.
 */
function hasEnteredValue(row) {
  if (!row) return false;
  if (row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED) return true;
  if (row.calculated === true || row.origin === VALUE_ORIGIN.CALCULATED) return false;
  return String(row.value ?? "").trim() !== "";
}

/**
 * True when this row is a calculated parameter the engine is meant to fill —
 * so the UI shows it read-only (a value or a "waiting for inputs" state), never
 * an empty box a technician might type a derived value into.
 *
 * Prefers the engine's own per-report decision (`row.calcParam`, stamped by
 * analyseReport with the laboratory's configuration in hand). Falls back to a
 * value-aware static check only before the engine has run.
 */
export function isCalculatedParameterRow(row) {
  if (!row || row.isHeading) return false;
  if (row.calculated === true || row.origin === VALUE_ORIGIN.CALCULATED) return true;
  if (typeof row.calcParam === "boolean") return row.calcParam;
  if (hasEnteredValue(row)) return false;
  const code = resolveRowCode(row);
  return Boolean(code && CALCULATED_OUTPUT_CODES.has(code));
}

/**
 * Analyse a whole report.
 *
 * `groups` is mutated in place - rows gain their flag, interval and, where a
 * value was computed, the calculated value and the rule that produced it.
 * That matches how the entry screen already works and keeps one array as the
 * single description of the report.
 */
export function analyseReport(groups, patient = {}, config = emptyConfig()) {
  const context = { age: toAge(patient.age), sex: patient.gender || patient.sex || "", fasting: patient.fasting === true };
  const run = runCalculations(groups, context, config.rules || {});
  const activeCalc = activeCalcOutputs(config);

  // 1. Write calculated values back into their rows.
  const calculated = [];
  const skipByCode = new Map();
  (run.skipped || []).forEach((s) => { if (s.outputCode && !skipByCode.has(s.outputCode)) skipByCode.set(s.outputCode, s); });
  groups.forEach((group) => {
    (group.rows || []).forEach((row) => {
      if (row.isHeading) return;
      const code = codeForRow(row);
      const result = code ? run.results[code] : null;

      // Is THIS row a parameter the engine fills? Only if an enabled rule
      // produces its code AND no person has typed a value into it. A measured
      // BUN / MCV / INR is reported as entered, never hidden behind a
      // "calculated" state.
      row.calcParam = Boolean(code && activeCalc.has(code)) && !hasEnteredValue(row);

      if (!result) {
        // NEVER discard a value a person entered and stood behind.
        if (row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED) return;
        // A row that was calculated a moment ago and no longer can be must not
        // keep showing yesterday's number.
        if (row.origin === VALUE_ORIGIN.CALCULATED) { row.value = ""; }
        delete row.calculated;
        delete row.ruleId;
        delete row.ruleVersion;
        delete row.formulaText;
        delete row.calculationNote;
        if (row.origin === VALUE_ORIGIN.CALCULATED) delete row.origin;
        // A calculated line waiting on its inputs shows a read-only "waiting"
        // state. A row a person has typed into is left exactly as entered.
        if (row.calcParam) {
          row.calcPending = true;
          row.calcPendingReason = (code && skipByCode.get(code)?.reason)
            || "Waiting for the required parameters.";
        } else {
          delete row.calcPending;
          delete row.calcPendingReason;
        }
        return;
      }
      delete row.calcPending;
      delete row.calcPendingReason;
      // NEVER overwrite something a person entered and stood behind.
      if (row.origin === VALUE_ORIGIN.MANUALLY_VERIFIED) { row.calcParam = false; return; }

      row.value = result.display;
      row.origin = VALUE_ORIGIN.CALCULATED;
      row.calculated = true;
      row.calcParam = true;
      row.ruleId = result.ruleId;
      row.ruleVersion = result.ruleVersion;
      row.calculationNote = result.note || "";
      row.formulaText = result.formulaText;
      row.validationStatus = result.validationStatus;
      if (!row.unit && result.unit) row.unit = result.unit;
      calculated.push({ code, ...result });
    });
  });

  // 2. Resolve the interval that applies, then flag against it.
  const flagged = {};
  let unvalidatedIntervals = 0;
  groups.forEach((group) => {
    (group.rows || []).forEach((row) => {
      if (row.isHeading) return;
      const override = intervalOverride(config, group.testCode, row.name);
      const interval = resolveInterval(row, override, { sex: context.sex, age: context.age });
      row.interval = interval;
      row.intervalSource = interval.source;
      row.intervalUnvalidated = interval.unvalidated === true;
      if (interval.unvalidated && String(row.value ?? "").trim() !== "") unvalidatedIntervals += 1;

      // A laboratory that has set its own limits should see them printed.
      if (override && (override.low !== null || override.high !== null)) {
        row.referenceRange = limitText(override.low, override.high);
      }

      const flag = flagValue(row.value, interval);
      row.flagCode = flag;
      // NOT_INTERPRETABLE is a decision the engine made, not a finding about
      // the patient. Printing "Not interpretable" beside a perfectly clear
      // "Negative" would read as a failed test. The column stays blank; the
      // code is kept for anything that needs to reason about it.
      row.flag = flag === FLAG.NOT_INTERPRETABLE ? "" : (FLAG_LABEL[flag] || "");

      const code = codeForRow(row);
      if (code && flag !== FLAG.NOT_INTERPRETABLE) {
        flagged[code] = { code, name: row.name, value: row.value, flag, interval, unvalidated: interval.unvalidated === true };
      }
    });
  });

  // 3. Patterns.
  const patterns = runPatterns(flagged, context, config.rules || {});

  // 4. Light's criteria — only when the paired fluid/serum chemistry is on the
  // report. Structured, never a diagnosis. Criterion 3 needs this laboratory's
  // own serum-LDH upper limit, taken from the interval it resolved above.
  let lights = null;
  const lightsInput = lightsInputFromValues(run.values, {
    serumLDHUpperLimit: flagged.SERUM_LDH?.interval?.high ?? null
  });
  if (lightsInput.fluidProtein != null || lightsInput.fluidLDH != null) {
    lights = evaluateLightsCriteria(lightsInput);
    if (lights.applicable) {
      // Fold the structured result into the draft as one restrained line. It
      // describes the ratios, recommends correlation, and never diagnoses.
      patterns.push({
        ruleId: "PATTERN.LIGHTS_CRITERIA", ruleVersion: 1, panel: "Body fluid",
        level: COMMENT_LEVEL.PATTERN, text: lights.summary
      });
    }
  }

  // 5. The draft comment, from the flags and every pattern above.
  const draft = buildDraftInterpretation({ flagged, patterns, unvalidatedIntervals });

  return {
    groups,
    results: run.results,
    calculated,
    notices: displayNotices(run),
    cycles: run.cycles,
    flagged,
    patterns,
    draft,
    lights,
    unvalidatedIntervals,
    criticalRows: rowsWithCriticalValues(groups)
  };
}

function limitText(low, high) {
  if (low === null && high === null) return "";
  if (low === null) return `up to ${high}`;
  if (high === null) return `${low} and above`;
  return `${low} - ${high}`;
}

function toAge(age) {
  const years = Number(String(age ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(years) && years > 0 ? years : null;
}

/** Rows a critical result was entered against - the ones needing a telephone call. */
export function rowsWithCriticalValues(groups) {
  const out = [];
  groups.forEach((group) => {
    (group.rows || []).forEach((row) => {
      if (row.flagCode === FLAG.CRITICAL_LOW || row.flagCode === FLAG.CRITICAL_HIGH) {
        out.push({ test: group.testName, name: row.name, value: row.value, unit: row.unit, flag: row.flag });
      }
    });
  });
  return out;
}

/**
 * What must be true before this report can be released to a patient.
 *
 * Returns every reason at once rather than the first, because a user who
 * fixes one blocker and is immediately shown another learns to distrust the
 * screen.
 */
export function releaseBlockers(analysis, { interpretationRecord = null, signatories = [] } = {}) {
  const blockers = [];
  const authorised = signatories.filter((s) => s.canApproveReports === true);

  if (analysis.criticalRows.length) {
    blockers.push({
      kind: "CRITICAL",
      text: `${analysis.criticalRows.length} result${analysis.criticalRows.length === 1 ? " is" : "s are"} `
        + `in the critical range and must be seen by a pathologist: `
        + analysis.criticalRows.map((r) => `${r.name} ${r.value}`).join(", ") + "."
    });
  }
  if (analysis.draft?.holdsRelease && !analysis.criticalRows.length) {
    blockers.push({ kind: "REVIEW", text: "This report is held for pathologist review." });
  }
  // Advisory, not blocking. Every laboratory starts with inherited intervals;
  // holding on that would stop it working from day one, and the note is
  // printed on the report either way.
  if (analysis.unvalidatedIntervals > 0) {
    blockers.push({
      kind: "ADVISORY",
      text: `${analysis.unvalidatedIntervals} reference interval${analysis.unvalidatedIntervals === 1 ? "" : "s"} `
        + `used here ${analysis.unvalidatedIntervals === 1 ? "has" : "have"} not been validated by this `
        + `laboratory. The report will say so. Settings → Medical Rules is where they are signed off.`
    });
  }
  if (!authorised.length) {
    blockers.push({
      kind: "NO_PATHOLOGIST",
      text: "No pathologist of this laboratory is recorded as authorised to approve reports. "
        + "Add one under Settings → Report signatories."
    });
  }
  if (interpretationRecord && !interpretationRecord.clinicallyValidated
      && String(interpretationRecord.generatedText || "").trim()) {
    blockers.push({
      kind: "UNAPPROVED_COMMENT",
      text: "The interpretive comment has not been approved by a pathologist. It will not be printed."
    });
  }
  return blockers;
}

/**
 * The line a report carries about its own validation state.
 *
 * A report that rests on formulae or intervals nobody at the laboratory has
 * verified says so, in the same words everywhere. The software never claims
 * clinical validation on its own account.
 */
export function validationFooter(analysis, config = emptyConfig()) {
  const pending = analysis.calculated.filter(
    (c) => c.validationStatus !== VALIDATION_STATUS.VALIDATED).length;
  const lines = [];
  if (pending || analysis.unvalidatedIntervals) {
    const parts = [];
    if (pending) parts.push(`${pending} calculated parameter${pending === 1 ? "" : "s"}`);
    if (analysis.unvalidatedIntervals) {
      parts.push(`${analysis.unvalidatedIntervals} reference interval${analysis.unvalidatedIntervals === 1 ? "" : "s"}`);
    }
    lines.push(
      `REQUIRES MEDICAL VALIDATION: ${parts.join(" and ")} on this report follow values supplied with the `
      + `software that this laboratory has not yet verified against its own methods. Interpretation should be `
      + `performed by the treating clinician or pathologist.`);
  }
  analysis.calculated.forEach((c) => {
    if (c.reportNote && !lines.includes(c.reportNote)) lines.push(c.reportNote);
  });
  return lines;
}
