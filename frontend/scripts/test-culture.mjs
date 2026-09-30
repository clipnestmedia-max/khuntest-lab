// Culture & Sensitivity tests. Run: node frontend/scripts/test-culture.mjs
// Covers the pure logic (MIC parsing, breakpoint interpretation, panel matching,
// validation), the entry module's data functions against fixture masters, and
// the printed output of both renderers (admin templates + patient report.html).
// Firebase is stubbed through a module loader hook, so nothing here touches the
// network or a real database.
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const url = (p) => pathToFileURL(path.join(root, p)).href;

// ---- Firebase stub ---------------------------------------------------------
const FIXTURE = globalThis.__CS_FIXTURE = { csSpecimens: [], csOrganisms: [], csAntibiotics: [], csPanels: [], csBreakpoints: [], settings: {} };
const stub = `
export const collection = (_db, name) => ({ __col: name });
export const doc = (_db, name, id) => ({ __doc: name, id });
export const query = (c) => c;
export const getDocs = async (c) => ({ docs: (globalThis.__CS_FIXTURE[c.__col] || []).map((d) => ({ id: d.id, data: () => d })) });
export const getDoc = async (d) => { const v = globalThis.__CS_FIXTURE.settings[d.id]; return { exists: () => !!v, data: () => v }; };
export const setDoc = async () => {}; export const updateDoc = async () => {}; export const deleteDoc = async () => {};
export const serverTimestamp = () => ({}); export const Timestamp = class {};
export const db = {}; export const app = {}; export const auth = {};
`;
const hook = `
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("https://") || /firebase-config\\.js$/.test(spec)) return { url: "cs-stub:" + encodeURIComponent(spec), shortCircuit: true };
  return next(spec, ctx);
}
export async function load(u, ctx, next) {
  if (u.startsWith("cs-stub:")) return { format: "module", source: ${JSON.stringify(stub)}, shortCircuit: true };
  return next(u, ctx);
}`;
register("data:text/javascript," + encodeURIComponent(hook));

// ---- tiny test runner ------------------------------------------------------
let passed = 0; const failures = [];
const check = (name, cond, detail = "") => { if (cond) passed++; else failures.push(`${name}${detail ? " — " + detail : ""}`); };
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const L = await import(url("core/culture-logic.js"));
const T = await import(url("core/report-templates.js"));

// ============ 1. MIC parsing ============
eq("MIC 0.25", L.parseMic("0.25"), { ok: true, empty: false, op: "", value: 0.25 });
eq("MIC >16", L.parseMic(">16").op + L.parseMic(">16").value, ">16");
eq("MIC ≤0.25", L.parseMic("≤0.25").op, "<=");
eq("MIC <=0.5", L.parseMic("<=0.5").value, 0.5);
eq("MIC ≥8", L.parseMic("≥8").op, ">=");
check("MIC empty is valid (optional)", L.isValidMic("") && L.isValidMic("  ") && L.isValidMic(null));
for (const bad of ["abc", "1..2", "--1", ">", "1/2", "S", "16 mg", "≤"]) check(`MIC rejects "${bad}"`, !L.isValidMic(bad));
for (const good of ["0.25", "0.5", "1", "2", "4", "8", "16", ">16", "≤0.25", ".5", "  4 "]) check(`MIC accepts "${good}"`, L.isValidMic(good));

// ============ 2. Interpretation ============
const bp = { id: "b1", isActive: true, organismId: "pa", antibioticId: "mem", testingMethod: "MIC", standard: "CLSI", standardVersion: "2024", micSMax: 2, micRMin: 8, zoneSMin: 20, zoneRMax: 14 };
eq("no breakpoint => null", L.interpretSIR(null, { micValue: 1 }).sir, null);
check("no breakpoint message", /not configured/i.test(L.interpretSIR(null, { micValue: 1 }).reason));
eq("MIC 1 => S", L.interpretSIR(bp, { micValue: "1" }).sir, "S");
eq("MIC 2 (boundary) => S", L.interpretSIR(bp, { micValue: "2" }).sir, "S");
eq("MIC 4 => I", L.interpretSIR(bp, { micValue: "4" }).sir, "I");
eq("MIC 8 (boundary) => R", L.interpretSIR(bp, { micValue: "8" }).sir, "R");
eq("MIC 16 => R", L.interpretSIR(bp, { micValue: "16" }).sir, "R");
eq("≤0.25 => S (bound inside S)", L.interpretSIR(bp, { micValue: "≤0.25" }).sir, "S");
eq("≤4 => not decidable", L.interpretSIR(bp, { micValue: "≤4" }).sir, null);
eq(">16 => R", L.interpretSIR(bp, { micValue: ">16" }).sir, "R");
eq(">2 => not decidable", L.interpretSIR(bp, { micValue: ">2" }).sir, null);
eq("zone 25 => S", L.interpretSIR(bp, { zoneDiameter: "25" }).sir, "S");
eq("zone 10 => R", L.interpretSIR(bp, { zoneDiameter: "10" }).sir, "R");
eq("zone 16 => I", L.interpretSIR(bp, { zoneDiameter: "16" }).sir, "I");
eq("breakpoint records standard", L.interpretSIR(bp, { micValue: 1 }).standard, "CLSI");
eq("no thresholds => null (never guesses)", L.interpretSIR({ ...bp, micSMax: null, micRMin: null, zoneSMin: null, zoneRMax: null }, { micValue: 1 }).sir, null);
eq("blank value => null", L.interpretSIR(bp, {}).sir, null);
eq("findBreakpoint exact", L.findBreakpoint([bp], { organismId: "pa", antibioticId: "mem", testingMethod: "MIC" })?.id, "b1");
eq("findBreakpoint other organism => null", L.findBreakpoint([bp], { organismId: "ec", antibioticId: "mem", testingMethod: "MIC" }), null);
eq("findBreakpoint other method => null", L.findBreakpoint([bp], { organismId: "pa", antibioticId: "mem", testingMethod: "Disk" }), null);
eq("findBreakpoint other standard => null", L.findBreakpoint([bp], { organismId: "pa", antibioticId: "mem", testingMethod: "MIC", standard: "EUCAST" }), null);
eq("inactive breakpoint ignored", L.findBreakpoint([{ ...bp, isActive: false }], { organismId: "pa", antibioticId: "mem", testingMethod: "MIC" }), null);

