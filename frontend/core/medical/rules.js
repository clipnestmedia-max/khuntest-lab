// The medical rule registry — Swati Softtech's controlled knowledge base.
//
// GOVERNANCE (product decision 7). A laboratory may configure intervals,
// critical values and which optional rules are enabled. A laboratory may NOT
// edit a formula. Only Swati Softtech versions a formula, and only a named,
// authorised pathologist may move a rule to VALIDATED.
//
// Every rule below ships as REQUIRES_MEDICAL_VALIDATION. That is deliberate and
// is not pessimism about the arithmetic: the formulas here are verified to
// authoritative sources and cited. It reflects that NO ONE HAS SIGNED THEM OFF
// FOR A PARTICULAR LABORATORY YET. Software cannot validate itself. A rule
// becomes VALIDATED when that laboratory's pathologist reviews and approves it,
// which the admin screen records with their name and the date.
//
// VERSIONING (§35). A formula is never edited in place. A changed formula is a
// new version with `supersedes` pointing at the old one, and the old one is
// RETIRED rather than deleted — so a report issued two years ago still
// reproduces exactly what the patient was handed.
import { RULE_TYPE, VALIDATION_STATUS, VALUE_ORIGIN, SKIP_REASON } from "./schema.js";

const REQUIRES = VALIDATION_STATUS.REQUIRES_MEDICAL_VALIDATION;

/** Shorthand for a source record. reviewedBy stays empty until a human signs. */
const src = (title, url, type = "peer-reviewed", year = null) =>
  ({ title, url, type, year, reviewedBy: "", reviewedOn: "" });

// ---------------------------------------------------------------------------
// LIVER
// ---------------------------------------------------------------------------

