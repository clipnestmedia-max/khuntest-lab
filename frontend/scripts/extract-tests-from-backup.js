const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "database", "khuntest_lab_backup.sql");
const outputPath = path.join(root, "data", "tests.json");

function extractInsert(sql, table) {
  const match = sql.match(new RegExp(`INSERT INTO \`${table}\` VALUES ([\\s\\S]*?);`));
  if (!match) throw new Error(`No INSERT data found for ${table}`);
  return match[1];
}

function parseValue(token) {
  const text = token.trim();
  if (text === "NULL") return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseTuples(input) {
  const rows = [];
  let row = null;
  let token = "";
  let inString = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];

    if (inString) {
      if (ch === "\\" && i + 1 < input.length) {
        const escapes = { "0": "\0", b: "\b", n: "\n", r: "\r", t: "\t", Z: "\x1a" };
        token += escapes[next] ?? next;
        i++;
      } else if (ch === "'" && next === "'") {
        token += "'";
        i++;
      } else if (ch === "'") {
        inString = false;
      } else {
        token += ch;
      }
      continue;
    }

    if (ch === "'") {
      inString = true;
    } else if (ch === "(") {
      row = [];
      token = "";
    } else if (ch === "," && row) {
      row.push(parseValue(token));
      token = "";
    } else if (ch === ")" && row) {
      row.push(parseValue(token));
      rows.push(row);
      row = null;
      token = "";
    } else if (row) {
      token += ch;
    }
  }

  return rows;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function keywords(...values) {
  const words = new Set();
  values
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1)
    .forEach((word) => words.add(word));
  return Array.from(words);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

const sql = fs.readFileSync(inputPath, "utf8");
const testRows = parseTuples(extractInsert(sql, "tests"));
const parameterRows = parseTuples(extractInsert(sql, "test_parameters"));

const byTestId = new Map();
for (const row of parameterRows) {
  const [id, testId, testName, parameterName, normalValue, unit, sortOrder] = row;
  if (!byTestId.has(testId)) byTestId.set(testId, []);
  byTestId.get(testId).push({
    id,
    testId,
    testName: normalizeText(testName),
    parameterName: normalizeText(parameterName),
    normalValue: normalizeText(normalValue),
    unit: normalizeText(unit),
    sortOrder: Number(sortOrder || 0)
  });
}

const tests = testRows
  .map((row) => {
    const [sourceId, name, category, price, description, isActive] = row;
    const parameters = (byTestId.get(sourceId) || []).sort((a, b) => a.sortOrder - b.sortOrder);
    const cleanName = normalizeText(name);
    const testCode = String(sourceId);
    const cleanCategory = normalizeText(category) || "Lab Test";
    const sample = "";
    return {
      sourceId,
      testCode,
      slug: slug(`${testCode}-${cleanName}`),
      name: cleanName,
      nameLower: cleanName.toLowerCase(),
      category: cleanCategory,
      price: Number(price || 0),
      sample,
      reportTime: "Same Day",
      description: normalizeText(description),
      isActive: isActive !== 0,
      parameters: parameters.map((parameter) => ({
        name: parameter.parameterName,
        normalRange: parameter.normalValue,
        unit: parameter.unit,
        method: "",
        sample,
        sortOrder: parameter.sortOrder
      })),
      searchKeywords: keywords(testCode, cleanName, cleanCategory)
    };
  })
  .sort((a, b) => a.sourceId - b.sourceId);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(tests, null, 2) + "\n");

const parameterCount = tests.reduce((sum, test) => sum + test.parameters.length, 0);
const withoutParameters = tests.filter((test) => !test.parameters.length);
console.log(`Extracted ${tests.length} tests and ${parameterCount} parameters to ${path.relative(process.cwd(), outputPath)}`);
console.log(`Tests without parameters: ${withoutParameters.length}`);
console.log("First 10 sample tests:");
tests.slice(0, 10).forEach((test) => {
  console.log(`- ${test.testCode}: ${test.name} (${test.parameters.length} parameters)`);
});