// ============ 3. Panels ============
const panels = [
  { id: "p1", isActive: true, specimenId: "", organismId: "", gramReaction: "Gram Negative" },
  { id: "p2", isActive: true, specimenId: "suction", organismId: "pa", gramReaction: "" },
  { id: "p3", isActive: true, specimenId: "urine", organismId: "", gramReaction: "" },
  { id: "p4", isActive: false, specimenId: "", organismId: "", gramReaction: "" }
];
eq("panels: gram-neg any specimen + organism-specific", L.matchPanels(panels, { specimenId: "suction", organismId: "pa", gramReaction: "Gram Negative" }).map((p) => p.id), ["p1", "p2"]);
eq("panels: other organism does not get organism panel", L.matchPanels(panels, { specimenId: "suction", organismId: "ec", gramReaction: "Gram Negative" }).map((p) => p.id), ["p1"]);
eq("panels: urine specimen", L.matchPanels(panels, { specimenId: "urine", organismId: "ec", gramReaction: "Gram Positive" }).map((p) => p.id), ["p3"]);
eq("panels: inactive never matches", L.matchPanels(panels, { specimenId: "x", organismId: "y", gramReaction: "z" }).map((p) => p.id), []);

// ============ 4. Validation ============
const mkCr = (over = {}) => ({ testName: "Suction Tip C&S", specimenId: "suction", specimenName: "Suction Tip", cultureResult: "Growth Detected",
  organisms: [{ organismId: "pa", organismName: "Pseudomonas aeruginosa", sensitivities: [{ antibioticId: "ak", antibioticName: "Amikacin", micValue: "", sir: "NT" }] }], ...over });
eq("valid report passes", L.cultureValidationError([mkCr()]), "");
check("specimen required", /specimen/i.test(L.cultureValidationError([mkCr({ specimenId: "", specimenName: "" })])));
check("custom (typed) specimen accepted", L.cultureValidationError([mkCr({ specimenId: "", specimenName: "Drain fluid" })]) === "");
check("organism required when growth", /at least one organism/.test(L.cultureValidationError([mkCr({ organisms: [] })])));
eq("No Growth needs no organism", L.cultureValidationError([mkCr({ cultureResult: "No Growth", organisms: [] })]), "");
eq("Sterile needs no organism", L.cultureValidationError([mkCr({ cultureResult: "Sterile", organisms: [] })]), "");
eq("Contaminated needs no organism", L.cultureValidationError([mkCr({ cultureResult: "Contaminated", organisms: [] })]), "");
eq("Pending may be released as interim", L.cultureValidationError([mkCr({ cultureResult: "Pending", organisms: [] })]), "");
check("blank organism name rejected", /organism/.test(L.cultureValidationError([mkCr({ organisms: [{ organismId: "", organismName: " ", sensitivities: [] }] })])));
check("typed (non-master) organism accepted", L.cultureValidationError([mkCr({ organisms: [{ organismId: "", organismName: "Elizabethkingia meningoseptica", sensitivities: [] }] })]) === "");
check("duplicate organism rejected", /twice/.test(L.cultureValidationError([mkCr({ organisms: [{ organismName: "E. coli", sensitivities: [] }, { organismName: "e. COLI", sensitivities: [] }] })])));
check("duplicate antibiotic rejected", /twice/.test(L.cultureValidationError([mkCr({ organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticId: "ak", antibioticName: "Amikacin", micValue: "" }, { antibioticId: "ak", antibioticName: "Amikacin", micValue: "" }] }] })])));
check("antibiotic row without a drug rejected", /no drug/.test(L.cultureValidationError([mkCr({ organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticId: "", antibioticName: "", micValue: "" }] }] })])));
check("invalid MIC blocks release", /not a valid MIC/.test(L.cultureValidationError([mkCr({ organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticId: "ak", antibioticName: "Amikacin", micValue: "abc" }] }] })])));
check("invalid MIC blocks even a draft", /not a valid MIC/.test(L.cultureDraftError([mkCr({ organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticId: "ak", antibioticName: "Amikacin", micValue: "12x" }] }] })])));
eq("draft allows missing specimen/organism", L.cultureDraftError([mkCr({ specimenName: "", specimenId: "", organisms: [] })]), "");
eq("empty MIC + NT rows are fine (Not Tested)", L.cultureValidationError([mkCr()]), "");
eq("no culture results at all is valid (non-C&S report)", L.cultureValidationError([]), "");

