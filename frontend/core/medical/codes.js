// Canonical parameter codes and the synonyms that map onto them.
// NO IMPORTS, by design.
//
// WHY THIS EXISTS. The catalogue stores parameter NAMES as a laboratory typed
// them — "SGOT / AST", "SGPT/ALT", "Haemoglobin", "Hemoglobin", "Total
// Bilurubin". A calculation rule cannot key off free text. Every rule speaks
// canonical codes, and this resolves a laboratory's wording onto them.
//
// Resolution is deliberately conservative: an unrecognised name yields null
// rather than a guess. A wrong match here would feed the wrong number into a
// clinical formula, which is far worse than not calculating at all.

/** code -> canonical display name and the unit the formulas assume. */
export const PARAMETERS = Object.freeze({
  // --- Liver ---
  TOTAL_BILIRUBIN:   { name: "Total Bilirubin", unit: "mg/dL" },
  DIRECT_BILIRUBIN:  { name: "Direct Bilirubin", unit: "mg/dL" },
  INDIRECT_BILIRUBIN:{ name: "Indirect Bilirubin", unit: "mg/dL" },
  AST:               { name: "SGOT / AST", unit: "U/L" },
  ALT:               { name: "SGPT / ALT", unit: "U/L" },
  ALP:               { name: "Alkaline Phosphatase", unit: "U/L" },
  GGT:               { name: "Gamma GT", unit: "U/L" },
  TOTAL_PROTEIN:     { name: "Total Protein", unit: "g/dL" },
  ALBUMIN:           { name: "Albumin", unit: "g/dL" },
  GLOBULIN:          { name: "Globulin", unit: "g/dL" },
  AG_RATIO:          { name: "A/G Ratio", unit: "Ratio" },
  AST_ALT_RATIO:     { name: "AST / ALT Ratio", unit: "Ratio" },

  // --- Lipid ---
  TOTAL_CHOLESTEROL: { name: "Total Cholesterol", unit: "mg/dL" },
  HDL:               { name: "HDL Cholesterol", unit: "mg/dL" },
  LDL_DIRECT:        { name: "LDL Cholesterol - Direct", unit: "mg/dL" },
  LDL_CALCULATED:    { name: "LDL Cholesterol (calculated)", unit: "mg/dL" },
  TRIGLYCERIDES:     { name: "Triglycerides", unit: "mg/dL" },
  VLDL:              { name: "VLDL Cholesterol", unit: "mg/dL" },
  NON_HDL:           { name: "Non-HDL Cholesterol", unit: "mg/dL" },
  TC_HDL_RATIO:      { name: "TC / HDL Ratio", unit: "Ratio" },
  LDL_HDL_RATIO:     { name: "LDL / HDL Ratio", unit: "Ratio" },
  TG_HDL_RATIO:      { name: "TG / HDL Ratio", unit: "Ratio" },

  // --- Renal / electrolytes ---
  UREA:              { name: "Urea", unit: "mg/dL" },
  BUN:               { name: "BUN", unit: "mg/dL" },
  CREATININE:        { name: "Creatinine", unit: "mg/dL" },
  URIC_ACID:         { name: "Uric Acid", unit: "mg/dL" },
  EGFR:              { name: "eGFR", unit: "mL/min/1.73m²" },
  BUN_CREAT_RATIO:   { name: "BUN / Creatinine Ratio", unit: "Ratio" },
  SODIUM:            { name: "Sodium", unit: "mEq/L" },
  POTASSIUM:         { name: "Potassium", unit: "mEq/L" },
  CHLORIDE:          { name: "Chloride", unit: "mEq/L" },
  BICARBONATE:       { name: "Bicarbonate", unit: "mEq/L" },
  ANION_GAP:         { name: "Anion Gap", unit: "mEq/L" },
  CALCIUM:           { name: "Calcium", unit: "mg/dL" },
  CORRECTED_CALCIUM: { name: "Corrected Calcium", unit: "mg/dL" },

  // --- Haematology ---
  HAEMOGLOBIN:       { name: "Haemoglobin", unit: "g/dL" },
  RBC:               { name: "RBC Count", unit: "mill/cumm" },
  WBC:               { name: "WBC Count", unit: "/cmm" },
  PLATELETS:         { name: "Platelet Count", unit: "/µL" },
  PCV:               { name: "PCV / HCT", unit: "%" },
  MCV:               { name: "MCV", unit: "fL" },
  MCH:               { name: "MCH", unit: "pg" },
  MCHC:              { name: "MCHC", unit: "%" },
  RDW:               { name: "RDW-CV", unit: "%" },
  NEUTROPHILS_PCT:   { name: "Neutrophils", unit: "%" },
  LYMPHOCYTES_PCT:   { name: "Lymphocytes", unit: "%" },
  MONOCYTES_PCT:     { name: "Monocytes", unit: "%" },
  EOSINOPHILS_PCT:   { name: "Eosinophils", unit: "%" },
  BASOPHILS_PCT:     { name: "Basophils", unit: "%" },
  ANC:               { name: "Absolute Neutrophil Count", unit: "/cmm" },
  ALC:               { name: "Absolute Lymphocyte Count", unit: "/cmm" },
  AMC:               { name: "Absolute Monocyte Count", unit: "/cmm" },
  AEC:               { name: "Absolute Eosinophil Count", unit: "/cmm" },
  ABC:               { name: "Absolute Basophil Count", unit: "/cmm" },
  NLR:               { name: "Neutrophil / Lymphocyte Ratio", unit: "Ratio" },
  PLR:               { name: "Platelet / Lymphocyte Ratio", unit: "Ratio" },

  // --- Iron ---
  SERUM_IRON:        { name: "Serum Iron", unit: "µg/dL" },
  TIBC:              { name: "TIBC", unit: "µg/dL" },
  UIBC:              { name: "UIBC", unit: "µg/dL" },
  TRANSFERRIN_SAT:   { name: "Transferrin Saturation", unit: "%" },
  FERRITIN:          { name: "Ferritin", unit: "ng/mL" },

  // --- Thyroid ---
  TSH:               { name: "TSH", unit: "µIU/mL" },
  FT4:               { name: "Free T4", unit: "ng/dL" },
  FT3:               { name: "Free T3", unit: "pg/mL" },
  T4:                { name: "Total T4", unit: "µg/dL" },
  T3:                { name: "Total T3", unit: "ng/dL" },

  // --- Diabetes ---
  HBA1C:             { name: "HbA1c", unit: "%" },
  EAG:               { name: "Estimated Average Glucose", unit: "mg/dL" },
  GLUCOSE_FASTING:   { name: "Fasting Blood Sugar", unit: "mg/dL" },
  INSULIN_FASTING:   { name: "Fasting Insulin", unit: "µIU/mL" },
  HOMA_IR:           { name: "HOMA-IR", unit: "Index" },

  // --- Anthropometry ---
  HEIGHT:            { name: "Height", unit: "cm" },
  WEIGHT:            { name: "Weight", unit: "kg" },
  BMI:               { name: "Body Mass Index", unit: "kg/m²" },
  BSA:               { name: "Body Surface Area", unit: "m²" },

  // --- Coagulation ---
  PT:                { name: "Prothrombin Time", unit: "seconds" },
  INR:               { name: "INR", unit: "Ratio" },
  APTT:              { name: "APTT", unit: "seconds" },

  // --- Cardiac ---
  CK_TOTAL:          { name: "Creatine Kinase (Total)", unit: "U/L" },
  CK_MB:             { name: "CK-MB", unit: "U/L" },
  CK_MB_INDEX:       { name: "CK-MB Index", unit: "%" },

  // --- Renal clearance / urine chemistry ---
  URINE_CREATININE:  { name: "Urine Creatinine", unit: "mg/dL" },
  URINE_VOLUME:      { name: "Urine Volume (24h)", unit: "mL" },
  COLLECTION_HOURS:  { name: "Urine Collection Duration", unit: "hours" },
  CREATININE_CLEARANCE: { name: "Creatinine Clearance", unit: "mL/min" },
  URINE_ALBUMIN:     { name: "Urine Albumin", unit: "mg/L" },
  URINE_PROTEIN:     { name: "Urine Protein", unit: "mg/dL" },
  URINE_ALBUMIN_CREAT_RATIO: { name: "Urine Albumin/Creatinine Ratio", unit: "mg/g" },
  URINE_PROTEIN_CREAT_RATIO: { name: "Urine Protein/Creatinine Ratio", unit: "mg/g" },

  // --- Arterial blood gas ---
  PH_BLOOD:          { name: "pH", unit: "" },
  PCO2:              { name: "pCO2", unit: "mmHg" },
  PO2:               { name: "pO2", unit: "mmHg" },
  HCO3_CALCULATED:   { name: "Bicarbonate (calculated)", unit: "mmol/L" },
  AA_GRADIENT:       { name: "Alveolar–arterial O₂ Gradient", unit: "mmHg" },

  // --- Body fluids ---
  FLUID_ALBUMIN:     { name: "Fluid Albumin", unit: "g/dL" },
  FLUID_TOTAL_PROTEIN: { name: "Fluid Total Protein", unit: "g/dL" },
  FLUID_LDH:         { name: "Fluid LDH", unit: "U/L" },
  SERUM_LDH:         { name: "Serum LDH", unit: "U/L" },
  SAAG:              { name: "Serum–Ascites Albumin Gradient", unit: "g/dL" },
  FLUID_SERUM_PROTEIN_RATIO: { name: "Fluid/Serum Protein Ratio", unit: "Ratio" },
  FLUID_SERUM_LDH_RATIO: { name: "Fluid/Serum LDH Ratio", unit: "Ratio" },

  // --- Semen analysis ---
  SEMEN_VOLUME:      { name: "Semen Volume", unit: "mL" },
  SPERM_CONCENTRATION: { name: "Sperm Concentration", unit: "million/mL" },
  TOTAL_MOTILITY:    { name: "Total Motility", unit: "%" },
  PROGRESSIVE_MOTILITY: { name: "Progressive Motility", unit: "%" },
  TOTAL_SPERM_COUNT: { name: "Total Sperm Count", unit: "million/ejaculate" },
  TOTAL_MOTILE_SPERM_COUNT: { name: "Total Motile Sperm Count", unit: "million/ejaculate" }
});

