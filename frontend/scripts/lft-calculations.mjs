export const INDIRECT_BILIRUBIN_WARNING = "Please verify Total Bilirubin and Direct Bilirubin values.";

const TOTAL_BILIRUBIN_ALIASES = [
  "BILIRUBIN_TOTAL",
  "TOTAL_BILIRUBIN",
  "Bilirubin Total",
  "Total Bilirubin",
  "T. Bilirubin"
];

const DIRECT_BILIRUBIN_ALIASES = [
  "BILIRUBIN_DIRECT",
  "DIRECT_BILIRUBIN",
  "Bilirubin Direct",
  "Direct Bilirubin",
  "D. Bilirubin"
];

const INDIRECT_BILIRUBIN_ALIASES = [
  "BILIRUBIN_INDIRECT",
  "INDIRECT_BILIRUBIN",
  "Bilirubin Indirect",
  "Indirect Bilirubin",
  "I. Bilirubin"
];

export const LFT_INTERPRETIVE_NOTES = [
  "Increased AST and ALT levels should be correlated with clinical findings, history, and medication use.",
  "ALT activity is often higher than AST in many liver diseases; exceptions may occur in alcoholic hepatitis, cirrhosis, and liver neoplasia.",
  "In chronic liver disease, ELF, AFP, or DCP/PIVKA II testing may be considered when clinically indicated."
];

export const LFT_FALLBACK_ORDER = [
  ["astsgot", "sgotast", "ast", "sgot"],
  ["altsgpt", "sgptalt", "alt", "sgpt"],
  ["ggt", "ggtp", "gammaglutamyltransferase"],
  ["alkalinephosphatase", "alp"],
  ["bilirubintotal", "totalbilirubin", "tbilirubin"],
  ["bilirubindirect", "directbilirubin", "dbilirubin"],
  ["bilirubinindirect", "indirectbilirubin", "ibilirubin"],
  ["totalprotein", "totalproteins"],
  ["albumin"],
  ["globulin"],
  ["agratio", "albuminglobulinratio"]
];

export function compactLftKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rowName(row) {
  return row?.code || row?.parameterCode || row?.parameter_code || row?.name || row?.parameterName || row?.parameter_name || row?.parameter || "";
}

function rowValue(row) {
  return row?.value ?? row?.finding ?? row?.resultValue ?? row?.result_value ?? row?.result ?? "";
}

function rowPrecision(row, fallback = 2) {
  const raw = row?.precision ?? row?.decimalPlaces ?? row?.decimal_places ?? row?.decimals;
  const precision = Number(raw);
  return Number.isInteger(precision) && precision >= 0 && precision <= 6 ? precision : fallback;
}

