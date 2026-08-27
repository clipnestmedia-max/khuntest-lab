// Reference-range parsing and abnormal-value flagging. NO imports, by design.
//
// This is the most medically consequential logic in the product: it decides
// whether a result prints as High, Low or Critical on a patient's report. It
// is deliberately free of any Firebase dependency so it can be unit-tested
// directly and rendered in a standalone template preview.

export const FLAGS = Object.freeze({
  NORMAL: "", LOW: "Low", HIGH: "High",
  CRITICAL_LOW: "Critical Low", CRITICAL_HIGH: "Critical High"
});

/**
 * Parse "13.2-16.6", "< 200", "Up to 40", "M: 13-16, F: 11-15" into numeric
 * bounds. Returns nulls when the range is descriptive ("Negative", "Nil"),
 * in which case no flag is applied - guessing would be worse than silence.
 */
export function parseRange(rangeText) {
  const text = String(rangeText || "").trim();
  if (!text) return { low: null, high: null };

  const between = text.match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/i);
  if (between) return { low: Number(between[1]), high: Number(between[2]) };

  const lessThan = text.match(/(?:<|less than|upto|up to|below)\s*=?\s*(-?\d+(?:\.\d+)?)/i);
  if (lessThan) return { low: null, high: Number(lessThan[1]) };

  const greaterThan = text.match(/(?:>|greater than|above|more than)\s*=?\s*(-?\d+(?:\.\d+)?)/i);
  if (greaterThan) return { low: Number(greaterThan[1]), high: null };

  return { low: null, high: null };
}

/**
 * Pick the reference range that applies to this patient. Falls back to the
 * generic range so a catalogue that never filled in the gendered fields keeps
 * printing exactly what it printed before.
 */
export function rangeForPatient(parameter, { gender = "", age = null } = {}) {
  const g = String(gender || "").trim().toLowerCase();
  const years = Number(String(age ?? "").replace(/[^\d.]/g, ""));
  if (Number.isFinite(years) && years > 0 && years < 12 && parameter.rangeChild) return parameter.rangeChild;
  if (g.startsWith("m") && parameter.rangeMale) return parameter.rangeMale;
  if (g.startsWith("f") && parameter.rangeFemale) return parameter.rangeFemale;
  return parameter.normalRange || parameter.referenceRange || "";
}

/**
 * The number an entered result actually represents, or null if it does not
 * represent one.
 *
 * Stripping non-digits and calling Number() is not good enough, and the way it
 * fails is dangerous rather than merely wrong. "Negative" strips to the empty
 * string, and Number("") is 0 - not NaN. Zero then sits below the low end of
 * any positive reference interval, so a negative serology result printed as
 * "Low" on the patient's report. "Positive" did the same thing.
 *
 * A result is a number only if it BEGINS with one, after at most a comparator.
 * A titre such as "1:40" is not a scalar and is left alone.
 */
function numericResult(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) return null;          // titre, not a scalar
  // The number must be at the FRONT of the value, after at most a comparator.
  // "130", "130 mg/dL", "<60" and "-1.5" are results. "Sterile after 48h" and
  // "Grade 2" are sentences that happen to contain a digit, and reading 48 or
  // 2 out of them would flag a culture report against a numeric interval.
  const match = text.match(/^(?:[<>≤≥=~]\s*)?(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** Decide High / Low / Critical for one entered value. */
export function flagResult(value, parameter, patient = {}) {
  const numeric = numericResult(value);
  if (numeric === null) return FLAGS.NORMAL;

  const criticalLow = parameter.criticalLow == null ? null : Number(parameter.criticalLow);
  const criticalHigh = parameter.criticalHigh == null ? null : Number(parameter.criticalHigh);
  if (criticalLow != null && numeric < criticalLow) return FLAGS.CRITICAL_LOW;
  if (criticalHigh != null && numeric > criticalHigh) return FLAGS.CRITICAL_HIGH;

  let low = parameter.lowValue == null ? null : Number(parameter.lowValue);
  let high = parameter.highValue == null ? null : Number(parameter.highValue);
  if (low == null && high == null) {
    const parsed = parseRange(rangeForPatient(parameter, patient));
    low = parsed.low; high = parsed.high;
  }
  if (low != null && numeric < low) return FLAGS.LOW;
  if (high != null && numeric > high) return FLAGS.HIGH;
  return FLAGS.NORMAL;
}

export function isAbnormal(flag) { return Boolean(flag && flag !== FLAGS.NORMAL); }
export function isCritical(flag) { return flag === FLAGS.CRITICAL_LOW || flag === FLAGS.CRITICAL_HIGH; }