/**
 * Synonyms, lower-cased and stripped of punctuation by normalise() below.
 * Add a spelling here rather than loosening the matcher — a loose matcher is
 * how the wrong analyte ends up in a formula.
 */
const SYNONYMS = {
  TOTAL_BILIRUBIN: ["total bilirubin", "bilirubin total", "s bilirubin total", "total bilurubin", "t bilirubin"],
  DIRECT_BILIRUBIN: ["direct bilirubin", "bilirubin direct", "conjugated bilirubin", "d bilirubin"],
  INDIRECT_BILIRUBIN: ["indirect bilirubin", "bilirubin indirect", "unconjugated bilirubin"],
  AST: ["sgot ast", "ast sgot", "sgot", "ast", "aspartate aminotransferase", "sgot aspartate aminotransferase"],
  ALT: ["sgpt alt", "alt sgpt", "sgpt", "alt", "alanine aminotransferase", "sgpt alanine aminotransferase"],
  ALP: ["alkaline phosphatase", "alp", "s alkaline phosphatase", "serum alkaline phosphatase"],
  GGT: ["gamma gt", "ggt", "gamma glutamyl transferase", "gamma glutamyl transpeptidase", "ggtp"],
  TOTAL_PROTEIN: ["total protein", "protein total", "s total protein", "serum total protein"],
  ALBUMIN: ["albumin", "s albumin", "serum albumin"],
  GLOBULIN: ["globulin", "s globulin", "serum globulin"],
  AG_RATIO: ["a g ratio", "ag ratio", "albumin globulin ratio", "a/g ratio"],
  AST_ALT_RATIO: ["ast alt ratio", "sgot sgpt ratio", "de ritis ratio"],

  TOTAL_CHOLESTEROL: ["total cholesterol", "cholesterol total", "s cholesterol", "serum cholesterol", "cholesterol"],
  HDL: ["hdl cholesterol", "hdl", "hdl cholesterol direct", "hdl c", "high density lipoprotein"],
  LDL_DIRECT: ["ldl cholesterol direct", "ldl direct", "direct ldl"],
  LDL_CALCULATED: ["ldl cholesterol calculated", "ldl calculated", "ldl cholesterol", "ldl", "ldl c"],
  TRIGLYCERIDES: ["triglycerides", "triglyceride", "tg", "s triglycerides", "serum triglycerides"],
  VLDL: ["vldl cholesterol", "vldl", "vldl c"],
  NON_HDL: ["non hdl cholesterol", "non hdl", "nonhdl cholesterol"],
  TC_HDL_RATIO: ["tc hdl cholesterol ratio", "tc hdl ratio", "cholesterol hdl ratio", "chol hdl ratio"],
  LDL_HDL_RATIO: ["ldl hdl ratio"],
  TG_HDL_RATIO: ["trig hdl ratio", "tg hdl ratio", "triglyceride hdl ratio"],

  UREA: ["urea", "s urea", "serum urea", "blood urea"],
  BUN: ["bun", "blood urea nitrogen", "urea nitrogen"],
  CREATININE: ["creatinine", "s creatinine", "serum creatinine", "creat"],
  URIC_ACID: ["uric acid", "s uric acid", "serum uric acid"],
  EGFR: ["egfr", "estimated gfr", "gfr estimated", "e gfr"],
  BUN_CREAT_RATIO: ["bun creatinine ratio", "bun creat ratio"],
  SODIUM: ["sodium", "na", "s sodium", "serum sodium"],
  POTASSIUM: ["potassium", "k", "s potassium", "serum potassium"],
  CHLORIDE: ["chloride", "cl", "s chloride", "serum chloride"],
  BICARBONATE: ["bicarbonate", "hco3", "co2", "total co2", "serum bicarbonate"],
  ANION_GAP: ["anion gap"],
  CALCIUM: ["calcium", "s calcium", "serum calcium", "total calcium"],
  CORRECTED_CALCIUM: ["corrected calcium", "albumin corrected calcium", "adjusted calcium"],

  HAEMOGLOBIN: ["haemoglobin", "hemoglobin", "hb", "hgb"],
  RBC: ["rbc count", "rbc", "red blood cell count", "total rbc count", "erythrocyte count"],
  WBC: ["wbc count", "wbc", "total wbc count", "tlc", "total leucocyte count", "leucocyte count", "white blood cell count"],
  PLATELETS: ["platelet count", "platelets", "plt", "total platelet count"],
  PCV: ["pcv hct", "pcv", "hct", "haematocrit", "hematocrit", "packed cell volume"],
  MCV: ["mcv", "mean corpuscular volume"],
  MCH: ["mch", "mean corpuscular haemoglobin", "mean corpuscular hemoglobin"],
  MCHC: ["mchc", "mean corpuscular haemoglobin concentration"],
  RDW: ["rdw cv", "rdw", "rdw sd", "red cell distribution width"],
  NEUTROPHILS_PCT: ["neutrophils", "neutrophil", "polymorphs", "neutrophils percentage"],
  LYMPHOCYTES_PCT: ["lymphocytes", "lymphocyte", "lymphocytes percentage"],
  MONOCYTES_PCT: ["monocytes", "monocyte"],
  EOSINOPHILS_PCT: ["eosinophils", "eosinophil"],
  BASOPHILS_PCT: ["basophils", "basophil"],
  ANC: ["absolute neutrophil count", "anc"],
  ALC: ["absolute lymphocyte count", "alc"],
  AMC: ["absolute monocyte count", "amc"],
  AEC: ["absolute eosinophil count", "aec"],
  ABC: ["absolute basophil count", "abc"],
  NLR: ["neutrophil lymphocyte ratio", "nlr", "n l ratio"],
  PLR: ["platelet lymphocyte ratio", "plr", "p l ratio"],

  SERUM_IRON: ["serum iron", "iron", "s iron"],
  TIBC: ["tibc", "total iron binding capacity"],
  UIBC: ["uibc", "unsaturated iron binding capacity"],
  TRANSFERRIN_SAT: ["transferrin saturation", "percent transferrin saturation", "tsat", "saturation"],
  FERRITIN: ["ferritin", "serum ferritin", "s ferritin"],

  TSH: ["tsh", "thyroid stimulating hormone", "s tsh"],
  FT4: ["free t4", "ft4", "free thyroxine"],
  FT3: ["free t3", "ft3", "free triiodothyronine"],
  T4: ["total t4", "t4", "thyroxine"],
  T3: ["total t3", "t3", "triiodothyronine"],

  HBA1C: ["hba1c", "hb a1c", "glycated haemoglobin", "glycosylated haemoglobin", "a1c"],
  EAG: ["estimated average glucose", "eag", "average estimated glucose"],
  GLUCOSE_FASTING: ["fasting blood sugar", "fbs", "fasting glucose", "glucose fasting", "fasting plasma glucose"],
  INSULIN_FASTING: ["fasting insulin", "insulin fasting", "s insulin fasting"],
  HOMA_IR: ["homa ir", "homa index", "homair"],

  HEIGHT: ["height", "patient height", "ht"],
  WEIGHT: ["weight", "patient weight", "body weight", "wt"],
  BMI: ["body mass index", "bmi", "quetelet index"],
  BSA: ["body surface area", "bsa"],

  PT: ["prothrombin time", "pt", "prothrombin time pt", "p time"],
  INR: ["inr", "international normalised ratio", "international normalized ratio", "pt inr"],
  APTT: ["aptt", "activated partial thromboplastin time", "partial thromboplastin time", "ptt"],

  CK_TOTAL: ["creatine kinase total", "creatine kinase", "cpk", "ck total", "ck", "total ck", "creatine phosphokinase"],
  CK_MB: ["ck mb", "creatine kinase mb", "ckmb", "cpk mb", "ck mb mass"],
  CK_MB_INDEX: ["ck mb index", "ckmb index", "relative index", "ck mb relative index"],

  URINE_CREATININE: ["urine creatinine", "creatinine urine", "u creatinine", "urinary creatinine"],
  URINE_VOLUME: ["urine volume", "24 hr urine volume", "24 hour urine volume", "total urine volume", "24h urine volume"],
  COLLECTION_HOURS: ["urine collection duration", "collection duration", "collection period", "collection time hours", "duration of collection"],
  CREATININE_CLEARANCE: ["creatinine clearance", "crcl", "ccr", "cockcroft gault", "cockcroft gault clearance"],
  URINE_ALBUMIN: ["urine albumin", "albumin urine", "urinary albumin", "microalbumin", "urine microalbumin", "mau"],
  URINE_PROTEIN: ["urine protein", "protein urine", "urinary protein", "spot urine protein", "urine total protein"],
  URINE_ALBUMIN_CREAT_RATIO: ["urine albumin creatinine ratio", "albumin creatinine ratio", "acr", "uacr", "urine acr"],
  URINE_PROTEIN_CREAT_RATIO: ["urine protein creatinine ratio", "protein creatinine ratio", "upcr", "pcr", "uprot creat ratio"],

  PH_BLOOD: ["ph", "blood ph", "arterial ph", "ph arterial"],
  PCO2: ["pco2", "pa co2", "paco2", "partial pressure of carbon dioxide", "p co2"],
  PO2: ["po2", "pa o2", "pao2", "partial pressure of oxygen", "p o2"],
  HCO3_CALCULATED: ["bicarbonate calculated", "calculated bicarbonate", "hco3 calculated", "actual bicarbonate"],
  AA_GRADIENT: ["alveolar arterial o2 gradient", "a a gradient", "aa gradient", "alveolar arterial gradient", "a ado2"],

  FLUID_ALBUMIN: ["fluid albumin", "ascitic fluid albumin", "ascitic albumin", "pleural fluid albumin", "body fluid albumin"],
  FLUID_TOTAL_PROTEIN: ["fluid total protein", "fluid protein", "ascitic fluid protein", "pleural fluid protein", "body fluid protein"],
  FLUID_LDH: ["fluid ldh", "ascitic fluid ldh", "pleural fluid ldh", "body fluid ldh", "fluid ld"],
  SERUM_LDH: ["serum ldh", "ldh", "lactate dehydrogenase", "s ldh", "serum ld"],
  SAAG: ["serum ascites albumin gradient", "saag", "serum ascitic albumin gradient"],
  FLUID_SERUM_PROTEIN_RATIO: ["fluid serum protein ratio", "protein fluid serum ratio", "protein fluid serum"],
  FLUID_SERUM_LDH_RATIO: ["fluid serum ldh ratio", "ldh fluid serum ratio", "ldh fluid serum"],

  SEMEN_VOLUME: ["semen volume", "ejaculate volume", "seminal fluid volume"],
  SPERM_CONCENTRATION: ["sperm concentration", "sperm count concentration", "sperm density"],
  TOTAL_MOTILITY: ["total motility", "total motile", "motility total", "progressive plus non progressive motility"],
  PROGRESSIVE_MOTILITY: ["progressive motility", "progressively motile", "grade a plus b motility", "rapid progressive motility"],
  TOTAL_SPERM_COUNT: ["total sperm count", "total sperm number", "sperm count total"],
  TOTAL_MOTILE_SPERM_COUNT: ["total motile sperm count", "tmsc", "total motile sperm", "total progressively motile sperm count"]
};