function numberFrom(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function findByAliases(parameters, aliases) {
  const aliasKeys = aliases.map(compactLftKey);
  return parameters.find((row) => aliasKeys.includes(compactLftKey(rowName(row))));
}

export function isLftTest(report) {
  const text = [
    report?.testName,
    report?.name,
    report?.testCode,
    report?.category,
    ...(Array.isArray(report?.tests) ? report.tests.map((test) => `${test?.name || ""} ${test?.testName || ""} ${test?.testCode || ""}`) : [])
  ].join(" ").toLowerCase();
  return compactLftKey(text).includes("lft") || text.includes("liver function");
}

export function isAstAltRatioParameter(row) {
  const key = compactLftKey(rowName(row));
  return [
    "astalt",
    "astsgotalt",
    "sgotsgpt",
    "sgotsgptratio",
    "astaltratio",
    "astsgptratio",
    "sgotsgptratio"
  ].some((alias) => key.includes(alias));
}

export function isIndirectBilirubinParameter(row) {
  const key = compactLftKey(rowName(row));
  return INDIRECT_BILIRUBIN_ALIASES.map(compactLftKey).includes(key);
}

export function lftSortIndex(row) {
  const key = compactLftKey(rowName(row));
  const index = LFT_FALLBACK_ORDER.findIndex((aliases) => aliases.some((alias) => (
    alias.length <= 3 ? key === alias : key.includes(alias)
  )));
  return index === -1 ? 999 : index;
}

export function calculateIndirectBilirubin(parameters) {
  const totalRow = findByAliases(parameters, TOTAL_BILIRUBIN_ALIASES);
  const directRow = findByAliases(parameters, DIRECT_BILIRUBIN_ALIASES);
  const targetRow = findByAliases(parameters, INDIRECT_BILIRUBIN_ALIASES);
  const total = numberFrom(rowValue(totalRow));
  const direct = numberFrom(rowValue(directRow));
  const precision = rowPrecision(targetRow, 2);
  const base = {
    code: "BILIRUBIN_INDIRECT",
    name: "Bilirubin Indirect",
    calculated: true,
    formula: "Total Bilirubin - Direct Bilirubin",
    sourceParameters: ["BILIRUBIN_TOTAL", "BILIRUBIN_DIRECT"],
    precision
  };
  if (total === null || direct === null) return { ...base, value: "Not available", unavailable: true };
  if (direct > total) return { ...base, value: "Not available", unavailable: true, warning: INDIRECT_BILIRUBIN_WARNING };
  const value = total - direct;
  return { ...base, numericValue: value, value: value.toFixed(precision) };
}

export function calculateGlobulin(parameters) {
  const totalProtein = numberFrom(rowValue(findByAliases(parameters, ["Total Protein", "TOTAL_PROTEIN"])));
  const albumin = numberFrom(rowValue(findByAliases(parameters, ["Albumin", "ALBUMIN"])));
  const targetRow = findByAliases(parameters, ["Globulin", "GLOBULIN"]);
  const precision = rowPrecision(targetRow, 2);
  const base = {
    code: "GLOBULIN",
    name: "Globulin",
    calculated: true,
    formula: "Total Protein - Albumin",
    sourceParameters: ["TOTAL_PROTEIN", "ALBUMIN"],
    precision
  };
  if (totalProtein === null || albumin === null) return { ...base, value: "Not available", unavailable: true };
  return { ...base, numericValue: totalProtein - albumin, value: (totalProtein - albumin).toFixed(precision) };
}

export function calculateAgRatio(parameters) {
  const albumin = numberFrom(rowValue(findByAliases(parameters, ["Albumin", "ALBUMIN"])));
  const globulinCalc = calculateGlobulin(parameters);
  const globulin = globulinCalc.numericValue ?? numberFrom(rowValue(findByAliases(parameters, ["Globulin", "GLOBULIN"])));
  const targetRow = findByAliases(parameters, ["A/G Ratio", "AG Ratio", "A:G Ratio", "ALBUMIN_GLOBULIN_RATIO"]);
  const precision = rowPrecision(targetRow, 2);
  const base = {
    code: "AG_RATIO",
    name: "A/G Ratio",
    calculated: true,
    formula: "Albumin / Globulin",
    sourceParameters: ["ALBUMIN", "GLOBULIN"],
    precision
  };
  if (albumin === null || globulin === null || globulin === 0) return { ...base, value: "Not available", unavailable: true };
  return { ...base, numericValue: albumin / globulin, value: (albumin / globulin).toFixed(precision) };
}

function calculatedResultRow(existingRow, calculation, fallback = {}) {
  const resultValue = calculation.value;
  return {
    ...(existingRow || fallback),
    code: calculation.code,
    name: calculation.name,
    parameterName: existingRow?.parameterName || existingRow?.name || calculation.name,
    resultValue,
    value: resultValue,
    finding: resultValue,
    calculated: true,
    readOnly: true,
    label: "Auto-calculated",
    formula: calculation.formula,
    sourceParameters: calculation.sourceParameters,
    precision: calculation.precision,
    normalRange: existingRow?.normalRange || existingRow?.normal || fallback.normalRange || fallback.normal || "Calculated",
    normal: existingRow?.normal || existingRow?.normalRange || fallback.normal || fallback.normalRange || "Calculated",
    unit: existingRow?.unit || fallback.unit || "",
    method: existingRow?.method || fallback.method || "",
    sample: existingRow?.sample || fallback.sample || "",
    comment: existingRow?.comment || fallback.comment || ""
  };
}

export function applyLftCalculatedParameters(report) {
  const results = Array.isArray(report?.results)
    ? report.results
    : Array.isArray(report?.reportResults)
      ? report.reportResults
      : Array.isArray(report?.parameters)
        ? report.parameters
        : [];
  const bilirubinAliases = [
    ...TOTAL_BILIRUBIN_ALIASES,
    ...DIRECT_BILIRUBIN_ALIASES,
    ...INDIRECT_BILIRUBIN_ALIASES
  ].map(compactLftKey);
  const shouldApply = isLftTest(report) || results.some((row) => bilirubinAliases.includes(compactLftKey(rowName(row))));
  if (!shouldApply) return { ...report, results: results.slice(), lftValidationWarning: "" };

  const withoutAstAltRatio = results.filter((row) => !isAstAltRatioParameter(row));
  const withoutDuplicateIndirect = [];
  let existingIndirect = null;
  withoutAstAltRatio.forEach((row) => {
    if (isIndirectBilirubinParameter(row)) {
      if (!existingIndirect) existingIndirect = row;
      return;
    }
    withoutDuplicateIndirect.push(row);
  });

  const indirect = calculateIndirectBilirubin(withoutAstAltRatio);
  const globulin = calculateGlobulin(withoutAstAltRatio);
  const agRatio = calculateAgRatio(withoutAstAltRatio);
  const fallback = withoutDuplicateIndirect.find((row) => compactLftKey(rowName(row)).includes("bilirubin")) || withoutDuplicateIndirect[0] || {};
  const nextResults = withoutDuplicateIndirect.concat([
    calculatedResultRow(existingIndirect, indirect, {
      ...fallback,
      parameterName: "Bilirubin Indirect",
      name: "Bilirubin Indirect",
      normalRange: existingIndirect?.normalRange || existingIndirect?.normal || "Calculated",
      unit: existingIndirect?.unit || fallback.unit || "mg/dL"
    })
  ]).map((row) => {
    if (compactLftKey(rowName(row)) === "globulin") return calculatedResultRow(row, globulin, row);
    if (["agratio", "albuminglobulinratio"].includes(compactLftKey(rowName(row)))) return calculatedResultRow(row, agRatio, row);
    return row;
  });

  return {
    ...report,
    results: nextResults,
    lftValidationWarning: indirect.warning || ""
  };
}
