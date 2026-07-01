const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const tratePath = path.join(root, "data", "trate-tests.json");
const sqlPath = path.join(root, "data", "sql-test-parameters.json");
const testsPath = path.join(root, "data", "tests.json");
const reviewPath = path.join(root, "data", "missing-parameters-review.csv");
const summaryPath = path.join(root, "data", "import-summary.json");
const PLACEHOLDER_RANGE = "As per lab method / reference range";

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function key(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\btest\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactKey(value) {
  return key(value).replace(/\s+/g, "");
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function keywords(...values) {
  return Array.from(new Set(values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)));
}

function inferCategory(name, fallback = "Lab Test") {
  const text = name.toLowerCase();
  if (/culture|sensitivity|c\s*\+\s*s|c and s/.test(text)) return "Microbiology";
  if (/biopsy|cytology|histopath|fnac|pap smear|malignant|ihc|slide|block/.test(text)) return "Histopathology";
  if (/cbc|haem|hemoglobin|platelet|rbc|wbc|coag|pt |aptt|blood group|thalassemia/.test(text)) return "Hematology";
  if (/hiv|hbs|hcv|hepatitis|torch|rubella|typhi|widal|dengue|malaria|antibody|igg|igm|iga|ige|ana|anca/.test(text)) return "Serology";
  if (/thyroid|t3|t4|tsh|hormone|insulin|cortisol|testosterone|prolactin|amh|lh|fsh|progesterone|estradiol/.test(text)) return "Hormones";
  if (/urine|stool|semen|sputum|fluid|csf|swab/.test(text)) return "Clinical Pathology";
  if (/sugar|glucose|liver|kidney|renal|lipid|cholesterol|bilirubin|creatinine|urea|uric|electrolyte|sodium|potassium|calcium|enzyme|protein|albumin|iron|vitamin/.test(text)) return "Biochemistry";
  if (/panel|profile|package|aarogyam|satyamev|health/.test(text)) return "Health Package";
  return fallback || "Lab Test";
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const trateTests = readJson(tratePath);
const sqlTests = readJson(sqlPath);
const sqlByKey = new Map();
const sqlByCompactKey = new Map();

sqlTests.forEach((test) => {
  const exact = key(test.name);
  const compact = compactKey(test.name);
  if (exact && !sqlByKey.has(exact)) sqlByKey.set(exact, test);
  if (compact && !sqlByCompactKey.has(compact)) sqlByCompactKey.set(compact, test);
});

const aliases = new Map([
  ["cbc", ["complete blood count", "complete haemogram"]],
  ["kft", ["kidney function test", "renal profile", "renal function test"]],
  ["lft", ["liver function test"]],
  ["lipid profile", ["advance lipid apo a apo b lipo"]],
  ["thyroid profile", ["t3 t4 tsh", "thyroid function test"]],
  ["ft3", ["free t3"]],
  ["ft4", ["free t4"]]
]);

function findSqlTest(test) {
  const exact = key(test.name);
  const compact = compactKey(test.name);
  if (sqlByKey.has(exact)) return { match: sqlByKey.get(exact), matchType: "exact" };
  if (sqlByCompactKey.has(compact)) return { match: sqlByCompactKey.get(compact), matchType: "compact" };
  const aliasList = aliases.get(exact) || aliases.get(compact) || [];
  for (const alias of aliasList) {
    if (sqlByKey.has(key(alias))) return { match: sqlByKey.get(key(alias)), matchType: "alias" };
    if (sqlByCompactKey.has(compactKey(alias))) return { match: sqlByCompactKey.get(compactKey(alias)), matchType: "alias" };
  }
  return { match: null, matchType: "missing" };
}

const reviewRows = [["sno", "testCode", "name", "price", "reason"]];
let matchedWithSqlParams = 0;

const finalTests = trateTests.map((test) => {
  const { match, matchType } = findSqlTest(test);
  const hasSqlParams = Boolean(match && Array.isArray(match.parameters) && match.parameters.length);
  const parameters = hasSqlParams
    ? match.parameters.map((param, index) => ({
        name: normalizeText(param.name, "Result"),
        normalRange: normalizeText(param.normalRange, PLACEHOLDER_RANGE),
        unit: normalizeText(param.unit, ""),
        method: normalizeText(param.method || match.method, ""),
        sample: normalizeText(param.sample || match.sample, ""),
        sortOrder: Number(param.sortOrder || index + 1)
      }))
    : [{
        name: "Result",
        normalRange: PLACEHOLDER_RANGE,
        unit: "",
        method: "",
        sample: "",
        sortOrder: 1
      }];
  if (hasSqlParams) matchedWithSqlParams++;
  if (!hasSqlParams) reviewRows.push([test.sno, test.testCode, test.name, test.price, "No matching SQL parameter record"]);
  const category = inferCategory(test.name, match?.category || "Lab Test");
  const sample = normalizeText(match?.sample || parameters.find((param) => param.sample)?.sample || "");
  return {
    sno: Number(test.sno),
    testCode: test.testCode,
    slug: slug(`${test.testCode}-${test.name}`),
    name: test.name,
    nameLower: test.nameLower || test.name.toLowerCase(),
    category,
    price: Number(test.price || 0),
    sample,
    reportTime: "Same Day",
    isActive: true,
    parameters,
    searchKeywords: keywords(test.testCode, test.name, category, sample, ...parameters.map((param) => param.name)),
    needsParameterReview: !hasSqlParams,
    source: {
      rateList: "TRate.pdf",
      sqlSourceId: match?.sourceId || null,
      parameterMatch: matchType
    }
  };
});

const summary = {
  trateTests: trateTests.length,
  sqlTests: sqlTests.length,
  finalTests: finalTests.length,
  testsWithSqlParameters: matchedWithSqlParams,
  testsNeedingParameterReview: finalTests.filter((test) => test.needsParameterReview).length,
  totalParameters: finalTests.reduce((sum, test) => sum + test.parameters.length, 0),
  outputPaths: {
    tests: path.relative(root, testsPath),
    missingParameterReview: path.relative(root, reviewPath),
    importSummary: path.relative(root, summaryPath)
  }
};

fs.writeFileSync(testsPath, JSON.stringify(finalTests, null, 2) + "\n");
fs.writeFileSync(reviewPath, reviewRows.map((row) => row.map(csvEscape).join(",")).join("\n") + "\n");
fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n");

console.log(`Total final tests: ${summary.finalTests}`);
console.log(`Tests with SQL parameters: ${summary.testsWithSqlParameters}`);
console.log(`Tests needing parameter review: ${summary.testsNeedingParameterReview}`);
console.log(`Total final parameters: ${summary.totalParameters}`);
console.log(`Wrote ${path.relative(process.cwd(), testsPath)}`);
console.log(`Wrote ${path.relative(process.cwd(), reviewPath)}`);
console.log(`Wrote ${path.relative(process.cwd(), summaryPath)}`);