/** Lower-case, strip punctuation, collapse whitespace. */
export function normalise(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[().,%:;\/\\+_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LOOKUP = new Map();
Object.entries(SYNONYMS).forEach(([code, names]) => {
  names.forEach((n) => {
    const key = normalise(n);
    // First registration wins, so an earlier, more specific synonym is not
    // displaced by a later, looser one (LDL_DIRECT before LDL_CALCULATED).
    if (!LOOKUP.has(key)) LOOKUP.set(key, code);
  });
});
Object.entries(PARAMETERS).forEach(([code, meta]) => {
  const key = normalise(meta.name);
  if (!LOOKUP.has(key)) LOOKUP.set(key, code);
});

/**
 * Resolve a laboratory's parameter name to a canonical code.
 * @returns {string|null} null when unrecognised — never a guess.
 */
export function resolveCode(parameterName) {
  const key = normalise(parameterName);
  if (!key) return null;
  return LOOKUP.get(key) || null;
}

/**
 * Whether a string is one of this module's canonical analyte codes.
 *
 * A catalogue parameter may carry a laboratory's own `code` - "GLU-01", "P7".
 * Those must never be mistaken for canonical codes, or a lab-internal
 * identifier that happens to collide would silently feed the wrong analyte
 * into a formula.
 */
export function isCanonicalCode(code) {
  return Object.prototype.hasOwnProperty.call(PARAMETERS, String(code || ""));
}

/**
 * The canonical analyte code for a report row — the ONE place row→code
 * resolution lives, so the value collector, the flag engine and the
 * write-back all agree.
 *
 * A catalogue row may carry its own `code` ("GLU-01", "P7", ""). It is only
 * honoured when it actually is one of this module's canonical codes; anything
 * else falls through to resolving the row's display name. Getting this wrong
 * in one place and right in another is how an input lands under a key no rule
 * looks for, and the calculation silently never runs.
 *
 * @param {{code?:string,name?:string}} row
 * @returns {string|null}
 */
export function resolveRowCode(row = {}) {
  if (row && row.code && isCanonicalCode(row.code)) return row.code;
  return resolveCode(row?.name);
}

export function codeUnit(code) { return PARAMETERS[code]?.unit || ""; }
export function codeName(code) { return PARAMETERS[code]?.name || code; }

/** Every synonym registered, for the admin screen and for tests. */
export function knownSynonyms() {
  const out = {};
  LOOKUP.forEach((code, key) => {
    (out[code] ||= []).push(key);
  });
  return out;
}
