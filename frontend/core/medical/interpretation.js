// Abnormal flagging and the interpretation rule engine.
// NO Firebase imports.
//
// SAFETY CONTRACT (product spec §18, §41). Nothing here diagnoses. Every
// generated string is a DRAFT for a pathologist, phrased as an observation
// about the laboratory result, never as a statement about the patient. The
// engine describes the pattern; the clinician interprets the patient.
import { FLAG, COMMENT_LEVEL, VALIDATION_STATUS, REVIEW_STATUS } from "./schema.js";
import { codeName } from "./codes.js";

/**
 * The leading number in an entered result, or null.
 * "12.4" -> 12.4 · "12.4 g/dL" -> 12.4 · "<0.01" -> 0.01 · "Negative" -> null
 */
export function parseLeadingNumber(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  if (text.includes(":")) return null;   // a titre such as 1:40 is not a scalar
  // The number must be at the FRONT of the value, after at most a comparator.
  // "130", "130 mg/dL", "<60" and "-1.5" are results. "Sterile after 48h" and
  // "Grade 2" are sentences that happen to contain a digit, and reading 48 or
  // 2 out of them would flag a culture report against a numeric interval.
  const match = text.match(/^(?:[<>≤≥=~]\s*)?(-?\d+(?:\.\d+)?)/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Evaluate one value against its laboratory-configured interval.
 *
 * `interval` is the LABORATORY's configuration, never a platform default:
 *   { low, high, criticalLow, criticalHigh, validationStatus }
 *
 * A value with no usable interval returns NOT_INTERPRETABLE rather than
 * NORMAL. Silently calling an unassessable result "normal" is the single most
 * dangerous thing a flagging engine can do.
 */
export function flagValue(value, interval = {}) {
  if (value === null || value === undefined || value === "") return FLAG.NOT_INTERPRETABLE;

  // A qualitative result — "Negative", "Nil", "Trace", "Non-reactive" — must
  // never be coerced into a number. Stripping non-digits leaves an empty
  // string, and Number("") is 0, not NaN: that flagged a NEGATIVE serology
  // result as LOW. Require an actual digit sequence.
  const n = typeof value === "number" ? value : parseLeadingNumber(value);
  if (n === null || !Number.isFinite(n)) return FLAG.NOT_INTERPRETABLE;

  const { low, high, criticalLow, criticalHigh } = interval;
  if (criticalLow !== null && criticalLow !== undefined && n < criticalLow) return FLAG.CRITICAL_LOW;
  if (criticalHigh !== null && criticalHigh !== undefined && n > criticalHigh) return FLAG.CRITICAL_HIGH;

  const hasLow = low !== null && low !== undefined;
  const hasHigh = high !== null && high !== undefined;
  if (!hasLow && !hasHigh) return FLAG.NOT_INTERPRETABLE;

  if (hasLow && n < low) return FLAG.LOW;
  if (hasHigh && n > high) return FLAG.HIGH;
  return FLAG.NORMAL;
}

export const isAbnormalFlag = (f) => f === FLAG.LOW || f === FLAG.HIGH
  || f === FLAG.CRITICAL_LOW || f === FLAG.CRITICAL_HIGH || f === FLAG.ABNORMAL;
export const isCriticalFlag = (f) => f === FLAG.CRITICAL_LOW || f === FLAG.CRITICAL_HIGH;

// ---------------------------------------------------------------------------
// Level 1 — single-parameter statements
// ---------------------------------------------------------------------------

/**
 * A plain statement of fact about the result. Deliberately says nothing about
 * cause: 633 of the catalogue's tests are single analytes where this is the
 * correct ceiling.
 */
export function statementFor(name, flag, unvalidatedInterval = false) {
  const caveat = unvalidatedInterval
    ? " The reference interval used has not been validated for this laboratory."
    : "";
  switch (flag) {
    case FLAG.HIGH:
      return `${name} is above the laboratory reference interval.${caveat}`;
    case FLAG.LOW:
      return `${name} is below the laboratory reference interval.${caveat}`;
    case FLAG.CRITICAL_HIGH:
      return `${name} is above the laboratory critical limit. Pathologist review is required before release.`;
    case FLAG.CRITICAL_LOW:
      return `${name} is below the laboratory critical limit. Pathologist review is required before release.`;
    case FLAG.NOT_INTERPRETABLE:
      return `${name} could not be assessed against a reference interval.${caveat}`;
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Level 2 — pattern rules
// ---------------------------------------------------------------------------

/**
 * Each rule reads flagged values and returns a cautious comment, or null.
 * `v` maps code -> { value, flag, interval }.
 *
 * Every comment is phrased "may be consistent with" / "may be seen in", and
 * ends by recommending clinical correlation. That wording is not decoration —
 * it is the difference between decision support and an automated diagnosis.
 */
const f = (v, code) => v[code]?.flag;
const has = (v, ...codes) => codes.every((c) => v[c] && v[c].flag !== FLAG.NOT_INTERPRETABLE);

/** "a, b and c" — for listing the analytes a pattern is built from. */
function joinList(items) {
  const list = items.filter(Boolean);
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export const PATTERN_RULES = [
  // ---- Thyroid ----
  {
    id: "PATTERN.THYROID", panel: "Thyroid", version: 1,
    name: "Thyroid function pattern",
    describes: "TSH read together with FT4: primary or subclinical hypothyroidism, thyrotoxicosis, or a discordant pattern needing repeat testing.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["TSH", "FT4"],
    evaluate(v) {
      if (!has(v, "TSH", "FT4")) return null;
      const tsh = f(v, "TSH");
      const ft4 = f(v, "FT4");
      if (tsh === FLAG.HIGH && ft4 === FLAG.LOW) {
        return { level: COMMENT_LEVEL.PATTERN, text:
          "The TSH and FT4 pattern may be consistent with primary hypothyroidism. "
          + "Clinical correlation and, if indicated, repeat testing are recommended." };
      }
      if (tsh === FLAG.HIGH && ft4 === FLAG.NORMAL) {
        return { level: COMMENT_LEVEL.PATTERN, text:
          "Raised TSH with a normal FT4 may be seen in subclinical hypothyroidism. "
          + "Correlation with clinical findings and thyroid antibody status may be appropriate." };
      }
      if (tsh === FLAG.LOW && ft4 === FLAG.HIGH) {
        return { level: COMMENT_LEVEL.PATTERN, text:
          "The TSH and FT4 pattern may be consistent with thyrotoxicosis. Clinical correlation is recommended." };
      }
      if (tsh === FLAG.LOW && ft4 === FLAG.NORMAL) {
        return { level: COMMENT_LEVEL.PATTERN, text:
          "Suppressed TSH with a normal FT4 may be seen in subclinical hyperthyroidism, non-thyroidal "
          + "illness, or with certain medications. Clinical correlation is recommended." };
      }
      if (tsh === FLAG.NORMAL && (ft4 === FLAG.HIGH || ft4 === FLAG.LOW)) {
        return { level: COMMENT_LEVEL.REVIEW, text:
          "The TSH and FT4 results are discordant. Assay interference, pituitary causes and non-thyroidal "
          + "illness may be considered. Pathologist review is recommended." };
      }
      return null;
    }
  },

  // ---- Liver ----
  {
    id: "PATTERN.LIVER_ENZYMES", panel: "Liver", version: 1,
    name: "Liver enzyme pattern (R ratio)",
    describes: "ALT and ALP compared as a ratio to describe a hepatocellular, cholestatic or mixed picture.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["ALT", "ALP"],
    evaluate(v, ctx) {
      if (!has(v, "ALT", "ALP")) return null;
      const altHigh = f(v, "ALT") === FLAG.HIGH || f(v, "AST") === FLAG.HIGH;
      const alpHigh = f(v, "ALP") === FLAG.HIGH;
      if (!altHigh && !alpHigh) return null;

      // R-ratio needs THIS laboratory's upper limits, not generic ones.
      const altULN = v.ALT?.interval?.high;
      const alpULN = v.ALP?.interval?.high;
      const canR = altULN > 0 && alpULN > 0 && v.ALT?.value > 0 && v.ALP?.value > 0;
      const r = canR ? (v.ALT.value / altULN) / (v.ALP.value / alpULN) : null;

      if (r !== null) {
        if (r > 5) return { level: COMMENT_LEVEL.PATTERN, text:
          "A predominantly hepatocellular pattern of enzyme elevation is observed (R ≈ " + r.toFixed(1) + "). "
          + "Correlation with clinical history, medication and alcohol history may be appropriate." };
        if (r < 2) return { level: COMMENT_LEVEL.PATTERN, text:
          "A predominantly cholestatic pattern of enzyme elevation is observed (R ≈ " + r.toFixed(1) + "). "
          + "Correlation with clinical findings and imaging may be appropriate." };
        return { level: COMMENT_LEVEL.PATTERN, text:
          "A mixed pattern of enzyme elevation is observed (R ≈ " + r.toFixed(1) + "). "
          + "Clinical correlation is recommended." };
      }
      if (altHigh && !alpHigh) return { level: COMMENT_LEVEL.PATTERN, text:
        "Transaminase elevation is observed with a normal alkaline phosphatase. An isolated elevation may "
        + "occur in a variety of hepatic and non-hepatic conditions. Correlation with clinical history and "
        + "medication history may be appropriate." };
      if (alpHigh && !altHigh) return { level: COMMENT_LEVEL.PATTERN, text:
        "Alkaline phosphatase is elevated with normal transaminases. Hepatic and bone sources may be "
        + "considered; a GGT may help distinguish them. Clinical correlation is recommended." };
      return null;
    }
  },
  {
    id: "PATTERN.UNCONJUGATED_BILIRUBIN", panel: "Liver", version: 1,
    name: "Predominantly unconjugated bilirubin",
    describes: "Raised total bilirubin that is largely indirect, with normal enzymes.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["INDIRECT_BILIRUBIN", "ALT"],
    evaluate(v) {
      if (!has(v, "INDIRECT_BILIRUBIN")) return null;
      const indirectHigh = f(v, "INDIRECT_BILIRUBIN") === FLAG.HIGH
        || (v.TOTAL_BILIRUBIN?.flag === FLAG.HIGH && v.DIRECT_BILIRUBIN?.flag === FLAG.NORMAL);
      const enzymesNormal = f(v, "ALT") === FLAG.NORMAL && (f(v, "AST") ?? FLAG.NORMAL) === FLAG.NORMAL;
      if (!indirectHigh || !enzymesNormal) return null;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "Predominantly unconjugated hyperbilirubinaemia with normal transaminases is observed. This pattern "
        + "may be seen in Gilbert's syndrome and in haemolysis. Correlation with reticulocyte count and "
        + "clinical findings may be appropriate." };
    }
  },
  {
    id: "PATTERN.LOW_ALBUMIN", panel: "Liver", version: 1,
    name: "Reduced albumin",
    describes: "Low albumin, noting the several unrelated states it accompanies.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["ALBUMIN", "AG_RATIO"],
    evaluate(v) {
      if (f(v, "ALBUMIN") !== FLAG.LOW) return null;
      const agLow = f(v, "AG_RATIO") === FLAG.LOW;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "Albumin is reduced" + (agLow ? " with a reversed A/G ratio" : "") + ". This may be seen in chronic "
        + "liver disease, protein loss, malnutrition and chronic inflammation. Clinical correlation is recommended." };
    }
  },

  // ---- Haematology ----
  {
    id: "PATTERN.ANAEMIA", panel: "Haematology", version: 1,
    name: "Anaemia with red cell indices",
    describes: "Haemoglobin read with MCV to describe a microcytic, macrocytic or normocytic picture.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["HAEMOGLOBIN", "MCV"],
    evaluate(v) {
      if (f(v, "HAEMOGLOBIN") !== FLAG.LOW && f(v, "HAEMOGLOBIN") !== FLAG.CRITICAL_LOW) return null;
      const mcv = f(v, "MCV");
      const rdwHigh = f(v, "RDW") === FLAG.HIGH;
      if (mcv === FLAG.LOW) return { level: COMMENT_LEVEL.PATTERN, text:
        "A microcytic anaemia pattern is observed" + (rdwHigh ? " with increased red cell distribution width" : "")
        + ". Iron studies may be considered if clinically indicated; haemoglobinopathy screening may also be "
        + "relevant depending on the clinical context. Correlation with clinical findings is recommended." };
      if (mcv === FLAG.HIGH) return { level: COMMENT_LEVEL.PATTERN, text:
        "A macrocytic anaemia pattern is observed. Vitamin B12 and folate assessment may be considered if "
        + "clinically indicated. Correlation with clinical findings is recommended." };
      if (mcv === FLAG.NORMAL) return { level: COMMENT_LEVEL.PATTERN, text:
        "A normocytic anaemia pattern is observed. Correlation with clinical findings, reticulocyte count and "
        + "renal and inflammatory status may be appropriate." };
      return null;
    }
  },
  {
    id: "PATTERN.LEUCOCYTOSIS", panel: "Haematology", version: 1,
    name: "Raised white cell count",
    describes: "Leucocytosis with the predominant cell line noted.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["WBC"],
    evaluate(v) {
      if (f(v, "WBC") !== FLAG.HIGH) return null;
      const neutHigh = f(v, "NEUTROPHILS_PCT") === FLAG.HIGH;
      const lymphHigh = f(v, "LYMPHOCYTES_PCT") === FLAG.HIGH;
      if (neutHigh) return { level: COMMENT_LEVEL.PATTERN, text:
        "Leucocytosis with neutrophilia is observed. This pattern may be seen in infection, inflammation, "
        + "physiological stress and with corticosteroid therapy. Clinical correlation is recommended." };
      if (lymphHigh) return { level: COMMENT_LEVEL.PATTERN, text:
        "Leucocytosis with lymphocytosis is observed. This pattern may be seen in viral infection and in "
        + "certain lymphoproliferative conditions. Clinical correlation and smear review are recommended." };
      return { level: COMMENT_LEVEL.STATEMENT, text:
        "Leucocytosis is observed. Clinical correlation is recommended." };
    }
  },
  {
    id: "PATTERN.EOSINOPHILIA", panel: "Haematology", version: 1,
    name: "Eosinophilia",
    describes: "Raised eosinophil count.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["EOSINOPHILS_PCT"],
    evaluate(v) {
      if (f(v, "EOSINOPHILS_PCT") !== FLAG.HIGH) return null;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "Eosinophilia is observed. This may be seen with parasitic infestation, allergic conditions and drug "
        + "reactions. Clinical correlation is recommended." };
    }
  },
  {
    id: "PATTERN.THROMBOCYTOPENIA", panel: "Haematology", version: 1,
    name: "Reduced platelet count",
    describes: "Low platelets, including the note on platelet clumping that a smear review would settle.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["PLATELETS"],
    evaluate(v) {
      const flag = f(v, "PLATELETS");
      if (flag !== FLAG.LOW && flag !== FLAG.CRITICAL_LOW) return null;
      // Platelet clumping is a common pre-analytical artefact; a smear must be
      // reviewed before this number leaves the laboratory.
      return { level: COMMENT_LEVEL.REVIEW, text:
        "Thrombocytopenia is observed. Platelet clumping and sample quality should be excluded and a "
        + "peripheral smear review is recommended before the report is released." };
    }
  },

  // ---- Renal ----
  {
    id: "PATTERN.REDUCED_EGFR", panel: "Renal", version: 1,
    name: "Reduced eGFR",
    describes: "Estimated GFR below the reporting threshold, with the repeat-over-90-days caveat.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["EGFR"],
    evaluate(v) {
      const egfr = v.EGFR?.value;
      if (!(egfr > 0) || egfr >= 60) return null;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "The calculated eGFR is below 60 mL/min/1.73 m². A single reduced eGFR does not establish chronic "
        + "kidney disease; assessment of persistence over at least three months, together with clinical "
        + "correlation, is recommended." };
    }
  },
  {
    id: "PATTERN.UREA_CREATININE", panel: "Renal", version: 1,
    name: "Urea and creatinine together",
    describes: "The ratio between them, which may point away from an intrinsic renal cause.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["BUN_CREAT_RATIO"],
    evaluate(v) {
      const ratio = v.BUN_CREAT_RATIO?.value;
      if (!(ratio > 20)) return null;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "The urea-to-creatinine relationship is raised. This pattern may be seen in pre-renal states, "
        + "gastrointestinal bleeding and high protein intake. Clinical correlation including volume status "
        + "is recommended." };
    }
  },

  // ---- Lipid ----
  {
    id: "PATTERN.NON_HDL", panel: "Lipid", version: 1,
    name: "Raised non-HDL cholesterol",
    describes: "Non-HDL cholesterol above the reference limit.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["NON_HDL"],
    evaluate(v) {
      if (f(v, "NON_HDL") !== FLAG.HIGH) return null;
      return { level: COMMENT_LEVEL.PATTERN, text:
        "Non-HDL cholesterol is above the laboratory's stated target. Non-HDL cholesterol is recommended as "
        + "a co-primary target in Indian patients. Risk assessment and clinical correlation by the treating "
        + "clinician are recommended." };
    }
  },
  {
    id: "PATTERN.DYSLIPIDAEMIA", panel: "Lipid", version: 1,
    name: "Combined lipid pattern",
    describes: "Total cholesterol, LDL, triglycerides, HDL and non-HDL read together rather than line by line.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["HDL"],
    evaluate(v) {
      const high = (c) => f(v, c) === FLAG.HIGH;
      const raised = [
        high("TOTAL_CHOLESTEROL") && "total cholesterol",
        (high("LDL_DIRECT") || high("LDL_CALCULATED")) && "LDL cholesterol",
        high("TRIGLYCERIDES") && "triglycerides",
        high("NON_HDL") && "non-HDL cholesterol"
      ].filter(Boolean);
      const hdlLow = f(v, "HDL") === FLAG.LOW;
      if (raised.length < 2 && !(raised.length >= 1 && hdlLow)) return null;
      const parts = raised.slice();
      if (hdlLow) parts.push("a low HDL cholesterol");
      return { level: COMMENT_LEVEL.PATTERN, text:
        "A combined lipid pattern is observed (" + joinList(parts) + "). Non-HDL cholesterol is recommended "
        + "as a co-primary target in Indian patients. Overall cardiovascular risk assessment and management "
        + "decisions rest with the treating clinician." };
    }
  },
  {
    id: "PATTERN.HIGH_TG_LDL_WITHHELD", panel: "Lipid", version: 1,
    name: "LDL withheld at high triglycerides",
    describes: "States plainly why no calculated LDL appears when triglycerides exceed the method's limit.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["TRIGLYCERIDES"],
    evaluate(v, ctx) {
      if (!(v.TRIGLYCERIDES?.value > 400)) return null;
      if (ctx?.skippedCodes?.includes("LDL_CALCULATED") !== true) return null;
      return { level: COMMENT_LEVEL.STATEMENT, text:
        "Triglycerides exceed the range in which the Friedewald calculation is valid. Calculated LDL "
        + "cholesterol has therefore been withheld; a directly measured LDL cholesterol is recommended." };
    }
  },

  // ---- Iron ----
  {
    id: "PATTERN.IRON", panel: "Iron", version: 1,
    name: "Iron studies pattern",
    describes: "Ferritin with transferrin saturation.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["FERRITIN"],
    evaluate(v) {
      const ferritin = f(v, "FERRITIN");
      const tsat = f(v, "TRANSFERRIN_SAT");
      if (ferritin === FLAG.LOW) return { level: COMMENT_LEVEL.PATTERN, text:
        "The pattern may be consistent with iron deficiency. Note that ferritin is an acute-phase reactant "
        + "and may be raised by concurrent inflammation, which can mask deficiency. Clinical correlation is "
        + "recommended." };
      if ((ferritin === FLAG.NORMAL || ferritin === FLAG.HIGH) && tsat === FLAG.LOW) {
        return { level: COMMENT_LEVEL.PATTERN, text:
          "Reduced transferrin saturation with a normal or raised ferritin may be seen in anaemia of chronic "
          + "disease or inflammation. Correlation with inflammatory markers and clinical findings is recommended." };
      }
      return null;
    }
  },

  // ---- Cardiac ----
  {
    id: "PATTERN.CARDIAC_MARKERS", panel: "Cardiac", version: 1,
    name: "Cardiac marker caution",
    describes: "A raised CK-MB or CK-MB index, with the note that neither it nor troponin diagnoses infarction on its own.",
    validationStatus: VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION,
    requires: ["CK_MB_INDEX"],
    evaluate(v) {
      const idxHigh = f(v, "CK_MB_INDEX") === FLAG.HIGH;
      const ckmbHigh = f(v, "CK_MB") === FLAG.HIGH;
      if (!idxHigh && !ckmbHigh) return null;
      return { level: COMMENT_LEVEL.STATEMENT, text:
        "CK-MB" + (idxHigh ? " and the CK-MB relative index are" : " is") + " above the reference interval. "
        + "This finding does not, by itself or together with a single troponin, establish or exclude "
        + "myocardial infarction. Correlation with the clinical presentation, the ECG and serial troponin "
        + "measurements is recommended." };
    }
  }
];

