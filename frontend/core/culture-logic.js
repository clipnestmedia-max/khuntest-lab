// Culture & Sensitivity pure logic: MIC parsing, breakpoint lookup, S/I/R
// interpretation, panel matching and report validation. No Firebase or DOM
// imports on purpose, so it runs unchanged in the browser and in node tests
// (see scripts/test-culture.mjs). core/data/culture.js re-exports these.

export const CULTURE_POSITIVE_RESULTS = Object.freeze([
  "Growth Detected", "Significant Growth", "Insignificant Growth", "Mixed Growth", "Final"
]);

/** Results that need at least one organism before release. Pending/No Growth/Sterile/Contaminated do not. */
export function cultureNeedsOrganism(cultureResult) {
  return CULTURE_POSITIVE_RESULTS.includes(cultureResult);
}

// ---------- result mapping (stored value -> display) ----------
// The stored value never changes (so every historical report stays readable);
// only how it is shown does. "" = not yet entered: the row is left out of the
// printed report rather than being reported as anything.
export const SIR_DISPLAY = Object.freeze({ S: "Sensitive", I: "Intermediate", R: "Resistant", NA: "Not Applicable", NT: "Not Tested", "": "" });
export const SIR_PRINT_MARK = Object.freeze({ S: "S", I: "I", R: "R", NA: "NA", NT: "X" });
// Older reports (and one earlier print layout) used "IMS" for intermediate.
const LEGACY_SIR = Object.freeze({ IMS: "I", SENSITIVE: "S", RESISTANT: "R", INTERMEDIATE: "I" });
export function normalizeSir(value) {
  const v = String(value ?? "").trim();
  if (LEGACY_SIR[v.toUpperCase()]) return LEGACY_SIR[v.toUpperCase()];
  return v;
}

/** A row is printed if it has a result or a recorded MIC/zone. Blank rows are simply not reported. */
export function isReportableRow(row) {
  return normalizeSir(row?.sir) !== "" || String(row?.micValue ?? "").trim() !== "" || String(row?.zoneDiameter ?? "").trim() !== "";
}

/** "S", "R(++)", "X" or "—" (MIC recorded but no result chosen). */
export function formatSirMark(row) {
  const sir = normalizeSir(row?.sir);
  if (!sir) return "—";
  const mark = SIR_PRINT_MARK[sir] || "X";
  return row.grade ? `${mark}(${row.grade})` : mark;
}

/** Legend under the table: R/S/I always, X / NA only if some printed row uses them. */
export function sirLegend(rows) {
  const used = new Set((rows || []).map((r) => normalizeSir(r.sir)));
  return ["R - RESISTANT", "S - SENSITIVE", "I - INTERMEDIATE"]
    .concat(used.has("NT") ? ["X - NOT TESTED"] : [], used.has("NA") ? ["NA - NOT APPLICABLE"] : []).join(", ");
}

// ---------- MIC ----------

/**
 * Parse a MIC as typed: "0.25", "2", ">16", "≤0.25", "<=0.5", ">=8".
 * Returns { ok, op, value } or { ok:false }. op is "", "<", "<=", ">", ">=".
 * An empty string is valid (MIC is optional) and returns { ok:true, empty:true }.
 */
export function parseMic(raw) {
  const text = String(raw ?? "").trim().replace(/≤/g, "<=").replace(/≥/g, ">=").replace(/\s+/g, "");
  if (text === "") return { ok: true, empty: true, op: "", value: null };
  const m = /^(<=|>=|<|>)?(\d+(?:\.\d+)?|\.\d+)$/.exec(text);
  if (!m) return { ok: false };
  const value = Number(m[2]);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, empty: false, op: m[1] || "", value };
}

export const isValidMic = (raw) => parseMic(raw).ok;

// ---------- breakpoints ----------

export function findBreakpoint(breakpoints, { organismId, antibioticId, testingMethod, standard }) {
  return breakpoints.find((b) => b.isActive
    && b.organismId === organismId
    && b.antibioticId === antibioticId
    && b.testingMethod === testingMethod
    && (!standard || b.standard === standard)) || null;
}

const NOT_CONFIGURED = "Interpretation not configured — no verified breakpoint for this organism/antibiotic.";

