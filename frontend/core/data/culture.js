// Culture & Sensitivity (microbiology) master data: specimens, organisms,
// antibiotics, antibiotic panels and breakpoints.
//
// These are configuration collections, not patient data - same shape and
// conventions as core/data/tests.js (flat top-level collections via
// tenant.js's col()/docRef(), setDoc merge, isActive rather than delete so
// historical C&S reports that reference a since-deactivated organism or
// antibiotic keep rendering correctly).
import { getDocs, setDoc, updateDoc, deleteDoc, query } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId } from "../tenant.js";
import { cached, cacheDrop, CACHE_TTL, snapshotRows, buildSearchTokens, clean } from "./helpers.js";

const CULTURE_CACHE_TTL = CACHE_TTL.tests; // same 10-minute TTL as the test catalogue

export const GRAM_REACTIONS = Object.freeze(["Gram Positive", "Gram Negative", "Gram Variable", "Not Applicable"]);
export const AEROBICITY = Object.freeze(["Aerobic", "Anaerobic", "Facultative Anaerobic", "Microaerophilic"]);
export const TESTING_METHODS = Object.freeze([
  "Disk Diffusion (Kirby-Bauer)", "MIC (Broth Microdilution)", "E-test (Gradient MIC)", "Automated (VITEK/Phoenix)"
]);
export const BREAKPOINT_STANDARDS = Object.freeze(["CLSI", "EUCAST"]);
export const SIR_VALUES = Object.freeze(["S", "I", "R", "NA", "NT"]);
export const SIR_LABELS = Object.freeze({
  S: "Susceptible", I: "Intermediate", R: "Resistant", NA: "Not Applicable", NT: "Not Tested"
});
export const CULTURE_RESULTS = Object.freeze([
  "Pending", "No Growth", "Growth Detected", "Significant Growth",
  "Insignificant Growth", "Mixed Growth", "Contaminated", "Final"
]);
export const COLONY_COUNT_UNITS = Object.freeze(["CFU/mL", "CFU/g", "CFU/specimen", "Semi-quantitative"]);
export const RESISTANCE_MARKER_VALUES = Object.freeze(["Not Tested", "Not Applicable", "Detected", "Not Detected"]);
export const DEFAULT_RESISTANCE_MARKERS = Object.freeze(["ESBL", "MRSA", "VRE", "Carbapenemase"]);

// ---------- specimens ----------

function normalizeSpecimen(id, data = {}) {
  return {
    id, specimenId: data.specimenId || id,
    name: data.name || id,
    isActive: data.isActive !== false,
    notes: data.notes || ""
  };
}