/**
 * Run the pattern rules.
 *
 * @param {object} flagged   code -> { value, flag, interval }
 * @param {object} context   { age, sex, skippedCodes[] }
 * @param {object} labConfig per-rule enable/disable
 * @returns {Array<{ruleId, ruleVersion, panel, level, text}>}
 */
export function runPatterns(flagged, context = {}, labConfig = {}) {
  const comments = [];
  PATTERN_RULES.forEach((rule) => {
    const override = labConfig[rule.id];
    if (override?.enabled === false) return;
    let outcome = null;
    try {
      outcome = rule.evaluate(flagged, context);
    } catch (error) {
      console.warn(`pattern rule ${rule.id} failed`, error?.message);
      return;
    }
    if (!outcome?.text) return;
    comments.push({
      ruleId: rule.id, ruleVersion: rule.version, panel: rule.panel,
      level: outcome.level, text: outcome.text
    });
  });
  return comments;
}

/**
 * Assemble the full draft interpretation for a report.
 *
 * Deliberately restrained (§32): a normal report gets ONE line, not an essay.
 * The highest comment level present decides whether the report can be released
 * without a pathologist looking at it.
 */
export function buildDraftInterpretation({ flagged = {}, patterns = [], unvalidatedIntervals = 0 } = {}) {
  const abnormal = Object.values(flagged).filter((x) => isAbnormalFlag(x.flag));
  const critical = Object.values(flagged).filter((x) => isCriticalFlag(x.flag));

  const lines = [];
  let level = COMMENT_LEVEL.NONE;

  if (critical.length) {
    level = COMMENT_LEVEL.REVIEW;
    lines.push(
      "CRITICAL VALUE — immediate laboratory review required: "
      + critical.map((x) => codeName(x.code)).join(", ") + "."
    );
  }

  // Patterns first: they say more than a list of individual flags.
  patterns.forEach((p) => {
    lines.push(p.text);
    if (p.level > level) level = p.level;
  });

  if (!patterns.length && !critical.length) {
    if (!abnormal.length) {
      const assessed = Object.values(flagged).filter((x) => x.flag !== FLAG.NOT_INTERPRETABLE);
      if (assessed.length) {
        lines.push("Results are within the laboratory reference interval.");
        level = Math.max(level, COMMENT_LEVEL.STATEMENT);
      }
    } else {
      abnormal.forEach((x) => {
        const text = statementFor(codeName(x.code), x.flag, x.interval?.unvalidated);
        if (text) lines.push(text);
      });
      level = Math.max(level, COMMENT_LEVEL.STATEMENT);
    }
  }

  // Unvalidated intervals are DISCLOSED, not held.
  //
  // This deliberately does not raise the level to REVIEW. Every laboratory
  // starts with every interval inherited, so holding on this would stop a
  // laboratory releasing any report at all from the day the engine is
  // switched on - and the only workable response to that is to switch the
  // engine off, which leaves patients worse off than a printed disclosure
  // does. The note goes on the report and the laboratory is prompted to
  // validate its intervals. A clinical hold is reserved for a clinical
  // reason: a critical value, or a pattern that must be seen before the
  // number leaves the laboratory.
  if (unvalidatedIntervals > 0) {
    lines.push(
      `Note: ${unvalidatedIntervals} reference interval(s) used in this report have not been validated for `
      + "this laboratory and are marked REQUIRES MEDICAL VALIDATION. Pathologist review is recommended."
    );
  }

  if (lines.length) {
    lines.push("Interpretation should be performed by the treating clinician or pathologist.");
  }

  return {
    level,
    text: lines.join("\n\n"),
    reviewStatus: level >= COMMENT_LEVEL.REVIEW ? REVIEW_STATUS.REVIEW_REQUIRED : REVIEW_STATUS.DRAFT,
    // A clinical hold: nothing leaves until a pathologist has seen it.
    holdsRelease: level >= COMMENT_LEVEL.REVIEW,
    // Worth a pathologist's eye, but not a reason to stop the laboratory.
    recommendsReview: level >= COMMENT_LEVEL.REVIEW || unvalidatedIntervals > 0,
    unvalidatedIntervals,
    sourceRules: patterns.map((p) => ({ id: p.ruleId, version: p.ruleVersion }))
  };
}