/**
 * Interpret a MIC or zone-diameter value against one breakpoint. Returns
 * { sir, breakpointId, standard, standardVersion } or { sir: null, reason }.
 * Never falls back to a guessed threshold, and never resolves an open-ended
 * MIC ("≤4", ">2") unless the bound alone decides the category.
 */
export function interpretSIR(breakpoint, { micValue, zoneDiameter } = {}) {
  if (!breakpoint) return { sir: null, reason: NOT_CONFIGURED };
  const done = (sir) => ({ sir, breakpointId: breakpoint.id, standard: breakpoint.standard, standardVersion: breakpoint.standardVersion });

  const mic = parseMic(micValue);
  if (mic.ok && !mic.empty && breakpoint.micSMax != null && breakpoint.micRMin != null) {
    const { op, value } = mic;
    if (op === "") return done(value <= breakpoint.micSMax ? "S" : value >= breakpoint.micRMin ? "R" : "I");
    if (op === "<=" || op === "<") {
      // True MIC is at or below `value`; only decisive when that already lies inside S.
      if (value <= breakpoint.micSMax) return done("S");
      return { sir: null, reason: "Open-ended MIC cannot be interpreted against this breakpoint — choose S/I/R manually." };
    }
    // ">" / ">=": true MIC is at or above `value` (strictly above for ">").
    if (value >= breakpoint.micRMin) return done("R");
    return { sir: null, reason: "Open-ended MIC cannot be interpreted against this breakpoint — choose S/I/R manually." };
  }

  const zone = zoneDiameter === "" || zoneDiameter == null ? null : Number(zoneDiameter);
  if (zone != null && Number.isFinite(zone) && breakpoint.zoneSMin != null && breakpoint.zoneRMax != null) {
    return done(zone >= breakpoint.zoneSMin ? "S" : zone <= breakpoint.zoneRMax ? "R" : "I");
  }
  return { sir: null, reason: NOT_CONFIGURED };
}

// ---------- panels ----------

/** Configured panels for this specimen + organism + gram reaction. A blank panel field means "any". */
export function matchPanels(panels, { specimenId, organismId, gramReaction }) {
  return panels.filter((p) => p.isActive
    && (!p.specimenId || p.specimenId === specimenId)
    && (!p.organismId || p.organismId === organismId)
    && (!p.gramReaction || p.gramReaction === gramReaction));
}

// ---------- validation ----------

const norm = (s) => String(s || "").trim().toLowerCase();

/** Problems that make even a draft unsafe to save (bad MIC text). Returns "" or a message. */
export function cultureDraftError(cultureResults) {
  for (const cr of cultureResults || []) {
    for (const o of cr.organisms || []) {
      for (const s of o.sensitivities || []) {
        if (!isValidMic(s.micValue)) {
          return `${cr.testName}: "${s.micValue}" is not a valid MIC for ${s.antibioticName || "an antibiotic"} (use e.g. 0.5, 16, >16 or ≤0.25).`;
        }
      }
    }
  }
  return "";
}

/** Everything that must be true before release. Returns "" or the first problem. */
export function cultureValidationError(cultureResults) {
  const draft = cultureDraftError(cultureResults);
  if (draft) return draft;
  for (const cr of cultureResults || []) {
    const name = cr.testName || "Culture & Sensitivity";
    if (!String(cr.specimenName || cr.specimenId || "").trim()) return `${name}: select or enter the specimen.`;
    if (!cr.cultureResult) return `${name}: choose the culture result.`;
    if (!cultureNeedsOrganism(cr.cultureResult)) continue;
    if (!cr.organisms?.length) return `${name}: "${cr.cultureResult}" needs at least one organism before this report can be released.`;
    const seenOrganisms = new Set();
    for (const o of cr.organisms) {
      const oname = String(o.organismName || "").trim();
      if (!oname) return `${name}: every organism row needs an organism selected or typed.`;
      if (seenOrganisms.has(norm(oname))) return `${name}: ${oname} is listed twice — merge them into one organism block.`;
      seenOrganisms.add(norm(oname));
      const seenDrugs = new Set();
      for (const s of o.sensitivities || []) {
        const dname = String(s.antibioticName || "").trim();
        if (!dname) return `${name}: ${oname} has an antibiotic row with no drug selected.`;
        const key = s.antibioticId || norm(dname);
        if (seenDrugs.has(key)) return `${name}: ${dname} appears twice under ${oname}.`;
        seenDrugs.add(key);
      }
    }
  }
  return "";
}