// ============ 5. Masters + entry module against fixtures ============
const masterSrc = fs.readFileSync(path.join(root, "admin/culture-masters-screen.js"), "utf8");
const starterAbx = [...masterSrc.match(/STARTER_ANTIBIOTICS = \[([\s\S]*?)\n\];/)[1].matchAll(/displayName: "([^"]+)"(?:, abbreviation: "([^"]+)")?/g)].map((m) => ({ displayName: m[1], abbreviation: m[2] || "" }));
const REF = ["Amikacin", "Erythromycin", "Amoxicillin/Clavulanate", "Ofloxacin", "Piperacillin/Tazobactam", "Cefazolin", "Chloramphenicol", "Levofloxacin", "Imipenem", "Ceftazidime", "Gentamicin", "Vancomycin", "Cefepime", "Tobramycin", "Cefotaxime", "Meropenem", "Polymyxin B"];
check("all 17 reference antibiotics in the starter list", REF.every((n) => starterAbx.some((a) => a.displayName === n)), REF.filter((n) => !starterAbx.some((a) => a.displayName === n)).join(","));
check("all 17 reference antibiotics carry an abbreviation", REF.every((n) => starterAbx.find((a) => a.displayName === n)?.abbreviation));
const starterSpecimens = masterSrc.match(/STARTER_SPECIMENS = \[([\s\S]*?)\];/)[1];
for (const sp of ["Blood", "Urine", "Sputum", "Pus", "Wound Swab", "Throat Swab", "Nasal Swab", "Ear Swab", "Vaginal Swab", "Cervical Swab", "Semen", "CSF", "Ascitic Fluid", "Pleural Fluid", "Synovial Fluid", "BAL", "ET Aspirate", "Suction Tip", "Catheter Tip", "Stool", "Other"])
  check(`starter specimen: ${sp}`, starterSpecimens.includes(`"${sp}"`));
const starterOrgs = masterSrc.match(/STARTER_ORGANISMS = \[([\s\S]*?)\n\];/)[1];
for (const o of ["Escherichia coli", "Klebsiella pneumoniae", "Pseudomonas aeruginosa", "Acinetobacter baumannii", "Staphylococcus aureus", "Staphylococcus epidermidis", "Enterococcus faecalis", "Enterococcus faecium", "Streptococcus spp.", "Proteus mirabilis", "Proteus vulgaris", "Enterobacter spp.", "Citrobacter spp.", "Serratia spp.", "Morganella spp.", "Candida albicans", "Candida spp."])
  check(`starter organism: ${o}`, starterOrgs.includes(`name: "${o}"`));

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-");
FIXTURE.csAntibiotics = starterAbx.map((a) => ({ id: slug(a.displayName), displayName: a.displayName, abbreviation: a.abbreviation, isActive: true }));
FIXTURE.csSpecimens = [{ id: "suction-tip", name: "Suction Tip", isActive: true }, { id: "urine", name: "Urine", isActive: true }];
FIXTURE.csOrganisms = [{ id: "pa", name: "Pseudomonas aeruginosa", gramReaction: "Gram Negative", isActive: true }, { id: "sa", name: "Staphylococcus aureus", gramReaction: "Gram Positive", isActive: true }];
FIXTURE.csPanels = [{ id: "pan1", name: "PA panel", organismId: "pa", specimenId: "", gramReaction: "", isActive: true, antibioticIds: ["amikacin", "meropenem", "ceftazidime", "deactivated-x"] }];
FIXTURE.csBreakpoints = [{ id: "bp1", organismId: "pa", antibioticId: "meropenem", testingMethod: "Disk Diffusion (Kirby-Bauer)", standard: "CLSI", standardVersion: "2024", zoneSMin: 19, zoneRMax: 15, isActive: true }];
FIXTURE.settings.ast = { standardName: "CLSI", version: "M100 34th ed.", effectiveDate: "2024-01-01", showOnReport: true };

