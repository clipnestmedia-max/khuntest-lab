// Reference-interval resolution, with validation status carried through.
// NO Firebase imports.
//
// Product decision 1: the intervals inherited from the KhunTest catalogue stay
// in the database, are NOT deleted, and are NOT presented as clinically
// validated. Every interval carries where it came from and whether anyone has
// signed it off, and that status travels all the way to the report.
import { VALIDATION_STATUS } from "./schema.js";
import { parseLeadingNumber } from "./interpretation.js";

export const INTERVAL_SOURCE = Object.freeze({
  LAB_VALIDATED: "LAB_VALIDATED",   // this laboratory established/verified it
  INHERITED: "INHERITED",           // came with the catalogue; provenance unknown
  PLATFORM_PROPOSED: "PLATFORM_PROPOSED"  // Swati proposed it; not yet signed off
});

/**
 * Parse an interval out of the text a catalogue holds.
 * "13.2-16.6" · "< 200" · "Up to 40" · "M: 13.2-16.6, F: 11.6-15.0"
 */
export function parseIntervalText(text) {
  const value = String(text || "").trim();
  if (!value) return { low: null, high: null };

  const between = value.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (between) return { low: Number(between[1]), high: Number(between[2]) };

  const under = value.match(/(?:<|less than|upto|up to|below)\s*=?\s*(-?\d+(?:\.\d+)?)/i);
  if (under) return { low: null, high: Number(under[1]) };

  const over = value.match(/(?:>|greater than|above|more than)\s*=?\s*(-?\d+(?:\.\d+)?)/i);
  if (over) return { low: Number(over[1]), high: null };

  return { low: null, high: null };
}

/** Pick the gendered/paediatric variant that applies to this patient. */
export function selectVariant(parameter, { sex = "", age = null } = {}) {
  const years = parseLeadingNumber(age);
  if (Number.isFinite(years) && years > 0 && years < 12 && parameter.rangeChild) return parameter.rangeChild;
  const g = String(sex).trim().toLowerCase();
  if (g.startsWith("m") && parameter.rangeMale) return parameter.rangeMale;
  if (g.startsWith("f") && parameter.rangeFemale) return parameter.rangeFemale;
  return parameter.normalRange || parameter.referenceRange || "";
}

/**
 * Resolve the interval to use for one parameter.
 *
 * Precedence: the laboratory's own validated configuration, then whatever the
 * catalogue carries — flagged as unvalidated.
 *
 * @param {object} parameter   catalogue parameter (ranges, bounds)
 * @param {object} labInterval this laboratory's configured interval, if any
 * @param {object} patient     { sex, age }
 */
export function resolveInterval(parameter = {}, labInterval = null, patient = {}) {
  if (labInterval && (labInterval.low != null || labInterval.high != null)) {
    return {
      low: labInterval.low ?? null,
      high: labInterval.high ?? null,
      criticalLow: labInterval.criticalLow ?? null,
      criticalHigh: labInterval.criticalHigh ?? null,
      text: labInterval.text || "",
      source: INTERVAL_SOURCE.LAB_VALIDATED,
      validationStatus: labInterval.validationStatus || VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
      unvalidated: (labInterval.validationStatus || "") !== VALIDATION_STATUS.VALIDATED,
      validatedBy: labInterval.validatedBy || "",
      validatedOn: labInterval.validatedOn || ""
    };
  }

  const text = selectVariant(parameter, patient);
  const parsed = parseIntervalText(text);
  const low = parameter.lowValue ?? parsed.low;
  const high = parameter.highValue ?? parsed.high;

  return {
    low: low ?? null,
    high: high ?? null,
    criticalLow: parameter.criticalLow ?? null,
    criticalHigh: parameter.criticalHigh ?? null,
    text,
    // Inherited from the catalogue. Kept and shown, never called validated.
    source: INTERVAL_SOURCE.INHERITED,
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    unvalidated: true,
    validatedBy: "",
    validatedOn: ""
  };
}

/** Count how many intervals in a report have not been validated. */
export function countUnvalidated(flagged = {}) {
  return Object.values(flagged).filter((x) => x.interval?.unvalidated
    && (x.interval.low != null || x.interval.high != null)).length;
}

export { VALIDATION_STATUS };
