// Medical rule schema — the vocabulary the whole engine is built on.
// NO IMPORTS, by design: this must be readable by tests, build scripts and
// the browser without initialising anything.
//
// GOVERNING PRINCIPLE (non-negotiable, from the product decisions):
// an unverified formula, reference interval, critical value or interpretation
// rule must NEVER silently become a production clinical rule. Every rule
// carries a validation status, and anything short of VALIDATED is either
// withheld from a released report or shown with an explicit warning.

/** What a rule does. */
export const RULE_TYPE = Object.freeze({
  CALCULATION: "CALCULATION",       // derives a value from other values
  REFERENCE: "REFERENCE",           // a reference interval
  CRITICAL: "CRITICAL",             // a critical-value threshold
  INTERPRETATION: "INTERPRETATION", // single-parameter comment
  PATTERN: "PATTERN"                // multi-parameter comment
});

/**
 * How far a rule has got through clinical validation.
 *
 * VALIDATED                    verified to an authoritative source AND signed
 *                              off by the laboratory's authorised pathologist.
 * REQUIRES_MEDICAL_VALIDATION  the software can compute it, but no qualified
 *                              person has signed it off for this laboratory.
 *                              Never presented as a validated clinical value.
 * DISABLED                     deliberately off (e.g. contested formulas).
 * RETIRED                      superseded; kept so old reports reproduce.
 */
export const VALIDATION_STATUS = Object.freeze({
  VALIDATED: "VALIDATED",
  REQUIRES_MEDICAL_VALIDATION: "REQUIRES_MEDICAL_VALIDATION",
  DISABLED: "DISABLED",
  RETIRED: "RETIRED"
});

export const VALIDATION_LABEL = Object.freeze({
  VALIDATED: "Validated",
  REQUIRES_MEDICAL_VALIDATION: "REQUIRES MEDICAL VALIDATION",
  DISABLED: "Disabled",
  RETIRED: "Retired"
});

/** How a parameter's value came to exist. Printed on the report. */
export const VALUE_ORIGIN = Object.freeze({
  MEASURED: "MEASURED",                   // entered from an analyser or bench
  CALCULATED: "CALCULATED",               // derived by this engine
  ANALYZER_DERIVED: "ANALYZER_DERIVED",   // the analyser computed it, not us
  MANUALLY_VERIFIED: "MANUALLY_VERIFIED"  // e.g. a smear-confirmed differential
});

export const ORIGIN_LABEL = Object.freeze({
  MEASURED: "",
  CALCULATED: "Calculated",
  ANALYZER_DERIVED: "Analyser-derived",
  MANUALLY_VERIFIED: "Manually verified"
});

/**
 * How much the engine is willing to say. Level 3 HOLDS the report.
 * (Product spec §31.)
 */
export const COMMENT_LEVEL = Object.freeze({
  NONE: 0,        // no interpretation
  STATEMENT: 1,   // "X is above the laboratory reference interval."
  PATTERN: 2,     // multi-parameter pattern description
  REVIEW: 3       // pathologist review required before release
});

/** Result of evaluating one value against its interval. */
export const FLAG = Object.freeze({
  NORMAL: "NORMAL",
  LOW: "LOW",
  HIGH: "HIGH",
  CRITICAL_LOW: "CRITICAL_LOW",
  CRITICAL_HIGH: "CRITICAL_HIGH",
  ABNORMAL: "ABNORMAL",
  NOT_INTERPRETABLE: "NOT_INTERPRETABLE"
});

export const FLAG_LABEL = Object.freeze({
  NORMAL: "", LOW: "Low", HIGH: "High",
  CRITICAL_LOW: "Critical Low", CRITICAL_HIGH: "Critical High",
  ABNORMAL: "Abnormal", NOT_INTERPRETABLE: "Not interpretable"
});

/** Where a calculation refused to run. Shown to the technician verbatim. */
export const SKIP_REASON = Object.freeze({
  MISSING_INPUT: "Not calculated — required input unavailable.",
  NON_NUMERIC: "Not calculated — a required input is not numeric.",
  MISSING_AGE: "Not calculated — patient age not recorded.",
  MISSING_SEX: "Not calculated — patient sex not recorded.",
  MISSING_FASTING: "Not calculated — fasting status not recorded.",
  UNIT_MISMATCH: "Not calculated — input units do not match the formula.",
  OUT_OF_RANGE: "Not calculated — an input is outside plausible analytical limits.",
  CONDITION_UNMET: "Not calculated — the conditions for this formula are not satisfied.",
  DISABLED: "Not calculated — this calculation is not enabled for this laboratory.",
  MEASURED_PRESENT: "Not calculated — a measured value is present and is never overwritten.",
  MISSING_PARAM: "Not calculated — a laboratory-specific constant for this formula (e.g. the reagent ISI "
    + "or the mean normal PT) has not been configured. Set it in Settings → Medical Rules → Constants."
});

