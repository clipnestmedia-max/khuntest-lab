// Light's criteria — evaluated as a rule engine, not a single formula (§15).
// NO Firebase imports.
//
// SAFETY CONTRACT. This returns a STRUCTURED description of which criteria are
// met. It does not diagnose. "Exudative pattern" is a statement about the
// three ratios below, not about the patient, and it is handed to a pathologist
// to interpret. A transudate/exudate call also depends on the clinical picture
// and on pre-test albumin gradients that this function does not see.
import { VALIDATION_STATUS } from "./schema.js";

/**
 * @typedef {object} LightsInput
 * @property {number} fluidProtein            g/dL
 * @property {number} serumProtein            g/dL
 * @property {number} fluidLDH                U/L
 * @property {number} serumLDH                U/L
 * @property {number} [serumLDHUpperLimit]    U/L — this laboratory's ULN for serum LDH.
 *                                            Criterion 3 is only evaluated when it is provided;
 *                                            it must be the laboratory's own, not a generic value.
 */

const num = (x) => {
  if (x === null || x === undefined) return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const text = String(x).trim();
  if (text === "") return null;            // "" and whitespace are not zero
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
};

/**
 * Evaluate the three classic Light's criteria.
 *
 * @param {LightsInput} input
 * @returns {{
 *   applicable: boolean,
 *   criteria: Array<{n:number,name:string,measured:(number|null),threshold:(number|null),met:(boolean|null),detail:string}>,
 *   metCount: number,
 *   evaluableCount: number,
 *   meetsExudativeCriteria: (boolean|null),
 *   summary: string,
 *   validationStatus: string,
 *   note: string
 * }}
 */
export function evaluateLightsCriteria(input = {}) {
  const fluidProtein = num(input.fluidProtein);
  const serumProtein = num(input.serumProtein);
  const fluidLDH = num(input.fluidLDH);
  const serumLDH = num(input.serumLDH);
  const serumLDHUpperLimit = num(input.serumLDHUpperLimit);

  const criteria = [];

  // Criterion 1 — fluid protein : serum protein > 0.5
  if (fluidProtein !== null && serumProtein !== null && serumProtein > 0) {
    const ratio = fluidProtein / serumProtein;
    criteria.push({
      n: 1, name: "Fluid protein / serum protein",
      measured: round2(ratio), threshold: 0.5, met: ratio > 0.5,
      detail: `${fmt(fluidProtein)} ÷ ${fmt(serumProtein)} = ${round2(ratio)} (exudative if > 0.5)`
    });
  } else {
    criteria.push({ n: 1, name: "Fluid protein / serum protein", measured: null, threshold: 0.5, met: null,
      detail: "Not evaluated — fluid and serum total protein are both required." });
  }

  // Criterion 2 — fluid LDH : serum LDH > 0.6
  if (fluidLDH !== null && serumLDH !== null && serumLDH > 0) {
    const ratio = fluidLDH / serumLDH;
    criteria.push({
      n: 2, name: "Fluid LDH / serum LDH",
      measured: round2(ratio), threshold: 0.6, met: ratio > 0.6,
      detail: `${fmt(fluidLDH)} ÷ ${fmt(serumLDH)} = ${round2(ratio)} (exudative if > 0.6)`
    });
  } else {
    criteria.push({ n: 2, name: "Fluid LDH / serum LDH", measured: null, threshold: 0.6, met: null,
      detail: "Not evaluated — fluid and serum LDH are both required." });
  }

  // Criterion 3 — fluid LDH > two-thirds of the upper limit of normal serum LDH
  if (fluidLDH !== null && serumLDHUpperLimit !== null && serumLDHUpperLimit > 0) {
    const threshold = (2 / 3) * serumLDHUpperLimit;
    criteria.push({
      n: 3, name: "Fluid LDH vs ⅔ × upper limit of normal serum LDH",
      measured: round2(fluidLDH), threshold: round2(threshold), met: fluidLDH > threshold,
      detail: `${fmt(fluidLDH)} vs ⅔ × ${fmt(serumLDHUpperLimit)} = ${round2(threshold)} (exudative if fluid LDH is greater)`
    });
  } else {
    criteria.push({ n: 3, name: "Fluid LDH vs ⅔ × upper limit of normal serum LDH", measured: null, threshold: null, met: null,
      detail: "Not evaluated — needs fluid LDH and this laboratory's own upper limit of normal for serum LDH." });
  }

  const evaluable = criteria.filter((c) => c.met !== null);
  const metCount = evaluable.filter((c) => c.met === true).length;
  const applicable = evaluable.length > 0;

  let meetsExudativeCriteria = null;
  if (applicable) meetsExudativeCriteria = metCount >= 1;

  let summary;
  if (!applicable) {
    summary = "Light's criteria could not be evaluated — the required paired fluid and serum values are not all present.";
  } else if (meetsExudativeCriteria) {
    summary = `An exudative pattern by Light's criteria (${metCount} of ${evaluable.length} evaluated criteria met). `
      + "Clinical correlation is recommended; a serum–effusion albumin gradient may help where the clinical "
      + "picture suggests a transudate.";
  } else {
    summary = `The evaluated Light's criteria are not met (0 of ${evaluable.length}). `
      + "This does not by itself establish a transudate; clinical correlation is recommended.";
  }

  return {
    applicable,
    criteria,
    metCount,
    evaluableCount: evaluable.length,
    meetsExudativeCriteria,
    summary,
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    note: "Light's criteria describe a pattern in paired fluid/serum chemistry. They are decision support "
      + "for a pathologist, not a diagnosis, and are known to classify a proportion of transudates as "
      + "exudates."
  };
}

/** Pull the inputs Light's criteria needs out of an analysed report's values. */
export function lightsInputFromValues(values = {}, { serumLDHUpperLimit = null } = {}) {
  const v = (code) => {
    const entry = values[code];
    if (!entry) return null;
    return typeof entry.value === "number" ? entry.value : num(entry.value ?? entry.raw);
  };
  return {
    fluidProtein: v("FLUID_TOTAL_PROTEIN"),
    serumProtein: v("TOTAL_PROTEIN"),
    fluidLDH: v("FLUID_LDH"),
    serumLDH: v("SERUM_LDH"),
    serumLDHUpperLimit
  };
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function fmt(n) { return String(round2(n)); }

export { VALIDATION_STATUS };
