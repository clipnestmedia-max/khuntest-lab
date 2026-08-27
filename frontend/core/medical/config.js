// Per-laboratory medical configuration.
//
// The rule set that ships with the platform is a STARTING POINT, not a
// clinical decision. NABL 112 and ISO 15189 both put the reference intervals,
// the critical limits and the choice of method on the laboratory, and this
// module is where that ownership lives: which calculations this laboratory
// runs, what intervals it has verified for its own population and analysers,
// and who signed each of those off.
//
// Nothing here can mark anything VALIDATED on its own. Every sign-off carries
// the name of the pathologist who gave it and the date they gave it, because
// that is what an assessor asks to see.
import { getDoc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { settingsDoc, getLabId } from "../tenant.js";
import { VALIDATION_STATUS } from "./schema.js";
import { calculationRules } from "./rules.js";

const CACHE = new Map();

/** The key an interval override is stored under. Stable and human-readable. */
export function intervalKey(testCode, parameterName) {
  return `${String(testCode || "").trim()}::${String(parameterName || "").trim()}`;
}

/** An empty configuration: everything at its shipped default. */
export function emptyConfig() {
  return { rules: {}, intervals: {}, interpretation: { enabled: false } };
}

/**
 * Load this laboratory's medical configuration.
 *
 * A read failure returns the shipped defaults rather than throwing. That is
 * deliberate and it is the safe direction: the defaults run fewer
 * calculations and mark more things unvalidated, so a laboratory that cannot
 * read its own settings gets a more cautious report, never a less cautious
 * one.
 */
export async function loadMedicalConfig(labId = getLabId(), { force = false } = {}) {
  if (!force && CACHE.has(labId)) return CACHE.get(labId);
  let config = emptyConfig();
  try {
    const snap = await getDoc(settingsDoc("medical", labId));
    if (snap.exists()) {
      const data = snap.data() || {};
      config = {
        rules: data.rules || {},
        intervals: data.intervals || {},
        interpretation: data.interpretation || { enabled: false }
      };
    }
  } catch { /* shipped defaults */ }
  CACHE.set(labId, config);
  return config;
}

export function clearMedicalConfigCache(labId = null) {
  if (labId) CACHE.delete(labId); else CACHE.clear();
}

/**
 * Turn a calculation on or off for this laboratory.
 *
 * Enabling does not validate it. A rule that is enabled and still
 * REQUIRES MEDICAL VALIDATION runs, and says so on the report.
 */
export async function setRuleEnabled(ruleId, enabled, { by = "" } = {}) {
  const labId = getLabId();
  const config = await loadMedicalConfig(labId, { force: true });
  const entry = { ...(config.rules[ruleId] || {}), enabled: Boolean(enabled), changedBy: by, changedOn: new Date().toISOString().slice(0, 10) };
  await setDoc(settingsDoc("medical", labId),
    { labId, rules: { [ruleId]: entry }, updatedAt: serverTimestamp() }, { merge: true });
  clearMedicalConfigCache(labId);
  return entry;
}

/**
 * Store the laboratory-specific constants a formula needs (reagent ISI and
 * mean normal PT for INR; FiO₂ / barometric pressure for the A–a gradient).
 *
 * These are NOT clinical validation and NOT a formula edit — they are the
 * laboratory's own instrument/reagent values, which the platform cannot know
 * and must never guess. A rule that needs them does not calculate until they
 * are set.
 */
export async function setRuleParams(ruleId, params, { by = "" } = {}) {
  const labId = getLabId();
  const config = await loadMedicalConfig(labId, { force: true });
  const clean = {};
  Object.entries(params || {}).forEach(([key, value]) => {
    const num = Number(value);
    if (Number.isFinite(num)) clean[key] = num;
  });
  const entry = {
    ...(config.rules[ruleId] || {}),
    params: { ...((config.rules[ruleId] || {}).params || {}), ...clean },
    paramsSetBy: String(by || "").trim(),
    paramsSetOn: new Date().toISOString().slice(0, 10)
  };
  await setDoc(settingsDoc("medical", labId),
    { labId, rules: { [ruleId]: entry }, updatedAt: serverTimestamp() }, { merge: true });
  clearMedicalConfigCache(labId);
  return entry;
}

/**
 * Record a pathologist's sign-off on a calculation rule.
 *
 * `pathologist` must be a named person. The software refuses to record a
 * validation with no one attached to it, because such a record proves
 * nothing: an assessor asking "who verified this formula against your
 * method?" needs an answer with a name in it.
 */
export async function validateRule(ruleId, { pathologist, registrationNumber = "", note = "", on = null }) {
  const name = String(pathologist || "").trim();
  if (!name) throw new Error("A validation must name the pathologist who gave it.");
  const labId = getLabId();
  const config = await loadMedicalConfig(labId, { force: true });
  const entry = {
    ...(config.rules[ruleId] || {}),
    enabled: true,
    validationStatus: VALIDATION_STATUS.VALIDATED,
    validatedBy: name,
    validatedRegistration: String(registrationNumber || "").trim(),
    validatedOn: on || new Date().toISOString().slice(0, 10),
    validationNote: String(note || "").trim()
  };
  await setDoc(settingsDoc("medical", labId),
    { labId, rules: { [ruleId]: entry }, updatedAt: serverTimestamp() }, { merge: true });
  clearMedicalConfigCache(labId);
  return entry;
}

/** Withdraw a sign-off. The rule reverts to requiring validation; it is not deleted. */
export async function revokeRuleValidation(ruleId, { by = "", reason = "" } = {}) {
  const labId = getLabId();
  const config = await loadMedicalConfig(labId, { force: true });
  const entry = {
    ...(config.rules[ruleId] || {}),
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    revokedBy: String(by || "").trim(),
    revokedOn: new Date().toISOString().slice(0, 10),
    revocationReason: String(reason || "").trim()
  };
  delete entry.validatedBy;
  delete entry.validatedOn;
  delete entry.validatedRegistration;
  await setDoc(settingsDoc("medical", labId),
    { labId, rules: { [ruleId]: entry }, updatedAt: serverTimestamp() }, { merge: true });
  clearMedicalConfigCache(labId);
  return entry;
}

/**
 * Save a reference interval this laboratory has established or verified for
 * one parameter.
 *
 * A validated interval needs a name against it for the same reason a rule
 * does. An interval saved without one is stored, and stays marked as
 * requiring validation.
 */
export async function saveInterval(testCode, parameterName, interval) {
  const labId = getLabId();
  const key = intervalKey(testCode, parameterName);
  const name = String(interval.validatedBy || "").trim();
  const num = (v) => (String(v ?? "").trim() === "" ? null : Number(v));

  const entry = {
    testCode: String(testCode || ""),
    parameterName: String(parameterName || ""),
    low: num(interval.low),
    high: num(interval.high),
    criticalLow: num(interval.criticalLow),
    criticalHigh: num(interval.criticalHigh),
    unit: String(interval.unit || "").trim(),
    basis: String(interval.basis || "").trim(),   // how it was established
    validationStatus: name ? VALIDATION_STATUS.VALIDATED : VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    validatedBy: name,
    validatedOn: name ? (interval.validatedOn || new Date().toISOString().slice(0, 10)) : "",
    updatedOn: new Date().toISOString().slice(0, 10)
  };

  [["low", "high"], ["criticalLow", "criticalHigh"]].forEach(([lo, hi]) => {
    if (entry[lo] !== null && entry[hi] !== null && entry[lo] > entry[hi]) {
      throw new Error(`The lower limit (${entry[lo]}) is above the upper limit (${entry[hi]}).`);
    }
  });
  if (entry.criticalLow !== null && entry.low !== null && entry.criticalLow > entry.low) {
    throw new Error("The critical low limit must sit below the reference low limit.");
  }
  if (entry.criticalHigh !== null && entry.high !== null && entry.criticalHigh < entry.high) {
    throw new Error("The critical high limit must sit above the reference high limit.");
  }

  await setDoc(settingsDoc("medical", labId),
    { labId, intervals: { [key]: entry }, updatedAt: serverTimestamp() }, { merge: true });
  clearMedicalConfigCache(labId);
  return entry;
}

/** The stored override for one parameter, or null. */
export function intervalOverride(config, testCode, parameterName) {
  return config?.intervals?.[intervalKey(testCode, parameterName)] || null;
}

/**
 * A plain-language summary for the settings screen and for the report footer.
 * Counts what this laboratory has actually signed off against what it uses.
 */
export function validationSummary(config) {
  const rules = calculationRules();
  let enabled = 0, validated = 0;
  rules.forEach((rule) => {
    const override = config?.rules?.[rule.id] || {};
    const isOn = override.enabled ?? rule.defaultEnabled ?? true;
    if (!isOn) return;
    enabled += 1;
    if ((override.validationStatus || rule.validationStatus) === VALIDATION_STATUS.VALIDATED) validated += 1;
  });
  const intervals = Object.values(config?.intervals || {});
  const intervalsValidated = intervals.filter((i) => i.validationStatus === VALIDATION_STATUS.VALIDATED).length;
  return {
    rulesEnabled: enabled,
    rulesValidated: validated,
    rulesPending: enabled - validated,
    intervalsConfigured: intervals.length,
    intervalsValidated,
    complete: enabled > 0 && enabled === validated
  };
}
