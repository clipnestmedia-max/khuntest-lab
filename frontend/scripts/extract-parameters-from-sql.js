const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "database", "khuntest_lab_backup.sql");
const outputPath = path.join(root, "data", "sql-test-parameters.json");

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
    if (ch === "'") inString = true;
    else if (ch === "(") {
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
    const columns = [];
    match[2].split(/\n/).forEach((line) => {
      const col = line.trim().match(/^`([^`]+)`\s+/);
      if (col) columns.push(col[1]);
    });
    tables.set(match[1], columns);
  }
  return tables;
}

function parseInserts(sql, schemas) {
  const data = new Map();
  const re = /INSERT INTO `([^`]+)`(?:\s*\(([\s\S]*?)\))?\s+VALUES\s+([\s\S]*?);/g;
  let match;
  while ((match = re.exec(sql))) {
    const table = match[1];
    const explicitCols = match[2];
    const values = match[3];
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
  return {
    name: normalizeText(pick(row, ["parameter_name", "parameter", "name"], "Result"), "Result"),
    normalRange: normalizeText(pick(row, ["normal_range", "normal_value", "reference_range"], "As per lab method / reference range"), "As per lab method / reference range"),
    unit: normalizeText(pick(row, ["unit", "units"], "")),
    method: normalizeText(pick(row, ["method", "method_name"], "")),
    sample: normalizeText(pick(row, ["sample", "sample_type"], sample)),
    sortOrder: Number(pick(row, ["sort_order", "order"], 1) || 1)
  };
}

if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing SQL backup: ${inputPath}`);
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
paramsTable.forEach((row) => {
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
});

const tests = testsTable.map((row) => {
  const sourceId = pick(row, ["id"], "");
  const name = normalizeText(pick(row, ["test_name", "name"], sourceId), sourceId);
  const sample = normalizeText(pick(row, ["sample", "sample_type"], ""));
  const rawParams = [
    ...(paramsByTestId.get(String(sourceId)) || []),
    ...(paramsByName.get(name.toLowerCase()) || [])
  ];
  const seen = new Set();
  const parameters = rawParams
    .map((param) => parameterFrom(param, name, sample))
    .filter((param) => {
      const key = `${param.name}|${param.normalRange}|${param.unit}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder);
  return {
    sourceId,
    name,
    category: normalizeCategory(pick(row, ["category", "department", "section"], "Lab Test")),
    sample,
    method: normalizeText(pick(row, ["method", "method_name"], "")),
    price: Number(pick(row, ["price_inr", "price", "rate", "amount"], 0) || 0),
    parameters
  };
});

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(tests, null, 2) + "\n");

const totalParams = tests.reduce((sum, test) => sum + test.parameters.length, 0);
const multiple = tests.filter((test) => test.parameters.length > 1).length;
const without = tests.filter((test) => !test.parameters.length).length;

console.log(`Total SQL tests: ${tests.length}`);
console.log(`Total SQL parameters: ${totalParams}`);
console.log(`Tests with multiple parameters: ${multiple}`);
console.log(`Tests without parameters: ${without}`);
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
