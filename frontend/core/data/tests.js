// Per-laboratory test catalogue.
//
// Each laboratory owns a full copy of the catalogue at /labs/{labId}/tests, so
// ABC Diagnostic can price CBC at Rs 300 while City Pathology prices it at
// Rs 250 with neither touching the other. The 677-test KhunTest catalogue in
// database/seed-test-catalogue.json is the default starting point that
// onboarding clones into a new lab.
import { getDocs, getDoc, setDoc, updateDoc, deleteDoc, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId, getLabId } from "../tenant.js";
import { cached, cacheDrop, CACHE_TTL, snapshotRows, buildSearchTokens, toNumber, clean } from "./helpers.js";

export const TEST_CATEGORIES = Object.freeze([
  "Hematology", "Biochemistry", "Serology", "Immunology", "Microbiology",
  "Clinical Pathology", "Hormones", "Thyroid", "Liver", "Kidney", "Cardiac",
  "Diabetes", "Vitamin", "Infection", "Fertility", "Cancer Marker",
  "Urine", "Stool", "Blood", "Culture", "Histopathology",
  "Health Package", "Lab Test"
]);

export const SAMPLE_TYPES = Object.freeze([
  "Whole Blood (EDTA)", "Serum", "Plasma", "Urine", "Stool", "Swab",
  "Sputum", "Tissue", "Fluid", "Semen", "Other"
]);

/** Normalise one catalogue document into the shape the whole app expects. */
export function normalizeTest(id, data = {}) {
  const parameters = Array.isArray(data.parameters) ? data.parameters : [];
  return {
    id,
    testCode: data.testCode || id,
    name: data.name || data.testName || "",
    nameLower: (data.nameLower || data.name || "").toLowerCase(),
    shortName: data.shortName || "",
    slug: data.slug || "",
    category: data.category || "Lab Test",
    department: data.department || data.category || "Lab Test",
    sample: data.sample || data.sampleType || "",
    price: toNumber(data.price),
    mrp: toNumber(data.mrp || data.price),
    reportTime: data.reportTime || "",
    method: data.method || "",
    notes: data.notes || "",
    isActive: data.isActive !== false,
    isPackage: data.isPackage === true || data.category === "Health Package",
    packageTestIds: Array.isArray(data.packageTestIds) ? data.packageTestIds : [],
    parameters: parameters.map((p, index) => normalizeParameter(p, index)),
    searchKeywords: Array.isArray(data.searchKeywords) ? data.searchKeywords : [],
    sortOrder: toNumber(data.sortOrder, index0(data)),
    labId: data.labId || getLabId()
  };
}

function index0(data) { return toNumber(data.sno, 0); }

/**
 * One measurable line of a test. The KhunTest catalogue only carried a single
 * `normalRange` string; the white-label schema adds explicit male / female /
 * child ranges (spec section 8) while still accepting the old field so the
 * existing 677 tests import unchanged.
 */
export function normalizeParameter(p = {}, index = 0) {
  return {
    parameterId: p.parameterId || p.code || `P${index + 1}`,
    code: p.code || "",
    name: p.name || p.parameterName || "",
    unit: p.unit || "",
    normalRange: p.normalRange || p.referenceRange || "",
    rangeMale: p.rangeMale || "",
    rangeFemale: p.rangeFemale || "",
    rangeChild: p.rangeChild || "",
    lowValue: p.lowValue ?? null,
    highValue: p.highValue ?? null,
    criticalLow: p.criticalLow ?? null,
    criticalHigh: p.criticalHigh ?? null,
    method: p.method || "",
    sample: p.sample || "",
    notes: p.notes || "",
    type: p.type || (p.isHeading ? "heading" : "value"),
    isHeading: p.type === "heading" || p.isHeading === true,
    sortOrder: toNumber(p.sortOrder, index + 1)
  };
}

// rangeForPatient() lives in core/flags.js alongside the flagging logic it
// feeds. Imported for local use AND re-exported for existing callers - a bare
// `export ... from` would forward the name without binding it here, so calling
// it in this file would throw at runtime.
import { rangeForPatient } from "../flags.js";
export { rangeForPatient };

/** Load the whole catalogue for the active lab (cached 10 minutes). */
export async function loadTests({ activeOnly = true, force = false } = {}) {
  const key = `tests:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CACHE_TTL.tests, async () => {
    const snap = await getDocs(col("tests"));
    const rows = snap.docs
      .map((d) => normalizeTest(d.id, d.data()))
      .filter((t) => (activeOnly ? t.isActive : true));
    rows.sort((a, b) => a.name.localeCompare(b.name));
    return rows;
  });
}

/** Lightweight rows for the booking screen - no parameters, so it stays fast. */
export async function loadTestSummaries({ activeOnly = true, force = false } = {}) {
  const key = `testSummaries:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CACHE_TTL.testSummaries, async () => {
    const tests = await loadTests({ activeOnly, force });
    return tests.map(({ id, testCode, name, nameLower, shortName, category, price, sample, reportTime, isPackage, searchKeywords }) =>
      ({ id, testCode, name, nameLower, shortName, category, price, sample, reportTime, isPackage, searchKeywords }));
  });
}

