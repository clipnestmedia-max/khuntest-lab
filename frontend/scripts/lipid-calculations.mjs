const TOTAL_CHOLESTEROL_ALIASES = [
  "Total Cholesterol",
  "TOTAL_CHOLESTEROL",
  "Cholesterol Total",
  "T. Cholesterol",
  "TC"
];

const HDL_ALIASES = [
  "HDL Cholesterol - Direct",
  "HDL Cholesterol",
  "HDL_CHOLESTEROL",
  "HDL-C",
  "HDL"
];

const LDL_ALIASES = [
  "LDL Cholesterol - Direct",
  "LDL Cholesterol",
  "LDL_CHOLESTEROL",
  "LDL-C",
  "LDL"
];

const TRIGLYCERIDES_ALIASES = [
  "Triglycerides",
  "TRIGLYCERIDES",
  "TG"
];

const VLDL_ALIASES = ["VLDL Cholesterol", "VLDL_CHOLESTEROL", "VLDL"];
const NON_HDL_ALIASES = ["Non-HDL Cholesterol", "Non HDL Cholesterol", "NON_HDL_CHOLESTEROL"];
const TC_HDL_RATIO_ALIASES = ["TC/ HDL Cholesterol Ratio", "TC/HDL Ratio", "TC HDL Ratio", "Cholesterol/HDL Ratio"];
const TRIG_HDL_RATIO_ALIASES = ["TRIG/ HDL Ratio", "Triglycerides/HDL Ratio", "TG/HDL Ratio"];
const LDL_HDL_RATIO_ALIASES = ["LDL/ HDL Ratio", "LDL/HDL Ratio"];
const HDL_LDL_RATIO_ALIASES = ["HDL/ LDL Ratio", "HDL/LDL Ratio"];

export function compactLipidKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function rowName(row) {
  return row?.code || row?.parameterCode || row?.parameter_code || row?.name || row?.parameterName || row?.parameter_name || row?.parameter || "";
}

function rowValue(row) {
  return row?.value ?? row?.finding ?? row?.resultValue ?? row?.result_value ?? row?.result ?? "";
}

function rowPrecision(row, fallback) {
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
  const aliasKeys = aliases.map(compactLipidKey);
  return parameters.find((row) => aliasKeys.includes(compactLipidKey(rowName(row))));
}

export function isLipidProfileTest(report) {
  const text = [
    report?.testName,
    report?.name,
    report?.testCode,
    report?.category,
    ...(Array.isArray(report?.tests) ? report.tests.map((test) => `${test?.name || ""} ${test?.testName || ""} ${test?.testCode || ""}`) : [])
  ].join(" ").toLowerCase();
  return text.includes("lipid profile") || text.includes("lipid panel");
}

function calculatedValue(name, code, formula, sourceParameters, precision, numericValue) {
  const base = { code, name, calculated: true, formula, sourceParameters, precision };
  if (numericValue === null || !Number.isFinite(numericValue)) return { ...base, value: "Not available", unavailable: true };
  return { ...base, numericValue, value: numericValue.toFixed(precision) };
}

// Standard Friedewald-derived estimate; only valid when triglycerides are
// under ~400 mg/dL (chylomicronemia invalidates it), matching the caveat
// every Indian lab prints under this line on a report.
export function calculateVldl(parameters) {
  const triglycerides = numberFrom(rowValue(findByAliases(parameters, TRIGLYCERIDES_ALIASES)));
  const targetRow = findByAliases(parameters, VLDL_ALIASES);
  const precision = rowPrecision(targetRow, 0);
  const numericValue = triglycerides === null ? null : triglycerides / 5;
  return calculatedValue("VLDL", "VLDL_CHOLESTEROL", "Triglycerides / 5", ["TRIGLYCERIDES"], precision, numericValue);
}

export function calculateNonHdl(parameters) {
  const totalCholesterol = numberFrom(rowValue(findByAliases(parameters, TOTAL_CHOLESTEROL_ALIASES)));
  const hdl = numberFrom(rowValue(findByAliases(parameters, HDL_ALIASES)));
  const targetRow = findByAliases(parameters, NON_HDL_ALIASES);
  const precision = rowPrecision(targetRow, 0);
  const numericValue = totalCholesterol === null || hdl === null ? null : totalCholesterol - hdl;
  return calculatedValue("Non-HDL Cholesterol", "NON_HDL_CHOLESTEROL", "Total Cholesterol - HDL Cholesterol", ["TOTAL_CHOLESTEROL", "HDL_CHOLESTEROL"], precision, numericValue);
}