export const LIVER_RULES = [
  {
    id: "CALC.INDIRECT_BILIRUBIN", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Indirect Bilirubin", panel: "Liver",
    outputCode: "INDIRECT_BILIRUBIN", outputUnit: "mg/dL", precision: 2,
    inputs: [
      { code: "TOTAL_BILIRUBIN", unit: "mg/dL" },
      { code: "DIRECT_BILIRUBIN", unit: "mg/dL" }
    ],
    formulaText: "Total Bilirubin − Direct Bilirubin",
    compute: (v) => v.TOTAL_BILIRUBIN - v.DIRECT_BILIRUBIN,
    // Analytical imprecision can make this slightly negative when both are low.
    // A negative bilirubin on a report is nonsense, so clamp and note it rather
    // than print it.
    postCheck: (result) => (result < 0
      ? { value: 0, note: "Calculated value was below zero from analytical imprecision; reported as 0.00." }
      : { value: result }),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic; total = direct + indirect", "", "textbook"),
    limitations: "Both bilirubins must be measured on the same sample and reported in the same unit."
  },
  {
    id: "CALC.GLOBULIN", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Globulin", panel: "Liver",
    outputCode: "GLOBULIN", outputUnit: "g/dL", precision: 2,
    inputs: [{ code: "TOTAL_PROTEIN", unit: "g/dL" }, { code: "ALBUMIN", unit: "g/dL" }],
    formulaText: "Total Protein − Albumin",
    compute: (v) => v.TOTAL_PROTEIN - v.ALBUMIN,
    postCheck: (result) => (result <= 0
      ? { skip: "Not calculated — albumin is not less than total protein; check both results." }
      : { value: result }),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Both must be in g/dL from the same sample."
  },
  {
    id: "CALC.AG_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "A/G Ratio", panel: "Liver",
    outputCode: "AG_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "ALBUMIN", unit: "g/dL" }, { code: "GLOBULIN", unit: "g/dL" }],
    formulaText: "Albumin ÷ Globulin",
    compute: (v) => v.ALBUMIN / v.GLOBULIN,
    guard: (v) => (v.GLOBULIN > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Depends on calculated globulin, so inherits its conditions.",
    dependsOn: ["CALC.GLOBULIN"]
  },
  {
    id: "CALC.AST_ALT_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "AST / ALT Ratio (De Ritis)", panel: "Liver",
    outputCode: "AST_ALT_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "AST", unit: "U/L" }, { code: "ALT", unit: "U/L" }],
    formulaText: "AST ÷ ALT",
    compute: (v) => v.AST / v.ALT,
    guard: (v) => (v.ALT > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES,
    defaultEnabled: false,   // opt-in: meaningless in isolation
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("De Ritis ratio; established in hepatology literature", "", "peer-reviewed"),
    limitations: "Must never be interpreted alone. Reported as a number; meaning is for the pathologist."
  }
];

// ---------------------------------------------------------------------------
// LIPID
// ---------------------------------------------------------------------------

/**
 * Friedewald is invalid above 400 mg/dL triglycerides and degrades well below
 * that. The product decision is explicit: do not calculate when the conditions
 * are not satisfied, and say so.
 */
export const FRIEDEWALD_TG_LIMIT = 400;

export const LIPID_RULES = [
  {
    id: "CALC.NON_HDL", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Non-HDL Cholesterol", panel: "Lipid",
    outputCode: "NON_HDL", outputUnit: "mg/dL", precision: 0,
    inputs: [{ code: "TOTAL_CHOLESTEROL", unit: "mg/dL" }, { code: "HDL", unit: "mg/dL" }],
    formulaText: "Total Cholesterol − HDL Cholesterol",
    compute: (v) => v.TOTAL_CHOLESTEROL - v.HDL,
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src(
      "Lipid Association of India 2023 consensus statement IV — non-HDL-C as a co-primary target",
      "https://www.lipidjournal.com/article/S1933-2874(24)00006-0/fulltext", "guideline", 2024),
    limitations: "Always calculable. Requires no fasting assumption, unlike Friedewald LDL."
  },
  {
    id: "CALC.LDL_FRIEDEWALD", version: 1, type: RULE_TYPE.CALCULATION,
    name: "LDL Cholesterol (Friedewald)", panel: "Lipid",
    outputCode: "LDL_CALCULATED", outputUnit: "mg/dL", precision: 0,
    inputs: [
      { code: "TOTAL_CHOLESTEROL", unit: "mg/dL" },
      { code: "HDL", unit: "mg/dL" },
      { code: "TRIGLYCERIDES", unit: "mg/dL" }
    ],
    formulaText: "Total Cholesterol − HDL − (Triglycerides ÷ 5)",
    compute: (v) => v.TOTAL_CHOLESTEROL - v.HDL - (v.TRIGLYCERIDES / 5),
    guard: (v) => (v.TRIGLYCERIDES > FRIEDEWALD_TG_LIMIT
      ? "LDL-C not calculated by Friedewald method — direct/alternative validated method required."
      : null),
    // A directly measured LDL is never overwritten by a calculated one.
    supersededByMeasured: "LDL_DIRECT",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Friedewald equation; limitations reviewed in current lipid literature",
      "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11433184/", "peer-reviewed", 2024),
    limitations:
      "Invalid above " + FRIEDEWALD_TG_LIMIT + " mg/dL triglycerides. Accuracy degrades at TG ≥ 150 mg/dL "
      + "and at LDL < 70 mg/dL. Requires a fasting sample and mg/dL units."
  },
  {
    id: "CALC.LDL_MARTIN_HOPKINS", version: 1, type: RULE_TYPE.CALCULATION,
    name: "LDL Cholesterol (Martin-Hopkins)", panel: "Lipid",
    outputCode: "LDL_CALCULATED", outputUnit: "mg/dL", precision: 0,
    inputs: [
      { code: "TOTAL_CHOLESTEROL", unit: "mg/dL" },
      { code: "HDL", unit: "mg/dL" },
      { code: "TRIGLYCERIDES", unit: "mg/dL" }
    ],
    formulaText: "Total Cholesterol − HDL − (Triglycerides ÷ adjustable factor)",
    // Deliberately not implemented. The adjustable factor is a 180-cell table
    // that must be entered from the source publication. Approximating it would
    // put a wrong LDL on a patient's report, so this refuses to run.
    compute: () => { throw new Error("Martin-Hopkins factor table not loaded."); },
    guard: () => "LDL-C not calculated — the Martin-Hopkins factor table requires medical validation before use.",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Martin-Hopkins equation; 180-cell adjustable factor table required from source",
      "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8554644/", "peer-reviewed", 2021),
    limitations:
      "NOT IMPLEMENTED. The adjustable TG:VLDL factor table must be entered verbatim from the source "
      + "publication and validated. It must not be approximated."
  },
  {
    id: "CALC.VLDL", version: 1, type: RULE_TYPE.CALCULATION,
    name: "VLDL Cholesterol", panel: "Lipid",
    outputCode: "VLDL", outputUnit: "mg/dL", precision: 0,
    inputs: [{ code: "TRIGLYCERIDES", unit: "mg/dL" }],
    formulaText: "Triglycerides ÷ 5",
    compute: (v) => v.TRIGLYCERIDES / 5,
    guard: (v) => (v.TRIGLYCERIDES > FRIEDEWALD_TG_LIMIT
      ? "Not calculated — the triglyceride level is outside the range in which this estimate is valid."
      : null),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("VLDL term of the Friedewald equation", "", "textbook"),
    limitations:
      "This is Friedewald's internal VLDL term, not a general-purpose VLDL measurement. "
      + "Only meaningful under the same assumptions, and only when LDL is not measured directly."
  },
  {
    id: "CALC.TC_HDL_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "TC / HDL Ratio", panel: "Lipid",
    outputCode: "TC_HDL_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "TOTAL_CHOLESTEROL", unit: "mg/dL" }, { code: "HDL", unit: "mg/dL" }],
    formulaText: "Total Cholesterol ÷ HDL",
    compute: (v) => v.TOTAL_CHOLESTEROL / v.HDL,
    guard: (v) => (v.HDL > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "A ratio, not a risk score. Interpretation is for the treating clinician."
  },
  {
    id: "CALC.TG_HDL_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "TG / HDL Ratio", panel: "Lipid",
    outputCode: "TG_HDL_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "TRIGLYCERIDES", unit: "mg/dL" }, { code: "HDL", unit: "mg/dL" }],
    formulaText: "Triglycerides ÷ HDL",
    compute: (v) => v.TRIGLYCERIDES / v.HDL,
    guard: (v) => (v.HDL > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Proposed cut-offs vary by population. Reported as a number only."
  },
  {
    id: "CALC.LDL_HDL_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "LDL / HDL Ratio", panel: "Lipid",
    outputCode: "LDL_HDL_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "LDL_DIRECT", unit: "mg/dL" }, { code: "HDL", unit: "mg/dL" }],
    formulaText: "LDL Cholesterol ÷ HDL Cholesterol",
    compute: (v) => v.LDL_DIRECT / v.HDL,
    guard: (v) => (v.HDL > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations:
      "Uses a directly measured LDL. Where LDL is calculated (Friedewald), the ratio is produced from that "
      + "value by CALC.LDL_HDL_RATIO_CALC instead, and only when the calculated LDL is itself valid."
  },
  {
    id: "CALC.LDL_HDL_RATIO_CALC", version: 1, type: RULE_TYPE.CALCULATION,
    name: "LDL / HDL Ratio (from calculated LDL)", panel: "Lipid",
    outputCode: "LDL_HDL_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "LDL_CALCULATED", unit: "mg/dL" }, { code: "HDL", unit: "mg/dL" }],
    formulaText: "Calculated LDL Cholesterol ÷ HDL Cholesterol",
    compute: (v) => v.LDL_CALCULATED / v.HDL,
    guard: (v) => (v.HDL > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    // A measured direct LDL, when present, produces the ratio via the rule
    // above; this variant must not also fire.
    supersededByMeasured: "LDL_DIRECT",
    dependsOn: ["CALC.LDL_FRIEDEWALD"],
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations:
      "Only produced when a calculated LDL is available and valid — i.e. not when triglycerides exceed the "
      + "Friedewald limit. Interpretation is for the treating clinician."
  }
];

// ---------------------------------------------------------------------------
// RENAL
// ---------------------------------------------------------------------------

export const RENAL_RULES = [
  {
    id: "CALC.BUN_FROM_UREA", version: 1, type: RULE_TYPE.CALCULATION,
    name: "BUN (calculated from Urea)", panel: "Renal",
    outputCode: "BUN", outputUnit: "mg/dL", precision: 0,
    inputs: [{ code: "UREA", unit: "mg/dL" }],
    formulaText: "Urea ÷ 2.14",
    compute: (v) => v.UREA / 2.14,
    // Product decision 2: BUN is MEASURED by default. Many Indian laboratories
    // measure and report both urea and BUN with separate intervals, so deriving
    // it blindly would republish a measured value as calculated. A measured BUN
    // is never overwritten.
    supersededByMeasured: "BUN",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Molecular conversion: urea nitrogen is 28/60 of urea by mass", "", "textbook"),
    limitations:
      "OFF by default. Enable only where the laboratory measures urea and derives BUN. "
      + "Where BUN is measured, the measured value always stands."
  },
  {
    id: "CALC.BUN_CREAT_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "BUN / Creatinine Ratio", panel: "Renal",
    outputCode: "BUN_CREAT_RATIO", outputUnit: "Ratio", precision: 1,
    inputs: [{ code: "BUN", unit: "mg/dL" }, { code: "CREATININE", unit: "mg/dL" }],
    formulaText: "BUN ÷ Creatinine",
    compute: (v) => v.BUN / v.CREATININE,
    guard: (v) => (v.CREATININE > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Both inputs must be mg/dL. Meaningless if BUN and creatinine are in different units."
  },
  {
    id: "CALC.EGFR_CKD_EPI_2021", version: 1, type: RULE_TYPE.CALCULATION,
    name: "eGFR (CKD-EPI 2021, race-free)", panel: "Renal",
    outputCode: "EGFR", outputUnit: "mL/min/1.73m²", precision: 0,
    inputs: [{ code: "CREATININE", unit: "mg/dL" }],
    requires: { age: true, sex: true },
    formulaText:
      "142 × min(Scr/κ,1)^α × max(Scr/κ,1)^−1.200 × 0.9938^Age × 1.012 [if female]; "
      + "κ = 0.7 (F) / 0.9 (M), α = −0.241 (F) / −0.302 (M)",
    compute: (v, ctx) => {
      const female = String(ctx.sex || "").toLowerCase().startsWith("f");
      const kappa = female ? 0.7 : 0.9;
      const alpha = female ? -0.241 : -0.302;
      const scr = v.CREATININE;
      const ratio = scr / kappa;
      return 142
        * Math.pow(Math.min(ratio, 1), alpha)
        * Math.pow(Math.max(ratio, 1), -1.200)
        * Math.pow(0.9938, ctx.age)
        * (female ? 1.012 : 1);
    },
    // The equation is validated in adults only.
    guard: (v, ctx) => (ctx.age >= 18
      ? null
      : "Not calculated — the CKD-EPI 2021 equation is validated for adults 18 years and older."),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src(
      "NKF Laboratory Engagement Working Group recommendations for implementing CKD-EPI 2021, Clinical Chemistry",
      "https://academic.oup.com/clinchem/article/68/4/511/6463626", "guideline", 2022),
    limitations:
      "Adults ≥18 only. Creatinine must be mg/dL and IDMS-traceable. Report as a whole number across the "
      + "whole range, not '>60'. Race-free — obsolete race-based equations must not be used. Not validated "
      + "in pregnancy, acute kidney injury, or extremes of muscle mass. Performance in Indian populations "
      + "REQUIRES MEDICAL VALIDATION. The equation name and version must appear on the report.",
    reportNote: "Calculated by CKD-EPI 2021 (race-free)."
  },
  {
    id: "CALC.ANION_GAP", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Anion Gap", panel: "Electrolytes",
    outputCode: "ANION_GAP", outputUnit: "mEq/L", precision: 0,
    inputs: [
      { code: "SODIUM", unit: "mEq/L" },
      { code: "CHLORIDE", unit: "mEq/L" },
      { code: "BICARBONATE", unit: "mEq/L" }
    ],
    formulaText: "Sodium − (Chloride + Bicarbonate)",
    compute: (v) => v.SODIUM - (v.CHLORIDE + v.BICARBONATE),
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations:
      "Requires bicarbonate, which the current renal panel does not include. Whether potassium is "
      + "included, and whether an albumin correction is applied, must be a per-laboratory setting."
  },
  {
    id: "CALC.CORRECTED_CALCIUM", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Corrected Calcium (Payne)", panel: "Electrolytes",
    outputCode: "CORRECTED_CALCIUM", outputUnit: "mg/dL", precision: 2,
    inputs: [{ code: "CALCIUM", unit: "mg/dL" }, { code: "ALBUMIN", unit: "g/dL" }],
    formulaText: "Calcium + 0.8 × (4.0 − Albumin)",
    compute: (v) => v.CALCIUM + 0.8 * (4.0 - v.ALBUMIN),
    // Product decision 4: DISABLED by default. The rule exists so a laboratory
    // can enable it deliberately, with its limitation printed.
    validationStatus: VALIDATION_STATUS.DISABLED, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    neverReplaces: "CALCIUM",
    source: src("Payne 1973; performance criticised in subsequent literature",
      "https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0354233", "peer-reviewed", 2024),
    limitations:
      "CONTESTED. Derived on a bromocresol-green albumin method and never validated against ionised "
      + "calcium; shown to classify calcium status worse than uncorrected total calcium. Measured calcium "
      + "always remains the primary reported value. Ionised calcium is preferable where available.",
    reportNote: "Calculated (Payne). Measured calcium remains the primary result."
  }
];

// ---------------------------------------------------------------------------
// HAEMATOLOGY
// ---------------------------------------------------------------------------

const absoluteCount = (code, pctCode, name) => ({
  id: `CALC.${code}`, version: 1, type: RULE_TYPE.CALCULATION,
  name, panel: "Haematology",
  outputCode: code, outputUnit: "/cmm", precision: 0,
  inputs: [{ code: "WBC", unit: "/cmm" }, { code: pctCode, unit: "%" }],
  formulaText: `WBC Count × (${name.replace("Absolute ", "").replace(" Count", "")} % ÷ 100)`,
  compute: (v) => v.WBC * (v[pctCode] / 100),
  validationStatus: REQUIRES, defaultEnabled: true,
  origin: VALUE_ORIGIN.CALCULATED,
  source: src("Standard laboratory arithmetic", "", "textbook"),
  limitations: "Requires a total WBC and the differential percentage from the same sample."
});

export const HAEMATOLOGY_RULES = [
  absoluteCount("ANC", "NEUTROPHILS_PCT", "Absolute Neutrophil Count"),
  absoluteCount("ALC", "LYMPHOCYTES_PCT", "Absolute Lymphocyte Count"),
  absoluteCount("AMC", "MONOCYTES_PCT", "Absolute Monocyte Count"),
  absoluteCount("AEC", "EOSINOPHILS_PCT", "Absolute Eosinophil Count"),
  absoluteCount("ABC", "BASOPHILS_PCT", "Absolute Basophil Count"),
  {
    id: "CALC.NLR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Neutrophil / Lymphocyte Ratio", panel: "Haematology",
    outputCode: "NLR", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "ANC", unit: "/cmm" }, { code: "ALC", unit: "/cmm" }],
    formulaText: "Absolute Neutrophil Count ÷ Absolute Lymphocyte Count",
    compute: (v) => v.ANC / v.ALC,
    guard: (v) => (v.ALC > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    dependsOn: ["CALC.ANC", "CALC.ALC"],
    source: src("Derived from absolute differential counts", "", "textbook"),
    limitations: "Proposed cut-offs vary widely by context. Reported as a number only."
  },
  {
    id: "CALC.PLR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Platelet / Lymphocyte Ratio", panel: "Haematology",
    outputCode: "PLR", outputUnit: "Ratio", precision: 1,
    inputs: [{ code: "PLATELETS", unit: "/µL" }, { code: "ALC", unit: "/cmm" }],
    formulaText: "Platelet Count ÷ Absolute Lymphocyte Count",
    compute: (v) => v.PLATELETS / v.ALC,
    guard: (v) => (v.ALC > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    dependsOn: ["CALC.ALC"],
    source: src("Derived from the platelet count and the absolute lymphocyte count", "", "textbook"),
    limitations:
      "Platelet count and absolute lymphocyte count must be expressed on the same volume basis (/µL ≡ /cmm). "
      + "Proposed cut-offs vary widely by context. Reported as a number only."
  },
  {
    id: "CALC.MCV", version: 1, type: RULE_TYPE.CALCULATION,
    name: "MCV (calculated)", panel: "Haematology",
    outputCode: "MCV", outputUnit: "fL", precision: 1,
    inputs: [{ code: "PCV", unit: "%" }, { code: "RBC", unit: "mill/cumm" }],
    formulaText: "(PCV ÷ RBC) × 10",
    compute: (v) => (v.PCV / v.RBC) * 10,
    guard: (v) => (v.RBC > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    // A haematology analyser reports MCV directly; a measured value always wins.
    supersededByMeasured: "MCV",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard red cell index arithmetic (Wintrobe indices)", "", "textbook"),
    limitations:
      "Analyser-derived on most instruments — this calculation is a fallback for a manual count. Requires "
      + "PCV as a percentage and RBC in millions/µL from the same sample."
  },
  {
    id: "CALC.MCH", version: 1, type: RULE_TYPE.CALCULATION,
    name: "MCH (calculated)", panel: "Haematology",
    outputCode: "MCH", outputUnit: "pg", precision: 1,
    inputs: [{ code: "HAEMOGLOBIN", unit: "g/dL" }, { code: "RBC", unit: "mill/cumm" }],
    formulaText: "(Haemoglobin ÷ RBC) × 10",
    compute: (v) => (v.HAEMOGLOBIN / v.RBC) * 10,
    guard: (v) => (v.RBC > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    supersededByMeasured: "MCH",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard red cell index arithmetic (Wintrobe indices)", "", "textbook"),
    limitations:
      "Analyser-derived on most instruments — this calculation is a fallback for a manual count. Requires "
      + "haemoglobin in g/dL and RBC in millions/µL from the same sample."
  },
  {
    id: "CALC.MCHC", version: 1, type: RULE_TYPE.CALCULATION,
    name: "MCHC (calculated)", panel: "Haematology",
    outputCode: "MCHC", outputUnit: "g/dL", precision: 1,
    inputs: [{ code: "HAEMOGLOBIN", unit: "g/dL" }, { code: "PCV", unit: "%" }],
    formulaText: "(Haemoglobin ÷ PCV) × 100",
    compute: (v) => (v.HAEMOGLOBIN / v.PCV) * 100,
    guard: (v) => (v.PCV > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    supersededByMeasured: "MCHC",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard red cell index arithmetic (Wintrobe indices)", "", "textbook"),
    limitations:
      "Analyser-derived on most instruments — this calculation is a fallback for a manual count. g/dL is "
      + "numerically equal to the older '%' MCHC unit. Requires haemoglobin in g/dL and PCV as a percentage."
  }
];

// ---------------------------------------------------------------------------
// IRON
// ---------------------------------------------------------------------------

export const IRON_RULES = [
  {
    id: "CALC.TRANSFERRIN_SAT", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Transferrin Saturation", panel: "Iron",
    outputCode: "TRANSFERRIN_SAT", outputUnit: "%", precision: 1,
    inputs: [{ code: "SERUM_IRON", unit: "µg/dL" }, { code: "TIBC", unit: "µg/dL" }],
    formulaText: "(Serum Iron ÷ TIBC) × 100",
    compute: (v) => (v.SERUM_IRON / v.TIBC) * 100,
    guard: (v) => (v.TIBC > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Both inputs must be in the same unit (µg/dL)."
  },
  {
    id: "CALC.UIBC", version: 1, type: RULE_TYPE.CALCULATION,
    name: "UIBC", panel: "Iron",
    outputCode: "UIBC", outputUnit: "µg/dL", precision: 0,
    inputs: [{ code: "TIBC", unit: "µg/dL" }, { code: "SERUM_IRON", unit: "µg/dL" }],
    formulaText: "TIBC − Serum Iron",
    compute: (v) => v.TIBC - v.SERUM_IRON,
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard laboratory arithmetic", "", "textbook"),
    limitations: "Both inputs must be in the same unit (µg/dL)."
  }
];

// ---------------------------------------------------------------------------
// DIABETES
// ---------------------------------------------------------------------------

export const DIABETES_RULES = [
  {
    id: "CALC.EAG", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Estimated Average Glucose", panel: "Diabetes",
    outputCode: "EAG", outputUnit: "mg/dL", precision: 0,
    inputs: [{ code: "HBA1C", unit: "%" }],
    formulaText: "(28.7 × HbA1c) − 46.7",
    compute: (v) => (28.7 * v.HBA1C) - 46.7,
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("A1c-Derived Average Glucose (ADAG) study; NGSP",
      "https://ngsp.org/A1ceAG.asp", "guideline", 2008),
    limitations:
      "HbA1c must be NGSP-aligned. This is an ESTIMATE, never a measured glucose, and must be labelled "
      + "as such. Less reliable where red-cell lifespan is altered — haemoglobinopathy, anaemia, "
      + "pregnancy, chronic kidney disease — all of which are relevant in the Indian population.",
    reportNote: "Estimated from HbA1c (ADAG). Not a measured glucose."
  },
  {
    id: "CALC.HOMA_IR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "HOMA-IR", panel: "Diabetes",
    outputCode: "HOMA_IR", outputUnit: "Index", precision: 2,
    inputs: [
      { code: "INSULIN_FASTING", unit: "µIU/mL" },
      { code: "GLUCOSE_FASTING", unit: "mg/dL" }
    ],
    requires: { fasting: true },
    formulaText: "(Fasting Insulin × Fasting Glucose) ÷ 405",
    compute: (v) => (v.INSULIN_FASTING * v.GLUCOSE_FASTING) / 405,
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("HOMA model; widely used index", "", "peer-reviewed"),
    limitations:
      "Fasting status must be confirmed — not calculated otherwise. Not validated in patients on insulin "
      + "therapy. Cut-offs for Indian populations REQUIRE MEDICAL VALIDATION; reported as a number with "
      + "no diagnostic label."
  }
];

// ---------------------------------------------------------------------------
// ANTHROPOMETRY
// ---------------------------------------------------------------------------

export const ANTHROPOMETRY_RULES = [
  {
    id: "CALC.BMI", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Body Mass Index", panel: "Anthropometry",
    outputCode: "BMI", outputUnit: "kg/m²", precision: 1,
    inputs: [{ code: "WEIGHT", unit: "kg" }, { code: "HEIGHT", unit: "cm" }],
    formulaText: "Weight (kg) ÷ Height (m)²",
    compute: (v) => v.WEIGHT / ((v.HEIGHT / 100) ** 2),
    guard: (v) => (v.HEIGHT > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    supersededByMeasured: "BMI",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Quetelet index; WHO body mass index definition", "", "guideline"),
    limitations:
      "Height must be entered in centimetres (converted to metres internally). A height in metres will be "
      + "refused as a unit mismatch rather than mis-scaled. BMI category cut-offs differ for Asian "
      + "populations; category labelling is left to the clinician."
  }
];

// ---------------------------------------------------------------------------
// COAGULATION
// ---------------------------------------------------------------------------

export const COAGULATION_RULES = [
  {
    id: "CALC.INR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "INR", panel: "Coagulation",
    outputCode: "INR", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "PT", unit: "seconds" }],
    requires: { params: ["mnpt", "isi"] },
    formulaText: "(Patient PT ÷ Mean Normal PT) ^ ISI",
    compute: (v, ctx, p) => Math.pow(v.PT / p.mnpt, p.isi),
    // If the coagulometer reports INR directly, that value always wins.
    supersededByMeasured: "INR",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("WHO International Normalised Ratio definition for oral anticoagulant monitoring", "", "guideline"),
    limitations:
      "The ISI and the mean normal prothrombin time are specific to the reagent lot and the instrument and "
      + "MUST be configured by this laboratory — there is no universal value. Not calculated until both are "
      + "set. Valid only for warfarin/vitamin-K-antagonist monitoring, not for other causes of a prolonged PT.",
    reportNote: "INR — Calculated from the patient PT using this laboratory's configured ISI and mean normal PT."
  }
];

// ---------------------------------------------------------------------------
// CARDIAC
// ---------------------------------------------------------------------------

export const CARDIAC_RULES = [
  {
    id: "CALC.CK_MB_INDEX", version: 1, type: RULE_TYPE.CALCULATION,
    name: "CK-MB Index (relative index)", panel: "Cardiac",
    outputCode: "CK_MB_INDEX", outputUnit: "%", precision: 1,
    inputs: [{ code: "CK_MB", unit: "U/L" }, { code: "CK_TOTAL", unit: "U/L" }],
    formulaText: "(CK-MB ÷ Total CK) × 100",
    compute: (v) => (v.CK_MB / v.CK_TOTAL) * 100,
    guard: (v) => (v.CK_TOTAL > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    postCheck: (result) => (result > 100
      ? { skip: "Not calculated — CK-MB exceeds total CK; check both results and the assay units." }
      : { value: result }),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("CK-MB relative index; established in cardiac biochemistry literature", "", "peer-reviewed"),
    limitations:
      "Both inputs must be activity (U/L) OR both mass (ng/mL) — never mixed. A number only: it does not, "
      + "alone or with troponin, establish or exclude myocardial infarction. Troponin is the preferred marker."
  }
];

// ---------------------------------------------------------------------------
// RENAL — timed clearance and urine chemistry ratios
// ---------------------------------------------------------------------------

export const CLEARANCE_RULES = [
  {
    id: "CALC.CREATININE_CLEARANCE", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Creatinine Clearance (timed collection)", panel: "Renal",
    outputCode: "CREATININE_CLEARANCE", outputUnit: "mL/min", precision: 0,
    inputs: [
      { code: "URINE_CREATININE", unit: "mg/dL" },
      { code: "URINE_VOLUME", unit: "mL" },
      { code: "CREATININE", unit: "mg/dL" },
      { code: "COLLECTION_HOURS", unit: "hours" }
    ],
    formulaText: "(Urine Creatinine × Urine Volume) ÷ (Serum Creatinine × Collection minutes)",
    compute: (v) => (v.URINE_CREATININE * v.URINE_VOLUME) / (v.CREATININE * v.COLLECTION_HOURS * 60),
    guard: (v) => ((v.CREATININE > 0 && v.COLLECTION_HOURS > 0) ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Standard timed urinary creatinine clearance (UV/P)", "", "textbook"),
    limitations:
      "Uses the ACTUAL collection duration entered — it does not assume 24 hours. Not body-surface-area "
      + "normalised to 1.73 m² (a separate step needing height and weight). Depends entirely on a complete, "
      + "accurately timed collection. eGFR (CKD-EPI 2021) is preferred for routine reporting.",
    reportNote: "Creatinine Clearance — Calculated from the timed urine collection (not BSA-normalised)."
  },
  {
    id: "CALC.URINE_ACR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Urine Albumin/Creatinine Ratio (ACR)", panel: "Renal",
    outputCode: "URINE_ALBUMIN_CREAT_RATIO", outputUnit: "mg/g", precision: 1,
    inputs: [
      { code: "URINE_ALBUMIN", unit: "mg/L" },
      { code: "URINE_CREATININE", unit: "mg/dL" }
    ],
    formulaText: "Urine Albumin (mg/L) × 100 ÷ Urine Creatinine (mg/dL)   [→ mg albumin per g creatinine]",
    compute: (v) => (v.URINE_ALBUMIN * 100) / v.URINE_CREATININE,
    guard: (v) => (v.URINE_CREATININE > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    supersededByMeasured: "URINE_ALBUMIN_CREAT_RATIO",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("KDIGO albumin-to-creatinine ratio; unit conversion mg/L ÷ (g/L)", "", "guideline"),
    limitations:
      "UNIT-SENSITIVE. Assumes urine albumin in mg/L and urine creatinine in mg/dL; the ×100 factor "
      + "converts to mg albumin per gram creatinine. A laboratory MUST confirm its analyser's reporting "
      + "units match before enabling this. Off by default for that reason."
  },
  {
    id: "CALC.URINE_UPCR", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Urine Protein/Creatinine Ratio (UPCR)", panel: "Renal",
    outputCode: "URINE_PROTEIN_CREAT_RATIO", outputUnit: "mg/g", precision: 0,
    inputs: [
      { code: "URINE_PROTEIN", unit: "mg/dL" },
      { code: "URINE_CREATININE", unit: "mg/dL" }
    ],
    formulaText: "Urine Protein (mg/dL) × 1000 ÷ Urine Creatinine (mg/dL)   [→ mg protein per g creatinine]",
    compute: (v) => (v.URINE_PROTEIN * 1000) / v.URINE_CREATININE,
    guard: (v) => (v.URINE_CREATININE > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    supersededByMeasured: "URINE_PROTEIN_CREAT_RATIO",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Urine protein-to-creatinine ratio; unit conversion mg/dL ÷ (g/dL)", "", "guideline"),
    limitations:
      "UNIT-SENSITIVE. Assumes both protein and creatinine in mg/dL; the ×1000 factor converts to mg "
      + "protein per gram creatinine (numerically 1000 × the mg/mg ratio some laboratories report). "
      + "Confirm analyser units before enabling. Off by default for that reason."
  }
];

// ---------------------------------------------------------------------------
// ARTERIAL BLOOD GAS
// ---------------------------------------------------------------------------

export const ABG_RULES = [
  {
    id: "CALC.HCO3_HH", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Bicarbonate (Henderson–Hasselbalch)", panel: "Blood gas",
    outputCode: "HCO3_CALCULATED", outputUnit: "mmol/L", precision: 1,
    inputs: [{ code: "PH_BLOOD", unit: "" }, { code: "PCO2", unit: "mmHg" }],
    formulaText: "0.03 × pCO₂ × 10^(pH − 6.1)",
    compute: (v) => 0.03 * v.PCO2 * Math.pow(10, v.PH_BLOOD - 6.1),
    guard: (v) => ((v.PH_BLOOD >= 6.5 && v.PH_BLOOD <= 8) ? null : SKIP_REASON.OUT_OF_RANGE),
    // A blood-gas analyser reports HCO3⁻ directly; a measured value always wins.
    supersededByMeasured: "BICARBONATE",
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Henderson–Hasselbalch equation for the bicarbonate buffer system", "", "textbook"),
    limitations:
      "pCO₂ must be in mmHg. Uses the standard pK′ 6.1 and CO₂ solubility 0.03 mmol/L/mmHg; both shift "
      + "slightly at extremes of temperature and ionic strength. The analyser's own HCO₃⁻ is preferred when "
      + "available."
  },
  {
    id: "CALC.AA_GRADIENT", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Alveolar–arterial O₂ gradient", panel: "Blood gas",
    outputCode: "AA_GRADIENT", outputUnit: "mmHg", precision: 0,
    inputs: [{ code: "PO2", unit: "mmHg" }, { code: "PCO2", unit: "mmHg" }],
    formulaText: "PAO₂ − PaO₂,  where PAO₂ = FiO₂ × (Patm − 47) − PaCO₂ ÷ 0.8",
    compute: (v, ctx, p) => {
      const fio2 = Number(p?.fio2) > 0 ? Number(p.fio2) : 0.21;   // room air
      const patm = Number(p?.patm) > 0 ? Number(p.patm) : 760;    // sea level, mmHg
      const pAO2 = fio2 * (patm - 47) - (v.PCO2 / 0.8);
      return pAO2 - v.PO2;
    },
    validationStatus: REQUIRES, defaultEnabled: false,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Alveolar gas equation; standard respiratory physiology", "", "textbook"),
    limitations:
      "Assumes room air (FiO₂ 0.21) and sea-level barometric pressure (760 mmHg) unless this laboratory "
      + "configures fio2 / patm for the rule. The age-adjusted upper limit of normal (≈ age ÷ 4 + 4) is "
      + "left to the clinician. Off by default because FiO₂ and altitude are not laboratory inputs.",
    reportNote: "A–a gradient — Calculated assuming room air and sea-level pressure unless configured otherwise."
  }
];

// ---------------------------------------------------------------------------
// BODY FLUIDS
// ---------------------------------------------------------------------------

export const BODY_FLUID_RULES = [
  {
    id: "CALC.SAAG", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Serum–Ascites Albumin Gradient (SAAG)", panel: "Body fluid",
    outputCode: "SAAG", outputUnit: "g/dL", precision: 1,
    inputs: [{ code: "ALBUMIN", unit: "g/dL" }, { code: "FLUID_ALBUMIN", unit: "g/dL" }],
    formulaText: "Serum Albumin − Ascitic Fluid Albumin",
    compute: (v) => v.ALBUMIN - v.FLUID_ALBUMIN,
    postCheck: (result) => (result < 0
      ? { value: 0, note: "Calculated gradient was below zero from analytical imprecision; reported as 0.0." }
      : { value: result }),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Serum–ascites albumin gradient; established in hepatology", "", "peer-reviewed"),
    limitations:
      "Serum and fluid albumin must be measured on samples taken the same day and reported in g/dL. "
      + "A gradient ≥ 1.1 g/dL is associated with portal hypertension; the threshold and its meaning are "
      + "for the clinician, not this engine.",
    reportNote: "SAAG — Calculated (serum albumin − ascitic fluid albumin)."
  },
  {
    id: "CALC.FLUID_SERUM_PROTEIN_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Fluid/Serum Protein Ratio", panel: "Body fluid",
    outputCode: "FLUID_SERUM_PROTEIN_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "FLUID_TOTAL_PROTEIN", unit: "g/dL" }, { code: "TOTAL_PROTEIN", unit: "g/dL" }],
    formulaText: "Fluid Total Protein ÷ Serum Total Protein",
    compute: (v) => v.FLUID_TOTAL_PROTEIN / v.TOTAL_PROTEIN,
    guard: (v) => (v.TOTAL_PROTEIN > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Light's criteria component ratio", "", "peer-reviewed"),
    limitations: "Both proteins must be in g/dL from paired samples. One component of Light's criteria; not interpreted alone."
  },
  {
    id: "CALC.FLUID_SERUM_LDH_RATIO", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Fluid/Serum LDH Ratio", panel: "Body fluid",
    outputCode: "FLUID_SERUM_LDH_RATIO", outputUnit: "Ratio", precision: 2,
    inputs: [{ code: "FLUID_LDH", unit: "U/L" }, { code: "SERUM_LDH", unit: "U/L" }],
    formulaText: "Fluid LDH ÷ Serum LDH",
    compute: (v) => v.FLUID_LDH / v.SERUM_LDH,
    guard: (v) => (v.SERUM_LDH > 0 ? null : SKIP_REASON.CONDITION_UNMET),
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("Light's criteria component ratio", "", "peer-reviewed"),
    limitations: "Both LDH values must be in the same unit from paired samples. One component of Light's criteria; not interpreted alone."
  }
];

// ---------------------------------------------------------------------------
// SEMEN ANALYSIS
// ---------------------------------------------------------------------------

export const SEMEN_RULES = [
  {
    id: "CALC.TOTAL_SPERM_COUNT", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Total Sperm Count", panel: "Semen",
    outputCode: "TOTAL_SPERM_COUNT", outputUnit: "million/ejaculate", precision: 0,
    inputs: [
      { code: "SEMEN_VOLUME", unit: "mL" },
      { code: "SPERM_CONCENTRATION", unit: "million/mL" }
    ],
    formulaText: "Semen Volume × Sperm Concentration",
    compute: (v) => v.SEMEN_VOLUME * v.SPERM_CONCENTRATION,
    supersededByMeasured: "TOTAL_SPERM_COUNT",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("WHO laboratory manual for the examination of human semen (total number per ejaculate)", "", "guideline"),
    limitations:
      "Volume in mL and concentration in million/mL, from the same complete ejaculate. Reference limits "
      + "are the laboratory's chosen WHO manual edition; category labelling is the clinician's."
  },
  {
    id: "CALC.TOTAL_MOTILE_SPERM_COUNT", version: 1, type: RULE_TYPE.CALCULATION,
    name: "Total Motile Sperm Count", panel: "Semen",
    outputCode: "TOTAL_MOTILE_SPERM_COUNT", outputUnit: "million/ejaculate", precision: 0,
    inputs: [
      { code: "SEMEN_VOLUME", unit: "mL" },
      { code: "SPERM_CONCENTRATION", unit: "million/mL" },
      { code: "TOTAL_MOTILITY", unit: "%" }
    ],
    formulaText: "Semen Volume × Sperm Concentration × (Total Motility % ÷ 100)",
    compute: (v) => v.SEMEN_VOLUME * v.SPERM_CONCENTRATION * (v.TOTAL_MOTILITY / 100),
    supersededByMeasured: "TOTAL_MOTILE_SPERM_COUNT",
    validationStatus: REQUIRES, defaultEnabled: true,
    origin: VALUE_ORIGIN.CALCULATED,
    source: src("WHO laboratory manual for the examination of human semen (total motile count)", "", "guideline"),
    limitations:
      "Uses total motility (progressive + non-progressive). Some laboratories prefer progressive motility "
      + "only — that is a per-laboratory choice, not made here. Same unit requirements as the total count."
  }
];

/** Every calculation rule the platform knows about. */
export const ALL_RULES = Object.freeze([
  ...LIVER_RULES, ...LIPID_RULES, ...RENAL_RULES,
  ...HAEMATOLOGY_RULES, ...IRON_RULES, ...DIABETES_RULES,
  ...ANTHROPOMETRY_RULES, ...COAGULATION_RULES, ...CARDIAC_RULES,
  ...CLEARANCE_RULES, ...ABG_RULES, ...BODY_FLUID_RULES, ...SEMEN_RULES
]);

export function ruleById(id) { return ALL_RULES.find((r) => r.id === id) || null; }
export function rulesForPanel(panel) { return ALL_RULES.filter((r) => r.panel === panel); }
export function calculationRules() { return ALL_RULES.filter((r) => r.type === RULE_TYPE.CALCULATION); }