const C = await import(url("core/data/culture.js"));
const E = await import(url("admin/culture-report-entry.js"));
await E.loadCultureMasters(true);

eq("AST standard loads", (await C.loadAstStandard({ force: true })).standardName, "CLSI");
const cr = E.cultureResultFor({ testId: "T1", testCode: "KT0685", name: "Suction Tip Culture & Sensitivity" }, []);
eq("new block records AST standard", [cr.astStandard.name, cr.astStandard.version], ["CLSI", "M100 34th ed."]);
eq("new block starts Pending, no organisms", [cr.cultureResult, cr.organisms.length], ["Pending", 0]);
cr.specimenId = "suction-tip"; cr.specimenName = "Suction Tip"; cr.cultureResult = "Growth Detected";
cr.organisms.push({ organismId: "pa", organismName: "Pseudomonas aeruginosa", sensitivities: [], comments: "" });
const org = cr.organisms[0];

const htmlA = E.renderCultureBlocks([cr], true);
check("editor: searchable specimen input backed by the master list (incl. Other)", htmlA.includes('list="csSpecimenList"') && htmlA.includes('<option value="Suction Tip">'));
check("editor: searchable organism input with datalist", htmlA.includes('id="csOrganismList"') && htmlA.includes("Staphylococcus aureus") && E.renderCultureBlocks([{ ...cr, organisms: [{ organismId: "", organismName: "", sensitivities: [], comments: "" }] }], true).includes('list="csOrganismList"'));
check("editor: NO giant antibiotic checklist on the page (dialog only)", !htmlA.includes("data-abx-check") && !/type="checkbox"/.test(htmlA));
check("editor: basic fields visible (specimen, result, colony count, unit)", ["data-cr-specimen", "data-cr-result", "data-cr-colony", "data-cr-colony-unit"].every((a) => htmlA.includes(a)));
check("editor: advanced sections are collapsed by default", (htmlA.match(/<details class="cs-details"[^>]*>/g) || []).every((d) => !/sopen/.test(d)) && htmlA.includes("Microscopy / Gram stain") && htmlA.includes("Resistance markers"));
check("editor: named organism shows as a collapsed summary, not an open form", (() => { const h = E.renderCultureBlocks([{ ...cr, organisms: [{ organismId: "pa", organismName: "Pseudomonas aeruginosa", sensitivities: [{ antibioticId: "amikacin", antibioticName: "Amikacin", sir: "S" }, { antibioticId: "meropenem", antibioticName: "Meropenem", sir: "R" }], comments: "" }] }], true); return h.includes("2 antibiotics · S 1 · R 1") && h.includes("data-org-toggle") && !h.includes("data-sens-mic") && !h.includes("data-abx-quick"); })());
check("editor: empty organism prompts to select one and shows no antibiotic UI", (() => { const h = E.renderCultureBlocks([{ ...cr, organisms: [{ organismId: "", organismName: "", sensitivities: [], comments: "" }] }], true); return h.includes("Select an organism to enter antibiotic sensitivity.") && !h.includes("data-abx-open"); })());
check("editor: add organism button", htmlA.includes("data-add-organism"));
check("editor: OPEN organism renders search, + Add Antibiotic, panel button and the selected-antibiotics table", (() => {
  const c2 = { ...cr, organisms: [{ organismId: "pa", organismName: "Pseudomonas aeruginosa", comments: "x", sensitivities: [
    { antibioticId: "amikacin", antibioticName: "Amikacin", micValue: "4", micUnit: "µg/mL", zoneDiameter: "", zoneUnit: "mm", sir: "S", grade: "++", comment: "ok" },
    { antibioticId: "meropenem", antibioticName: "Meropenem", micValue: "", micUnit: "µg/mL", zoneDiameter: "", zoneUnit: "mm", sir: "", grade: "", comment: "" }] }] };
  E.setOrganismOpen(0, 0, true);
  const h = E.renderCultureBlocks([c2], true);
  E.setOrganismOpen(0, 0, false);
  return ["data-abx-quick", "data-abx-open", "data-autofill-panel", "Selected antibiotics: 2", "data-sens-sir", "data-sens-mic", "data-sens-zone", "data-sens-grade", "data-sens-comment", "data-remove-sens", "data-organism-comment"].every((x) => h.includes(x))
    && h.includes('<option value="S" selected>S — Sensitive</option>') && h.includes('<option value="I" >I — Intermediate</option>') && h.includes('<option value="R" >R — Resistant</option>')
    && h.includes('<option value="" selected>Select…</option>') && h.includes('value="++" selected') && h.includes('value="4"');
})());
check("editor: read-only mode disables inputs and hides add/remove", (() => {
  E.setOrganismOpen(0, 0, true);
  const h = E.renderCultureBlocks([{ ...cr, organisms: [{ organismId: "pa", organismName: "PA", sensitivities: [{ antibioticId: "amikacin", antibioticName: "Amikacin", sir: "R" }], comments: "" }] }], false);
  E.setOrganismOpen(0, 0, false);
  return !h.includes("data-abx-open") && !h.includes("data-remove-sens") && !h.includes("data-add-organism") && /data-sens-sir[^>]*disabled/.test(h);
})());
check("editor: legacy stored values (IMS, NT) display sensibly", (() => {
  E.setOrganismOpen(0, 0, true);
  const h = E.renderCultureBlocks([{ ...cr, organisms: [{ organismId: "", organismName: "E. coli", sensitivities: [{ antibioticId: "", antibioticName: "Ampicillin", sir: "IMS" }, { antibioticId: "", antibioticName: "", sir: "NT" }], comments: "" }] }], true);
  E.setOrganismOpen(0, 0, false);
  return h.includes('<option value="I" selected>') && h.includes('<option value="NT" selected>') && h.includes("(no antibiotic selected)");
})());
check("editor: 'No growth' hides the organism section", !E.renderCultureBlocks([{ ...cr, cultureResult: "No Growth", organisms: [] }], true).includes("data-add-organism"));
check("editor: existing organisms are never hidden even on 'No Growth'", E.renderCultureBlocks([{ ...cr, cultureResult: "No Growth" }], true).includes("Pseudomonas aeruginosa"));
check("editor: 'Other' specimen asks what it is", E.renderCultureBlocks([{ ...cr, specimenId: "", specimenName: "", specimenCustom: true }], true).includes("Specify specimen"));
check("editor: legacy custom specimen shows its typed name", E.renderCultureBlocks([{ ...cr, specimenId: "", specimenName: "Drain fluid" }], true).includes('value="Drain fluid"'));
org.sensitivities = [];