export function calculateTcHdlRatio(parameters) {
  const totalCholesterol = numberFrom(rowValue(findByAliases(parameters, TOTAL_CHOLESTEROL_ALIASES)));
  const hdl = numberFrom(rowValue(findByAliases(parameters, HDL_ALIASES)));
  const targetRow = findByAliases(parameters, TC_HDL_RATIO_ALIASES);
  const precision = rowPrecision(targetRow, 1);
  const numericValue = totalCholesterol === null || !hdl ? null : totalCholesterol / hdl;
  return calculatedValue("TC/ HDL Cholesterol Ratio", "TC_HDL_RATIO", "Total Cholesterol / HDL Cholesterol", ["TOTAL_CHOLESTEROL", "HDL_CHOLESTEROL"], precision, numericValue);
}

export function calculateTrigHdlRatio(parameters) {
  const triglycerides = numberFrom(rowValue(findByAliases(parameters, TRIGLYCERIDES_ALIASES)));
  const hdl = numberFrom(rowValue(findByAliases(parameters, HDL_ALIASES)));
  const targetRow = findByAliases(parameters, TRIG_HDL_RATIO_ALIASES);
  const precision = rowPrecision(targetRow, 2);
  const numericValue = triglycerides === null || !hdl ? null : triglycerides / hdl;
  return calculatedValue("TRIG/ HDL Ratio", "TRIG_HDL_RATIO", "Triglycerides / HDL Cholesterol", ["TRIGLYCERIDES", "HDL_CHOLESTEROL"], precision, numericValue);
}

export function calculateLdlHdlRatio(parameters) {
  const ldl = numberFrom(rowValue(findByAliases(parameters, LDL_ALIASES)));
  const hdl = numberFrom(rowValue(findByAliases(parameters, HDL_ALIASES)));
  const targetRow = findByAliases(parameters, LDL_HDL_RATIO_ALIASES);
  const precision = rowPrecision(targetRow, 1);
  const numericValue = ldl === null || !hdl ? null : ldl / hdl;
  return calculatedValue("LDL/ HDL Ratio", "LDL_HDL_RATIO", "LDL Cholesterol / HDL Cholesterol", ["LDL_CHOLESTEROL", "HDL_CHOLESTEROL"], precision, numericValue);
}

export function calculateHdlLdlRatio(parameters) {
  const ldl = numberFrom(rowValue(findByAliases(parameters, LDL_ALIASES)));
  const hdl = numberFrom(rowValue(findByAliases(parameters, HDL_ALIASES)));
  const targetRow = findByAliases(parameters, HDL_LDL_RATIO_ALIASES);
  const precision = rowPrecision(targetRow, 2);
  const numericValue = hdl === null || !ldl ? null : hdl / ldl;
  return calculatedValue("HDL/ LDL Ratio", "HDL_LDL_RATIO", "HDL Cholesterol / LDL Cholesterol", ["HDL_CHOLESTEROL", "LDL_CHOLESTEROL"], precision, numericValue);
}

const CALCULATED_TARGETS = [
  { aliases: VLDL_ALIASES, calculate: calculateVldl, unit: "mg/dL" },
  { aliases: NON_HDL_ALIASES, calculate: calculateNonHdl, unit: "mg/dL" },
  { aliases: TC_HDL_RATIO_ALIASES, calculate: calculateTcHdlRatio, unit: "Ratio" },
  { aliases: TRIG_HDL_RATIO_ALIASES, calculate: calculateTrigHdlRatio, unit: "Ratio" },
  { aliases: LDL_HDL_RATIO_ALIASES, calculate: calculateLdlHdlRatio, unit: "Ratio" },
  { aliases: HDL_LDL_RATIO_ALIASES, calculate: calculateHdlLdlRatio, unit: "Ratio" }
];

function calculatedResultRow(existingRow, calculation, unit) {
  const resultValue = calculation.value;
  return {
    ...existingRow,
    code: calculation.code,
    name: existingRow?.parameterName || existingRow?.name || calculation.name,
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
    normalRange: existingRow?.normalRange || existingRow?.normal || "Calculated",
    normal: existingRow?.normal || existingRow?.normalRange || "Calculated",
    unit: existingRow?.unit || unit
  };
}

export function applyLipidCalculatedParameters(report) {
  const results = Array.isArray(report?.results)
    ? report.results
    : Array.isArray(report?.reportResults)
      ? report.reportResults
      : Array.isArray(report?.parameters)
        ? report.parameters
        : [];
  if (!isLipidProfileTest(report)) return { ...report, results: results.slice() };

  const nextResults = results.map((row) => {
    const key = compactLipidKey(rowName(row));
    const target = CALCULATED_TARGETS.find((t) => t.aliases.map(compactLipidKey).includes(key));
    if (!target) return row;
    return calculatedResultRow(row, target.calculate(results), target.unit);
  });

  return { ...report, results: nextResults };
}