/**
 * Why a calculation did not run, in a form code can branch on.
 *
 * Every skip is recorded for audit, but they do not all belong on a patient's
 * report. A laboratory that runs Friedewald does not need its reports
 * annotated "Martin-Hopkins is not enabled" — that is a configuration fact,
 * not a clinical one. A result that was WITHHELD is the opposite: the
 * clinician expected a number, there is none, and the reason must be printed.
 */
export const SKIP_KIND = Object.freeze({
  NOT_ENABLED: "NOT_ENABLED",           // configuration; not shown on the report
  MEASURED_PRESENT: "MEASURED_PRESENT", // the measured value is shown instead
  WITHHELD: "WITHHELD"                  // expected but not produced; must be shown
});

/** Pathologist review states (§30, §5 of the product decisions). */
export const REVIEW_STATUS = Object.freeze({
  DRAFT: "DRAFT",                       // software-generated, untouched
  REVIEW_REQUIRED: "REVIEW_REQUIRED",   // must be seen before release
  EDITED: "EDITED",                     // pathologist changed the text
  APPROVED: "APPROVED"                  // pathologist approved; releasable
});

/**
 * Placeholder used for demo and development data.
 * A generated rule set is NEVER clinically validated merely because the
 * software produced it; a real, named, authorised pathologist must sign off.
 */
export const DEMO_PATHOLOGIST = "DEMO — PATHOLOGIST REVIEW REQUIRED";

/** Is this string a real signatory, or the demo placeholder? */
export function isRealPathologist(name) {
  const value = String(name || "").trim();
  return Boolean(value) && value !== DEMO_PATHOLOGIST && !/^demo\b/i.test(value);
}

/**
 * Shape check for a rule. Returns a list of problems; empty means well-formed.
 * This is structural only — it says nothing about clinical correctness.
 */
export function validateRuleShape(rule) {
  const problems = [];
  const need = (field) => {
    if (rule[field] === undefined || rule[field] === null || rule[field] === "") {
      problems.push(`missing "${field}"`);
    }
  };

  ["id", "version", "type", "name", "validationStatus"].forEach(need);

  if (rule.type && !RULE_TYPE[rule.type]) problems.push(`unknown type "${rule.type}"`);
  if (rule.validationStatus && !VALIDATION_STATUS[rule.validationStatus]) {
    problems.push(`unknown validationStatus "${rule.validationStatus}"`);
  }
  if (rule.version !== undefined && !Number.isInteger(rule.version)) {
    problems.push("version must be an integer");
  }

  if (rule.type === RULE_TYPE.CALCULATION) {
    if (typeof rule.compute !== "function") problems.push("CALCULATION needs a compute() function");
    if (!Array.isArray(rule.inputs) || !rule.inputs.length) problems.push("CALCULATION needs inputs[]");
    need("outputCode");
    need("outputUnit");
    if (rule.precision !== undefined && !Number.isInteger(rule.precision)) {
      problems.push("precision must be an integer");
    }
  }

  if (rule.type === RULE_TYPE.PATTERN && typeof rule.evaluate !== "function") {
    problems.push("PATTERN needs an evaluate() function");
  }

  // Every clinical rule must say where it came from. A rule with no source
  // cannot be reviewed, and an unreviewable rule cannot be validated.
  if (!rule.source || !rule.source.title) {
    problems.push("missing source.title — a rule with no source cannot be reviewed");
  }

  // A rule may only claim VALIDATED if a named human signed it off.
  if (rule.validationStatus === VALIDATION_STATUS.VALIDATED && !isRealPathologist(rule.source?.reviewedBy)) {
    problems.push(
      "claims VALIDATED without a named reviewer — software cannot validate itself"
    );
  }

  return problems;
}

/** True when a rule may contribute to a RELEASED patient report. */
export function isReleasable(rule, labConfig = {}) {
  const override = labConfig[rule.id];
  const status = override?.validationStatus || rule.validationStatus;
  const enabled = override?.enabled ?? rule.defaultEnabled ?? false;
  return enabled && status === VALIDATION_STATUS.VALIDATED;
}

/**
 * True when a rule may be COMPUTED and shown internally (report entry,
 * preview) with its status displayed. Unvalidated rules are visible to staff
 * so a laboratory can see what it would get, but are withheld from a released
 * report until signed off.
 */
export function isComputable(rule, labConfig = {}) {
  const override = labConfig[rule.id];
  const status = override?.validationStatus || rule.validationStatus;
  const enabled = override?.enabled ?? rule.defaultEnabled ?? false;
  return enabled
    && status !== VALIDATION_STATUS.DISABLED
    && status !== VALIDATION_STATUS.RETIRED;
}