eq("addAntibiotics adds 17", E.addAntibiotics(org, REF.map(slug)), 17);
eq("addAntibiotics skips duplicates", E.addAntibiotics(org, REF.map(slug)), 0);
eq("addAntibiotics ignores unknown ids", E.addAntibiotics(org, ["nope"]), 0);
eq("17 rows, all start BLANK (nothing invented)", [org.sensitivities.length, org.sensitivities.every((r) => r.sir === "" && r.micValue === "")], [17, true]);
eq("MIC unit defaults to µg/mL", org.sensitivities[0].micUnit, "µg/mL");
const meropenem = org.sensitivities.find((r) => r.antibioticId === "meropenem");
meropenem.zoneDiameter = "22"; E.recalcRow("pa", meropenem);
eq("configured breakpoint auto-interprets zone", [meropenem.sir, meropenem.auto, meropenem.standard], ["S", true, "CLSI"]);
const amik = org.sensitivities.find((r) => r.antibioticId === "amikacin");
amik.micValue = "4"; E.recalcRow("pa", amik);
eq("no breakpoint => stays blank, manual choice needed", [amik.sir, amik.auto], ["", false]);
amik.sir = "R"; amik.auto = false;

// panel auto-fill: only what the admin configured, only active antibiotics
const cr2 = E.cultureResultFor({ testId: "T2", name: "x" }, []);
const org2 = { organismId: "pa", organismName: "Pseudomonas aeruginosa", sensitivities: [] };
const filled = E.autoFillPanel(cr2, org2);
eq("auto-fill loads the configured panel, skipping unknown drugs", [filled.added, org2.sensitivities.map((r) => r.antibioticId)], [3, ["amikacin", "meropenem", "ceftazidime"]]);
const orgSa = { organismId: "sa", organismName: "Staphylococcus aureus", sensitivities: [] };
const noPanel = E.autoFillPanel(cr2, orgSa);
check("no panel configured for this organism => nothing auto-selected", noPanel.added === 0 && noPanel.noPanel === true && orgSa.sensitivities.length === 0);
const orgCustom = { organismId: "", organismName: "Elizabethkingia", sensitivities: [] };
check("typed organism (no master) => nothing auto-selected", E.autoFillPanel(cr2, orgCustom).added === 0);

// Persisted shape keeps everything and old reports still load
const saved = JSON.parse(JSON.stringify(cr));
const reopened = E.cultureResultFor({ testId: "T1", testCode: "KT0685", name: "x" }, [saved]);
eq("reopened draft keeps every antibiotic row", reopened.organisms[0].sensitivities.length, 17);
eq("reopened draft keeps S/I/R + AST standard", [reopened.organisms[0].sensitivities.find((r) => r.antibioticId === "amikacin").sir, reopened.astStandard.name], ["R", "CLSI"]);
const legacy = { testId: "OLD", testCode: "KT0156", testName: "Old", specimenName: "Urine", cultureResult: "Growth Detected", organisms: [{ organismId: "ec", organismName: "E. coli", sensitivities: [{ antibioticId: "a", antibioticName: "Ampicillin", sir: "R" }] }], resistanceMarkers: {}, comments: "" };
check("legacy report (no astStandard/comments/abbreviation) still opens and validates", (() => { const o = E.cultureResultFor({ testId: "OLD", testCode: "KT0156" }, [legacy]); return o.organisms[0].sensitivities[0].sir === "R" && L.cultureValidationError([o]) === ""; })());
check("legacy report still renders in the editor", E.renderCultureBlocks([legacy], false).includes("E. coli"));