export async function getTest(testId) {
  const snap = await getDoc(docRef("tests", testId));
  return snap.exists() ? normalizeTest(snap.id, snap.data()) : null;
}

/**
 * Client-side catalogue search across name, short name, code and category.
 * Ranked so an exact code or a name that STARTS with the query wins - typing
 * "cbc" must put CBC first, not "Anti-CCB Antibody".
 */
export function searchTests(tests, queryText = "", category = "") {
  const q = String(queryText || "").trim().toLowerCase();
  const cat = String(category || "").trim().toLowerCase();
  let rows = tests;
  if (cat) rows = rows.filter((t) => String(t.category).toLowerCase() === cat);
  if (!q) return rows.slice(0, 400);

  const scored = [];
  rows.forEach((t) => {
    const name = (t.nameLower || t.name || "").toLowerCase();
    const code = String(t.testCode || "").toLowerCase();
    const short = String(t.shortName || "").toLowerCase();
    let score = -1;
    if (code === q || short === q) score = 0;
    else if (name === q) score = 1;
    else if (name.startsWith(q) || short.startsWith(q)) score = 2;
    else if (code.startsWith(q)) score = 3;
    else if (name.includes(q)) score = 4;
    else if (String(t.category).toLowerCase().includes(q)) score = 5;
    else if ((t.searchKeywords || []).some((k) => String(k).toLowerCase().startsWith(q))) score = 6;
    if (score >= 0) scored.push({ score, t });
  });
  scored.sort((a, b) => a.score - b.score || a.t.name.localeCompare(b.t.name));
  return scored.slice(0, 400).map((s) => s.t);
}

export function categoriesOf(tests) {
  return Array.from(new Set(tests.map((t) => t.category).filter(Boolean))).sort();
}

/** Create or replace one catalogue entry. */
export async function saveTest(testId, data) {
  const id = String(testId || data.testCode || "").trim();
  if (!id) throw new Error("A test needs a test code.");
  const normalized = normalizeTest(id, data);
  const payload = withLabId(clean({
    ...normalized,
    nameLower: normalized.name.toLowerCase(),
    searchKeywords: buildSearchTokens(normalized.name, normalized.testCode, normalized.shortName, normalized.category),
    updatedAt: new Date().toISOString()
  }));
  delete payload.id;
  await setDoc(docRef("tests", id), payload, { merge: true });
  cacheDrop("tests:active"); cacheDrop("tests:all");
  cacheDrop("testSummaries:active"); cacheDrop("testSummaries:all");
  return { id, ...payload };
}

/** Price-only update - the most common per-customer change. */
export async function updateTestPrice(testId, price) {
  await updateDoc(docRef("tests", testId), { price: toNumber(price), updatedAt: new Date().toISOString() });
  cacheDrop("tests:active"); cacheDrop("tests:all");
  cacheDrop("testSummaries:active"); cacheDrop("testSummaries:all");
}

export async function setTestActive(testId, isActive) {
  await updateDoc(docRef("tests", testId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("tests:active"); cacheDrop("tests:all");
  cacheDrop("testSummaries:active"); cacheDrop("testSummaries:all");
}

/**
 * Deactivate rather than delete by default: a deleted test would orphan every
 * historical booking and report that references it.
 */
export async function deleteTest(testId, { hard = false } = {}) {
  if (hard) await deleteDoc(docRef("tests", testId));
  else await setTestActive(testId, false);
  cacheDrop("tests:active"); cacheDrop("tests:all");
}

export async function loadPackages({ activeOnly = true } = {}) {
  const snap = await getDocs(col("packages"));
  return snapshotRows(snap).filter((p) => (activeOnly ? p.isActive !== false : true));
}

export async function savePackage(packageId, data) {
  const id = String(packageId || data.code || "").trim();
  if (!id) throw new Error("A package needs a code.");
  await setDoc(docRef("packages", id), withLabId(clean({
    ...data,
    isActive: data.isActive !== false,
    price: toNumber(data.price),
    testIds: Array.isArray(data.testIds) ? data.testIds : [],
    updatedAt: new Date().toISOString()
  })), { merge: true });
  return { id, ...data };
}
