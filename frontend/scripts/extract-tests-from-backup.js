const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "database", "khuntest_lab_backup.sql");
const outputPath = path.join(root, "data", "tests.json");

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function normalizeCategory(value) {
  const text = normalizeText(value, "Lab Test");
  return text
    .split(/[\s/_-]+/)
    .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1).toLowerCase() : "")
    .join(" ")
    .replace(/\bAnd\b/g, "&");
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

function parseValue(token) {
  const text = token.trim();
  if (/^NULL$/i.test(text)) return null;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return text;
}

function parseTuples(input) {
  const rows = [];
  let row = null;
  let token = "";
  let inString = false;
  let depth = 0;

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
      if (!row) {
        row = [];
        token = "";
        depth = 1;
      } else {
        depth++;
        token += ch;
      }
    } else if (ch === ")" && row) {
      depth--;
      if (depth === 0) {
        row.push(parseValue(token));
        rows.push(row);
        row = null;
        token = "";
      } else {
        token += ch;
      }
    } else if (ch === "," && row && depth === 1) {
      row.push(parseValue(token));
      token = "";
    } else if (row) {
      token += ch;
    }
  }

  return rows;
}

function parseCreateTables(sql) {
  const tables = new Map();
  const re = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\)\s*ENGINE=/g;
  let match;
  while ((match = re.exec(sql))) {
    const [, table, body] = match;
    const columns = [];
    body.split(/\n/).forEach((line) => {
      const col = line.trim().match(/^`([^`]+)`\s+/);
      if (col) columns.push(col[1]);
    });
    tables.set(table, columns);
  }
  return tables;
}

function parseInserts(sql, schemas) {
  const data = new Map();
  const re = /INSERT INTO `([^`]+)`(?:\s*\(([\s\S]*?)\))?\s+VALUES\s+([\s\S]*?);/g;
  let match;
  while ((match = re.exec(sql))) {
    const [, table, explicitCols, values] = match;
    const columns = explicitCols
      ? [...explicitCols.matchAll(/`([^`]+)`/g)].map((m) => m[1])
      : (schemas.get(table) || []);
    const rows = parseTuples(values).map((tuple) => {
      const row = {};
      tuple.forEach((value, index) => {
        row[columns[index] || `col_${index}`] = value;
      });
      return row;
    });
    if (!data.has(table)) data.set(table, []);
    data.get(table).push(...rows);
  }
  return data;
}

function pick(row, keys, fallback = "") {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== "") return row[key];
  }
  return fallback;
}

function parameterFrom(row, testName, sample) {
  const name = normalizeText(pick(row, ["parameter_name", "parameter", "name"], testName), testName);
  return {
    name,
    normalRange: normalizeText(pick(row, ["normal_range", "normal_value", "reference_range"], "As per lab method / reference range"), "As per lab method / reference range"),
    unit: normalizeText(pick(row, ["unit", "units"], "")),
    method: normalizeText(pick(row, ["method", "method_name"], "")),
    sample: normalizeText(pick(row, ["sample", "sample_type"], sample)),
    sortOrder: Number(pick(row, ["sort_order", "order"], 1) || 1)
  };
}

const sql = fs.readFileSync(inputPath, "utf8");
const schemas = parseCreateTables(sql);
const data = parseInserts(sql, schemas);
const testsTable = data.get("tests") || [];
const paramsTable = [
  ...(data.get("test_parameters") || []),
  ...(data.get("parameters") || [])
];

const paramsByTestId = new Map();
const paramsByName = new Map();
for (const row of paramsTable) {
  const testId = pick(row, ["test_id", "test_code"], "");
  const testName = normalizeText(pick(row, ["test_name"], ""));
  if (testId !== "") {
    const key = String(testId);
    if (!paramsByTestId.has(key)) paramsByTestId.set(key, []);
    paramsByTestId.get(key).push(row);
  }
  if (testName) {
    const key = testName.toLowerCase();
    if (!paramsByName.has(key)) paramsByName.set(key, []);
    paramsByName.get(key).push(row);
  }
}

const tests = testsTable.map((row) => {
  const sourceId = pick(row, ["id"], "");
  const testCode = normalizeText(pick(row, ["test_code", "code", "id"], sourceId));
  const name = normalizeText(pick(row, ["test_name", "name"], testCode), testCode);
  const sample = normalizeText(pick(row, ["sample", "sample_type"], ""));
  const category = normalizeCategory(pick(row, ["category", "department", "section"], "Lab Test"));
  const reportTime = normalizeText(pick(row, ["report_time", "time"], "Same Day"), "Same Day");
  const price = Number(pick(row, ["price_inr", "price", "rate", "amount"], 0) || 0);
  const rawParams = [
    ...(paramsByTestId.get(String(sourceId)) || []),
    ...(paramsByTestId.get(String(testCode)) || []),
    ...(paramsByName.get(name.toLowerCase()) || [])
  ];
  const seenParams = new Set();
  let parameters = rawParams
    .map((param) => parameterFrom(param, name, sample))
    .filter((param) => {
      const key = `${param.name}|${param.normalRange}|${param.unit}`.toLowerCase();
      if (seenParams.has(key)) return false;
      seenParams.add(key);
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (!parameters.length) {
    parameters = [parameterFrom({ parameter_name: name }, name, sample)];
  }
  return {
    sourceId,
    testCode,
    slug: slug(`${testCode}-${name}`),
    name,
    nameLower: name.toLowerCase(),
    category,
    price,
    sample,
    reportTime,
    isActive: pick(row, ["is_active"], 1) !== 0,
    parameters,
    searchKeywords: keywords(testCode, name, category, ...parameters.map((p) => p.name))
  };
}).sort((a, b) => String(a.name).localeCompare(String(b.name)));

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(tests, null, 2) + "\n");

const parameterCount = tests.reduce((sum, test) => sum + test.parameters.length, 0);
const withoutParameters = tests.filter((test) => !test.parameters.length);
const categories = Array.from(new Set(tests.map((test) => test.category))).sort();

console.log(`Total tests extracted: ${tests.length}`);
console.log(`Total parameters extracted: ${parameterCount}`);
console.log(`Tests without parameters: ${withoutParameters.length}`);
console.log("First 10 test names:");
tests.slice(0, 10).forEach((test) => console.log(`- ${test.name}`));
console.log(`Categories found (${categories.length}): ${categories.join(", ")}`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