// ============ 6. Printed output ============
const branding = { labName: "Dummy Lab", reportTemplate: "classic-letterhead" };
const reportOf = (cultureResult) => ({ patientName: "B/O BHARTI KUMARI", billNo: "DUMMY-001", age: "1D", gender: "M", reportStatus: "Final", groups: [], cultureResults: [cultureResult] });
const REF_RESULTS = [["R"], ["R"], ["R"], ["R"], ["R"], ["NT"], ["NT"], ["S", "++"], ["NT"], ["R"], ["S", "++++"], ["R"], ["R"], ["NT"], ["S", "++"], ["R"], ["S", "++++"]];
const refCr = { ...cr, organisms: [{ organismId: "pa", organismName: "Pseudomonas aeruginosa", comments: "Multidrug-resistant isolate.", sensitivities: REF.map((name, i) => ({ antibioticId: slug(name), antibioticName: name, micValue: "", micUnit: "µg/mL", zoneDiameter: "", zoneUnit: "mm", sir: REF_RESULTS[i][0], grade: REF_RESULTS[i][1] || "", comment: "" })) }], comments: "Repeat culture advised.", resistanceMarkers: { ESBL: "Not Detected" } };
const text = (html) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<[^>]+>/g, " ").replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const markOf = { S: "S", R: "R", NT: "X" };