export async function loadSpecimens({ activeOnly = false, force = false } = {}) {
  const key = `csSpecimens:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CULTURE_CACHE_TTL, async () => {
    const snap = await getDocs(col("csSpecimens"));
    let rows = snap.docs.map((d) => normalizeSpecimen(d.id, d.data()));
    if (activeOnly) rows = rows.filter((r) => r.isActive);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function saveSpecimen(specimenId, data) {
  const id = String(specimenId || data.name || "").trim().replace(/\s+/g, "-").toLowerCase();
  if (!id) throw new Error("A specimen needs a name.");
  const payload = withLabId(clean({ ...normalizeSpecimen(id, data), updatedAt: new Date().toISOString() }));
  delete payload.id;
  await setDoc(docRef("csSpecimens", id), payload, { merge: true });
  cacheDrop("csSpecimens:active"); cacheDrop("csSpecimens:all");
  return { id, ...payload };
}

export async function setSpecimenActive(specimenId, isActive) {
  await updateDoc(docRef("csSpecimens", specimenId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("csSpecimens:active"); cacheDrop("csSpecimens:all");
}

// ---------- organisms ----------

function normalizeOrganism(id, data = {}) {
  return {
    id, organismId: data.organismId || id,
    name: data.name || "",
    scientificName: data.scientificName || data.name || "",
    organismType: data.organismType || "",
    gramReaction: data.gramReaction || "",
    morphology: data.morphology || "",
    aerobicity: data.aerobicity || "",
    isActive: data.isActive !== false,
    notes: data.notes || ""
  };
}

export async function loadOrganisms({ activeOnly = false, force = false } = {}) {
  const key = `csOrganisms:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CULTURE_CACHE_TTL, async () => {
    const snap = await getDocs(col("csOrganisms"));
    let rows = snap.docs.map((d) => normalizeOrganism(d.id, d.data()));
    if (activeOnly) rows = rows.filter((r) => r.isActive);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function saveOrganism(organismId, data) {
  const id = String(organismId || "").trim() || cryptoRandomId();
  if (!String(data.name || "").trim()) throw new Error("An organism needs a name.");
  const payload = withLabId(clean({
    ...normalizeOrganism(id, data),
    nameLower: String(data.name || "").toLowerCase(),
    updatedAt: new Date().toISOString()
  }));
  delete payload.id;
  await setDoc(docRef("csOrganisms", id), payload, { merge: true });
  cacheDrop("csOrganisms:active"); cacheDrop("csOrganisms:all");
  return { id, ...payload };
}

export async function setOrganismActive(organismId, isActive) {
  await updateDoc(docRef("csOrganisms", organismId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("csOrganisms:active"); cacheDrop("csOrganisms:all");
}

// ---------- antibiotics ----------

function normalizeAntibiotic(id, data = {}) {
  return {
    id, antibioticId: data.antibioticId || id,
    genericName: data.genericName || data.displayName || "",
    displayName: data.displayName || data.genericName || "",
    antibioticClass: data.antibioticClass || "",
    testingMethod: data.testingMethod || TESTING_METHODS[0],
    micUnit: data.micUnit || "µg/mL",
    applicableOrganismIds: Array.isArray(data.applicableOrganismIds) ? data.applicableOrganismIds : [],
    applicableSpecimenIds: Array.isArray(data.applicableSpecimenIds) ? data.applicableSpecimenIds : [],
    isActive: data.isActive !== false,
    reportingNotes: data.reportingNotes || ""
  };
}

export async function loadAntibiotics({ activeOnly = false, force = false } = {}) {
  const key = `csAntibiotics:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CULTURE_CACHE_TTL, async () => {
    const snap = await getDocs(col("csAntibiotics"));
    let rows = snap.docs.map((d) => normalizeAntibiotic(d.id, d.data()));
    if (activeOnly) rows = rows.filter((r) => r.isActive);
    return rows.sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
}

export async function saveAntibiotic(antibioticId, data) {
  const id = String(antibioticId || "").trim() || cryptoRandomId();
  if (!String(data.displayName || data.genericName || "").trim()) throw new Error("An antibiotic needs a name.");
  const payload = withLabId(clean({
    ...normalizeAntibiotic(id, data),
    searchKeywords: buildSearchTokens(data.genericName, data.displayName, data.antibioticClass),
    updatedAt: new Date().toISOString()
  }));
  delete payload.id;
  await setDoc(docRef("csAntibiotics", id), payload, { merge: true });
  cacheDrop("csAntibiotics:active"); cacheDrop("csAntibiotics:all");
  return { id, ...payload };
}

export async function setAntibioticActive(antibioticId, isActive) {
  await updateDoc(docRef("csAntibiotics", antibioticId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("csAntibiotics:active"); cacheDrop("csAntibiotics:all");
}

// ---------- antibiotic panels ----------
// A panel is what "Auto Fill Sensitivity Panel" loads: a named list of
// antibiotics an admin has decided applies to a given specimen + organism
// gram-reaction combination (e.g. "Urine - Gram Negative"). Matching is by
// specimenId + gramReaction, never by inventing a panel for a combination
// nobody configured.

function normalizePanel(id, data = {}) {
  return {
    id,
    name: data.name || "",
    specimenId: data.specimenId || "",
    gramReaction: data.gramReaction || "",
    antibioticIds: Array.isArray(data.antibioticIds) ? data.antibioticIds : [],
    isActive: data.isActive !== false
  };
}

export async function loadPanels({ activeOnly = false, force = false } = {}) {
  const key = `csPanels:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CULTURE_CACHE_TTL, async () => {
    const snap = await getDocs(col("csPanels"));
    let rows = snap.docs.map((d) => normalizePanel(d.id, d.data()));
    if (activeOnly) rows = rows.filter((r) => r.isActive);
    return rows.sort((a, b) => a.name.localeCompare(b.name));
  });
}

export async function savePanel(panelId, data) {
  const id = String(panelId || "").trim() || cryptoRandomId();
  if (!String(data.name || "").trim()) throw new Error("A panel needs a name.");
  const payload = withLabId(clean({ ...normalizePanel(id, data), updatedAt: new Date().toISOString() }));
  delete payload.id;
  await setDoc(docRef("csPanels", id), payload, { merge: true });
  cacheDrop("csPanels:active"); cacheDrop("csPanels:all");
  return { id, ...payload };
}

export async function setPanelActive(panelId, isActive) {
  await updateDoc(docRef("csPanels", panelId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("csPanels:active"); cacheDrop("csPanels:all");
}

/** What "Auto Fill Sensitivity Panel" uses: the configured antibiotics for this specimen + gram reaction, or none. */
export function matchPanels(panels, { specimenId, gramReaction }) {
  return panels.filter((p) => p.isActive
    && (!p.specimenId || p.specimenId === specimenId)
    && (!p.gramReaction || p.gramReaction === gramReaction));
}

// ---------- breakpoints ----------
// Stored as explicit numeric thresholds an admin enters from their chosen
// standard's printed tables - never computed or guessed here. MIC: a value
// <= micSMax is S, >= micRMin is R, anything between is I. Zone diameter is
// the inverse (larger = more susceptible): >= zoneSMin is S, <= zoneRMax is R.
// Leaving a threshold blank means that testing method/value isn't used for
// this organism+antibiotic, which callers must treat as "no interpretation",
// never as a silent 0.

function normalizeBreakpoint(id, data = {}) {
  return {
    id,
    organismId: data.organismId || "",
    antibioticId: data.antibioticId || "",
    testingMethod: data.testingMethod || TESTING_METHODS[0],
    standard: data.standard || BREAKPOINT_STANDARDS[0],
    standardVersion: data.standardVersion || "",
    micUnit: data.micUnit || "µg/mL",
    micSMax: data.micSMax ?? null,
    micRMin: data.micRMin ?? null,
    zoneUnit: data.zoneUnit || "mm",
    zoneSMin: data.zoneSMin ?? null,
    zoneRMax: data.zoneRMax ?? null,
    isActive: data.isActive !== false,
    effectiveDate: data.effectiveDate || ""
  };
}

export async function loadBreakpoints({ activeOnly = false, force = false } = {}) {
  const key = `csBreakpoints:${activeOnly ? "active" : "all"}`;
  if (force) cacheDrop(key);
  return cached(key, CULTURE_CACHE_TTL, async () => {
    const snap = await getDocs(col("csBreakpoints"));
    let rows = snap.docs.map((d) => normalizeBreakpoint(d.id, d.data()));
    if (activeOnly) rows = rows.filter((r) => r.isActive);
    return rows;
  });
}

export async function saveBreakpoint(breakpointId, data) {
  const id = String(breakpointId || "").trim() || cryptoRandomId();
  if (!data.organismId || !data.antibioticId) throw new Error("A breakpoint needs an organism and an antibiotic.");
  const payload = withLabId(clean({ ...normalizeBreakpoint(id, data), updatedAt: new Date().toISOString() }));
  delete payload.id;
  await setDoc(docRef("csBreakpoints", id), payload, { merge: true });
  cacheDrop("csBreakpoints:active"); cacheDrop("csBreakpoints:all");
  return { id, ...payload };
}

export async function setBreakpointActive(breakpointId, isActive) {
  await updateDoc(docRef("csBreakpoints", breakpointId), { isActive: Boolean(isActive), updatedAt: new Date().toISOString() });
  cacheDrop("csBreakpoints:active"); cacheDrop("csBreakpoints:all");
}

/**
 * Find the one active breakpoint for this organism+antibiotic+method+standard.
 * Never guesses across methods or standards - an admin who wants MIC
 * interpretation must configure a MIC breakpoint, a disk-diffusion one
 * separately, etc.
 */
export function findBreakpoint(breakpoints, { organismId, antibioticId, testingMethod, standard }) {
  return breakpoints.find((b) => b.isActive
    && b.organismId === organismId
    && b.antibioticId === antibioticId
    && b.testingMethod === testingMethod
    && (!standard || b.standard === standard)) || null;
}

/**
 * Interpret a MIC or zone-diameter value against one breakpoint. Returns
 * { sir, breakpointId, standard, standardVersion } or, if no matching
 * breakpoint/threshold exists, { sir: null, reason }. Never falls back to a
 * guessed threshold - see BREAKPOINT MASTER requirement.
 */
export function interpretSIR(breakpoint, { micValue, zoneDiameter } = {}) {
  if (!breakpoint) return { sir: null, reason: "Interpretation unavailable — breakpoint configuration required." };

  const mic = micValue === "" || micValue == null ? null : Number(micValue);
  if (mic != null && Number.isFinite(mic) && breakpoint.micSMax != null && breakpoint.micRMin != null) {
    const sir = mic <= breakpoint.micSMax ? "S" : mic >= breakpoint.micRMin ? "R" : "I";
    return { sir, breakpointId: breakpoint.id, standard: breakpoint.standard, standardVersion: breakpoint.standardVersion };
  }

  const zone = zoneDiameter === "" || zoneDiameter == null ? null : Number(zoneDiameter);
  if (zone != null && Number.isFinite(zone) && breakpoint.zoneSMin != null && breakpoint.zoneRMax != null) {
    const sir = zone >= breakpoint.zoneSMin ? "S" : zone <= breakpoint.zoneRMax ? "R" : "I";
    return { sir, breakpointId: breakpoint.id, standard: breakpoint.standard, standardVersion: breakpoint.standardVersion };
  }

  return { sir: null, reason: "Interpretation unavailable — breakpoint configuration required." };
}

function cryptoRandomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 14);
}
