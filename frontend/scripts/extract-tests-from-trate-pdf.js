const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "database", "TRate.pdf");
const outputPath = path.join(root, "data", "trate-tests.json");

function normalizeText(value, fallback = "") {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || fallback;
}

function slug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

function testCode(sno) {
  return `KT${String(sno).padStart(4, "0")}`;
}

function readPdfRows(pdfPath) {
const py = `
import json, sys
import pdfplumber

def clean_name(value):
    text = " ".join(str(value or "").split())
    text = text.replace("RESIST ANCE", "RESISTANCE")
    text = text.replace("(PO C)", "(POC)")
    text = text.replace("6C3h0ro0mosomes", "Chromosomes")
    return text

def parse_row(row, page_lines):
    sno = str(row[0] or "").strip()
    if not sno.isdigit():
        return None
    name_cell = " ".join(str(row[1] or "").split())
    rate_cell = " ".join(str(row[2] or "").split()) if len(row) > 2 else ""
    name = clean_name(name_cell)
    rate = rate_cell.replace(",", "")
    if rate.isdigit():
        return {"sno": int(sno), "name": name, "price": float(rate)}
    combined = clean_name((name_cell + " " + rate_cell).strip())
    parts = combined.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return {"sno": int(sno), "name": parts[0], "price": float(parts[1])}
    line = next((item for item in page_lines if item.startswith(sno + " ")), "")
    if sno == "251" and line:
        return {
            "sno": 251,
            "name": "FISH & Cytogenetics(Aneuploidy Detection Products Of Conception (POC) Using Chromosomes 13 18 21 X & Y)",
            "price": 6300.0
        }
    digits = "".join(ch for ch in rate if ch.isdigit())
    if digits:
        return {"sno": int(sno), "name": combined, "price": float(digits)}
    return None

rows = []
with pdfplumber.open(sys.argv[1]) as pdf:
    for page in pdf.pages:
        page_lines = (page.extract_text() or "").splitlines()
        for table in page.extract_tables() or []:
            for row in table:
                if not row or len(row) < 3:
                    continue
                parsed = parse_row(row, page_lines)
                if parsed and parsed["name"]:
                    rows.append(parsed)
print(json.dumps(rows, ensure_ascii=False))
`;
  const result = spawnSync("python3", ["-c", py, pdfPath], { encoding: "utf8", maxBuffer: 1024 * 1024 * 20 });
  if (result.status !== 0) {
    throw new Error(result.stderr || "Could not extract TRate.pdf. Install pdfplumber with: python3 -m pip install pdfplumber");
  }
  return JSON.parse(result.stdout);
}

if (!fs.existsSync(inputPath)) {
  throw new Error(`Missing input PDF: ${inputPath}`);
}

const rows = readPdfRows(inputPath);
const seenNames = new Map();
const tests = rows.map((row) => {
  const sno = Number(row.sno);
  const name = normalizeText(row.name);
  const lower = name.toLowerCase();
  seenNames.set(lower, (seenNames.get(lower) || 0) + 1);
  const code = testCode(sno);
  return {
    sno,
    name,
    price: Number(row.price || 0),
    nameLower: lower,
    testCode: code,
    slug: slug(`${code}-${name}`)
  };
}).sort((a, b) => a.sno - b.sno);

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(tests, null, 2) + "\n");

const duplicates = Array.from(seenNames.entries())
  .filter(([, count]) => count > 1)
  .map(([name, count]) => ({ name, count }));

console.log(`Total TRate tests extracted: ${tests.length}`);
console.log(`First 10: ${tests.slice(0, 10).map((test) => test.name).join(" | ")}`);
console.log(`Last 10: ${tests.slice(-10).map((test) => test.name).join(" | ")}`);
console.log(`Duplicate names: ${duplicates.length}`);
duplicates.slice(0, 10).forEach((item) => console.log(`- ${item.name}: ${item.count}`));
console.log(`Wrote ${path.relative(process.cwd(), outputPath)}`);