function verifyRendering(label, html, { headerRepeats = true } = {}) {
  const t = text(html);
  check(`${label}: patient/specimen/organism lines`, t.includes("Suction Tip") && t.includes("ORGANISM ISOLATED: Pseudomonas aeruginosa"));
  check(`${label}: culture result shown`, /Culture(:| ) ?Growth Detected|CULTURE: Growth Detected/i.test(t));
  check(`${label}: is a real table with header row`, html.includes('<table class="cs-table">') && html.includes("<thead>") && /Drug/i.test(html));
  REF.forEach((name, i) => {
    const want = markOf[REF_RESULTS[i][0]] + (REF_RESULTS[i][1] ? `(${REF_RESULTS[i][1]})` : "");
    const row = new RegExp(`<td class="cs-c-num">${i + 1}</td>\\s*<td class="cs-c-drug">${name.replace(/[/]/g, "\\/")}[\\s\\S]*?<td class="cs-c-res[^"]*">${want.replace(/[()+]/g, "\\$&")}</td>`);
    check(`${label}: row ${i + 1} ${name} => ${want}`, row.test(html));
  });
  check(`${label}: no MIC column when nothing recorded`, !html.includes('<th class="cs-c-mic">'));
  check(`${label}: legend R/S/I + X (X is used)`, t.includes("R - RESISTANT, S - SENSITIVE, I - INTERMEDIATE, X - NOT TESTED"));
  check(`${label}: AST standard printed`, t.includes("interpreted as per CLSI M100 34th ed."));
  check(`${label}: organism + general comments`, t.includes("Multidrug-resistant isolate.") && t.includes("Repeat culture advised."));
  if (headerRepeats) check(`${label}: CSS repeats header + keeps rows whole`, /thead\s*\{\s*display:\s*table-header-group/.test(html) && /tr\s*\{\s*page-break-inside:\s*avoid/.test(html));
}
verifyRendering("template", T.renderReportDocument(reportOf(refCr), branding, {}));

// MIC column, custom specimen, hidden AST line, sterile, two organisms
const micCr = { ...refCr, specimenId: "", specimenName: "Drain fluid", astStandard: { name: "CLSI", version: "x", show: false },
  organisms: [
    { organismName: "Pseudomonas aeruginosa", sensitivities: [{ antibioticName: "Meropenem", micValue: ">16", micUnit: "µg/mL", zoneDiameter: "", sir: "R", grade: "", comment: "" }, { antibioticName: "Amikacin", micValue: "0.5", micUnit: "µg/mL", zoneDiameter: "22", zoneUnit: "mm", sir: "S", grade: "", comment: "confirmed" }] },
    { organismName: "Candida albicans", sensitivities: [] }
  ] };
const micHtml = T.renderReportDocument(reportOf(micCr), branding, {});
const micT = text(micHtml);
check("template: MIC/Zone column appears when a value exists", micHtml.includes('<th class="cs-c-mic">'));
check("template: MIC and zone values printed", micT.includes(">16 µg/mL") && micT.includes("0.5 µg/mL") && micT.includes("22 mm"));
check("template: custom specimen printed", micT.includes("Drain fluid"));
check("template: AST line hidden when configured off", !micT.includes("interpreted as per"));
check("template: second organism gets its own block", micT.includes("ORGANISM ISOLATED: Candida albicans") && micT.includes("No antibiotic susceptibility results"));
check("template: drug comment printed", micT.includes("confirmed"));
check("template: sterile text", text(T.renderReportDocument(reportOf({ ...refCr, cultureResult: "Sterile", organisms: [] }), branding, {})).includes("sterile"));
check("template: HTML-escapes hostile text", !T.renderReportDocument(reportOf({ ...refCr, specimenName: "<img src=x onerror=1>" }), branding, {}).includes("<img src=x"));
check("template: old report without astStandard prints without error", (() => { const o = { ...refCr }; delete o.astStandard; return T.renderReportDocument(reportOf(o), branding, {}).includes("cs-table"); })());
for (const tpl of ["minimal-clinical", "modern-diagnostic", "traditional-pathology", "hospital-style", "classic-letterhead"])
  check(`template ${tpl} renders C&S table`, T.renderReportDocument(reportOf(refCr), { ...branding, reportTemplate: tpl }, {}).includes('<table class="cs-table">'));

// ---- result mapping, blank rows, incomplete report ----
eq("display: S", L.SIR_DISPLAY.S, "Sensitive"); eq("display: I", L.SIR_DISPLAY.I, "Intermediate"); eq("display: R", L.SIR_DISPLAY.R, "Resistant");
eq("print mark I is I (not IMS)", L.SIR_PRINT_MARK.I, "I");
eq("legacy IMS normalises to I", [L.normalizeSir("IMS"), L.normalizeSir("i"), L.normalizeSir("Sensitive")], ["I", "i", "S"]);
eq("formatSirMark grade", L.formatSirMark({ sir: "S", grade: "++" }), "S(++)");
eq("formatSirMark blank result but MIC", L.formatSirMark({ sir: "", micValue: "4" }), "—");
check("blank row is not reportable; MIC-only row is", !L.isReportableRow({ sir: "" }) && L.isReportableRow({ sir: "", micValue: "4" }) && L.isReportableRow({ sir: "NT" }));
eq("legend without X/NA", L.sirLegend([{ sir: "S" }, { sir: "R" }]), "R - RESISTANT, S - SENSITIVE, I - INTERMEDIATE");
eq("legend with X and NA", L.sirLegend([{ sir: "NT" }, { sir: "NA" }]), "R - RESISTANT, S - SENSITIVE, I - INTERMEDIATE, X - NOT TESTED, NA - NOT APPLICABLE");
const partial = { ...refCr, organisms: [{ organismId: "pa", organismName: "Pseudomonas aeruginosa", sensitivities: REF.map((name, i) => ({ antibioticId: slug(name), antibioticName: name, micValue: "", micUnit: "µg/mL", zoneDiameter: "", zoneUnit: "mm", sir: i < 5 ? ["S", "R", "I", "R", "S"][i] : "", grade: "", comment: "" })) }] };
const partialHtml = T.renderReportDocument(reportOf(partial), branding, {});
const partialRows = (partialHtml.match(/<td class="cs-c-num">/g) || []).length;
eq("incomplete report (5 of 17 entered): only 5 rows printed", partialRows, 5);
check("incomplete report: unentered drugs are NOT printed or invented", !text(partialHtml).includes("Cefepime") && !text(partialHtml).includes("Polymyxin") && !/\bX\b/.test(text(partialHtml).replace(/X - NOT TESTED/g, "")));
check("incomplete report: intermediate prints as I and legend has no X", text(partialHtml).includes("Amoxicillin/Clavulanate I") && !text(partialHtml).includes("X - NOT TESTED"));
check("incomplete report validates for release", L.cultureValidationError([partial]) === "");
const legacyIms = { ...partial, organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticName: "Ampicillin", sir: "IMS", grade: "" }] }] };
check("legacy IMS value still prints (as I)", text(T.renderReportDocument(reportOf(legacyIms), branding, {})).includes("Ampicillin I"));
const allBlank = { ...partial, organisms: [{ organismName: "E. coli", sensitivities: [{ antibioticName: "Ampicillin", sir: "" }] }] };
check("organism with only blank rows prints the 'no results' note", text(T.renderReportDocument(reportOf(allBlank), branding, {})).includes("No antibiotic susceptibility results"));

// Patient-facing report.html has its own copy of the renderer - extract and run it.
const rh = fs.readFileSync(path.join(root, "report.html"), "utf8");
const start = rh.indexOf("const SIR_MARK"); const fnStart = rh.indexOf("function cultureResultSection", start);
const fnEnd = rh.indexOf("function cultureResultPageHtml", fnStart);
const safe = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const patientRender = new Function("safe", rh.slice(start, fnEnd) + "\nreturn cultureResultSection;")(safe);
const pHtml = patientRender(refCr);
verifyRendering("report.html", pHtml, { headerRepeats: false });
{ const pp = text(patientRender(partial)); check("report.html: incomplete report prints 5 rows, no invented X", (patientRender(partial).match(/<td class="cs-c-num">/g) || []).length === 5 && !pp.includes("X - NOT TESTED"));
  check("report.html: legacy IMS prints as I", text(patientRender(legacyIms)).includes("Ampicillin I")); }
check("report.html: CSS repeats header + keeps rows whole", /\.cs-table thead\s*\{\s*display:\s*table-header-group/.test(rh) && /\.cs-table tr\s*\{\s*page-break-inside:\s*avoid/.test(rh));
check("report.html: long drug names wrap", /\.cs-table \.cs-c-drug\s*\{[^}]*overflow-wrap:\s*anywhere/.test(rh));
check("report.html: hostile text escaped", !patientRender({ ...refCr, specimenName: "<script>1</script>" }).includes("<script>1"));
check("report.html: MIC column", patientRender(micCr).includes('<th class="cs-c-mic">'));
check("report.html: legacy report without astStandard renders", (() => { const o = { ...legacy }; return patientRender(o).includes("Ampicillin"); })());

// ============ 7. Catalogue + safety ============
const cat = JSON.parse(fs.readFileSync(path.join(root, "data/tests.json"), "utf8"));
const csTests = cat.filter((t) => t.reportType === "cultureSensitivity");
check("catalogue: 22 culture-and-sensitivity tests flagged for the C&S editor", csTests.length === 22, String(csTests.length));
check("catalogue: 'Tip C & S' (KT0593) and generic 'Culture & Sensitivity (Other Specimen)' (KT0207) are flagged", ["KT0593", "KT0207"].every((c) => cat.find((t) => t.testCode === c)?.reportType === "cultureSensitivity"));
check("catalogue: duplicate KT0685 removed", !cat.some((t) => t.testCode === "KT0685"));
check("catalogue: no non-C&S test was flagged", csTests.every((t) => /sensitiv|sensetiv|c\s*&\s*s|c and s|c\+s/i.test(t.name)));
check("catalogue: flagged tests are searchable as C/S", csTests.every((t) => t.searchKeywords.includes("c/s")));
check("catalogue: CBC/LFT/KFT/etc untouched (no reportType)", cat.filter((t) => /^(cbc|lft|kft|lipid|tsh|esr)/i.test(t.name)).every((t) => !t.reportType));
const seed = JSON.parse(fs.readFileSync(path.join(root, "data/seed-catalogue.json"), "utf8"));
check("seed catalogue matches tests.json flags", seed.filter((t) => t.reportType === "cultureSensitivity").length === 22 && !seed.some((t) => t.testCode === "KT0685"));
const importPage = fs.readFileSync(path.join(root, "admin-import-tests.html"), "utf8");
check("catalogue import writes reportType only when the catalogue defines it", /\.\.\.\(test\.reportType \? \{ reportType: test\.reportType \} : \{\}\)/.test(importPage));
const sanitizeSrc = fs.readFileSync(path.join(root, "..", "functions/lib/sanitize.js"), "utf8");
check("cloud-function share whitelist carries cultureResults", /"cultureResults"/.test(sanitizeSrc));
check("catalogue: no duplicate test codes", new Set(cat.map((t) => t.testCode)).size === cat.length);
const rules = fs.readFileSync(path.join(root, "firestore.rules"), "utf8");
check("rules: AST setting is not world-writable", /match \/settings\/\{key\}[\s\S]{0,200}allow write: if isAdmin\(\)/.test(rules));
check("rules: C&S masters are admin-write", ["csSpecimens", "csOrganisms", "csAntibiotics", "csPanels", "csBreakpoints"].every((c) => new RegExp(`match /${c}/\\{\\w+\\}[\\s\\S]{0,120}allow write: if isAdmin\\(\\)`).test(rules)));
const share = fs.readFileSync(path.join(root, "admin/report-share.js"), "utf8");
check("share link carries cultureResults (WhatsApp / secure link)", /"groups", "cultureResults"/.test(share));
check("no service-account / private key material in C&S files", ["core/culture-logic.js", "core/data/culture.js", "admin/culture-report-entry.js", "admin/culture-masters-screen.js"].every((f) => !/private_key|BEGIN PRIVATE|AIza[0-9A-Za-z_-]{30}/.test(fs.readFileSync(path.join(root, f), "utf8"))));

console.log(`${passed} passed, ${failures.length} failed`);
failures.forEach((f) => console.log("  FAIL: " + f));
process.exit(failures.length ? 1 : 0);
