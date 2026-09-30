// Culture & Sensitivity master data: Specimens, Organisms, Antibiotics,
// Antibiotic Panels, Breakpoints. Same modal + table + Firestore setDoc
// pattern as the Test Catalogue (admin/admin.js renderCatalogue()/openTestDialog()),
// admin-only per the "do not expose master-data editing to technicians" rule.
import * as Culture from "../core/data/culture.js";
import { sessionCanWrite } from "../core/session.js";
import { PERMISSIONS as P } from "../core/roles.js";
import {
  $, esc, toastOk, toastError, reportError, setBusy, openModal, confirmAction, renderRows, pill
} from "../core/ui.js";

let ctx = { session: null };
let cache = { specimens: [], organisms: [], antibiotics: [], panels: [], breakpoints: [] };

export function initCultureMastersScreen(context) {
  ctx = context;
  $("#addSpecimenBtn")?.addEventListener("click", () => openSpecimenDialog(null));
  $("#addOrganismBtn")?.addEventListener("click", () => openOrganismDialog(null));
  $("#addAntibioticBtn")?.addEventListener("click", () => openAntibioticDialog(null));
  $("#addCulturePanelBtn")?.addEventListener("click", () => openPanelDialog(null));
  $("#addBreakpointBtn")?.addEventListener("click", () => openBreakpointDialog(null));
  $("#loadStarterSpecimensBtn")?.addEventListener("click", loadStarterSpecimens);
  $("#loadStarterOrganismsBtn")?.addEventListener("click", loadStarterOrganisms);
  $("#loadStarterAntibioticsBtn")?.addEventListener("click", loadStarterAntibiotics);
  $("#saveAstStandardBtn")?.addEventListener("click", saveAstStandard);
}

const canManage = () => sessionCanWrite(P.CULTURE_MASTER_MANAGE, ctx.session);

/** Called by admin.js when the Culture Masters tab is opened. */
export async function renderCultureMasters() {
  const [specimens, organisms, antibiotics, panels, breakpoints] = await Promise.all([
    Culture.loadSpecimens(), Culture.loadOrganisms(), Culture.loadAntibiotics(),
    Culture.loadPanels(), Culture.loadBreakpoints()
  ]);
  cache = { specimens, organisms, antibiotics, panels, breakpoints };
  renderSpecimens();
  renderOrganisms();
  renderAntibiotics();
  renderPanels();
  renderBreakpoints();
  renderAstStandard(await Culture.loadAstStandard({ force: true }).catch(() => Culture.normalizeAstStandard()));
}

function renderAstStandard(ast) {
  const form = $("#astStandardForm");
  if (!form) return;
  $("#astStandardName").innerHTML = `<option value="">Not configured</option>` +
    Culture.AST_STANDARD_NAMES.map((n) => `<option ${n === ast.standardName ? "selected" : ""}>${esc(n)}</option>`).join("");
  form.version.value = ast.version; form.effectiveDate.value = ast.effectiveDate; form.notes.value = ast.notes;
  form.showOnReport.checked = ast.showOnReport !== false;
  $("#saveAstStandardBtn").disabled = !canManage();
}

async function saveAstStandard(event) {
  const form = $("#astStandardForm");
  setBusy(event.target, true);
  try {
    await Culture.saveAstStandard({
      standardName: form.standardName.value, version: form.version.value.trim(),
      effectiveDate: form.effectiveDate.value, notes: form.notes.value.trim(), showOnReport: form.showOnReport.checked
    });
    toastOk("AST standard saved.");
  } catch (error) { reportError(error, "Could not save the AST standard."); }
  finally { setBusy(event.target, false); }
}

function orgName(id) { return cache.organisms.find((o) => o.id === id)?.name || id || "—"; }
function abxName(id) { return cache.antibiotics.find((a) => a.id === id)?.displayName || id || "—"; }
function specimenName(id) { return cache.specimens.find((s) => s.id === id)?.name || id || "Any"; }

// ---------- specimens ----------

function renderSpecimens() {
  renderRows("csSpecimensBody", cache.specimens, (s) => `
    <tr><td><b>${esc(s.name)}</b></td><td>${pill(s.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${canManage() ? `
        <button class="btn btn-sm btn-outline" data-edit-specimen="${esc(s.id)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-specimen="${esc(s.id)}" data-active="${s.isActive}" type="button">
          ${s.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`,
    { colspan: 3, empty: "No specimen types yet." });
}

const STARTER_SPECIMENS = [
  "Urine", "Blood", "Pus", "Wound Swab", "Sputum", "Throat Swab", "Nasal Swab",
  "Vaginal Swab", "Cervical Swab", "Semen", "Stool", "CSF", "Body Fluid",
  "Ascitic Fluid", "Pleural Fluid", "Synovial Fluid", "BAL", "ET Aspirate", "Tissue",
  "Catheter Tip", "Suction Tip", "Ear Swab", "Eye Swab", "Skin Swab", "Other"
];

async function loadStarterSpecimens() {
  const existing = new Set(cache.specimens.map((s) => s.name.toLowerCase()));
  const toAdd = STARTER_SPECIMENS.filter((name) => !existing.has(name.toLowerCase()));
  if (!toAdd.length) return toastOk("Every starter specimen type is already in your list.");
  if (!await confirmAction(`Add ${toAdd.length} starter specimen type(s) (Urine, Blood, Pus, ...)? You can edit or deactivate any of them afterward.`)) return;
  try {
    await Promise.all(toAdd.map((name) => Culture.saveSpecimen(null, { name })));
    toastOk(`Added ${toAdd.length} specimen type(s).`);
    await renderCultureMasters();
  } catch (error) { reportError(error, "Could not add the starter specimens."); }
}

function openSpecimenDialog(specimen) {
  const { element, close } = openModal({
    title: specimen ? `Edit ${specimen.name}` : "Add specimen type",
    body: `<form id="specimenForm"><div class="form-grid">
        <label class="field"><span>Name *</span><input name="name" value="${esc(specimen?.name || "")}" required></label>
      </div>
      <label class="field"><span>Notes</span><input name="notes" value="${esc(specimen?.notes || "")}"></label>
      <label class="field"><input type="checkbox" name="isActive" ${specimen?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readFormEl(element.querySelector("#specimenForm"));
      await Culture.saveSpecimen(specimen?.id, data);
      toastOk("Specimen saved.");
      close(); await renderCultureMasters();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- organisms ----------

// ---------- starter lists ----------
// Objective taxonomy (Gram reaction, morphology, aerobicity), not a clinical
// judgment call - unlike breakpoints/S-I-R/resistance rules, this is safe to
// pre-fill. Antibiotics are seeded with NO applicableOrganismIds/
// applicableSpecimenIds so nothing is implicitly "universal" - the admin
// still configures which antibiotics apply to which organism/specimen via
// Antibiotic Panels, per the "lab administrator must control this" rule.
const STARTER_ORGANISMS = [
  { name: "Escherichia coli", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Klebsiella pneumoniae", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Pseudomonas aeruginosa", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Aerobic" },
  { name: "Proteus mirabilis", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Enterococcus faecalis", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Enterococcus faecium", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Staphylococcus aureus", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Staphylococcus epidermidis", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Streptococcus pyogenes", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Streptococcus pneumoniae", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Acinetobacter baumannii", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Coccobacilli", aerobicity: "Aerobic" },
  { name: "Candida albicans", organismType: "Yeast", gramReaction: "Not Applicable", morphology: "Yeast", aerobicity: "Aerobic" },
  { name: "Proteus vulgaris", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Enterobacter spp.", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Citrobacter spp.", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Serratia spp.", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Morganella spp.", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Facultative Anaerobic" },
  { name: "Streptococcus spp.", organismType: "Bacteria", gramReaction: "Gram Positive", morphology: "Cocci", aerobicity: "Facultative Anaerobic" },
  { name: "Candida spp.", organismType: "Yeast", gramReaction: "Not Applicable", morphology: "Yeast", aerobicity: "Aerobic" },
  { name: "Bacteroides fragilis", organismType: "Bacteria", gramReaction: "Gram Negative", morphology: "Bacilli", aerobicity: "Anaerobic" }
];

const STARTER_ANTIBIOTICS = [
  { displayName: "Ampicillin", antibioticClass: "Penicillin" },
  { displayName: "Amoxicillin/Clavulanate", abbreviation: "AMC", antibioticClass: "Penicillin + Beta-lactamase Inhibitor" },
  { displayName: "Cefuroxime", antibioticClass: "Cephalosporin (2nd gen)" },
  { displayName: "Ceftriaxone", antibioticClass: "Cephalosporin (3rd gen)" },
  { displayName: "Cefixime", antibioticClass: "Cephalosporin (3rd gen)" },
  { displayName: "Ceftazidime", abbreviation: "CAZ", antibioticClass: "Cephalosporin (3rd gen)" },
  { displayName: "Cefepime", abbreviation: "CPM", antibioticClass: "Cephalosporin (4th gen)" },
  { displayName: "Gentamicin", abbreviation: "GEN", antibioticClass: "Aminoglycoside" },
  { displayName: "Amikacin", abbreviation: "AK", antibioticClass: "Aminoglycoside" },
  { displayName: "Ciprofloxacin", antibioticClass: "Fluoroquinolone" },
  { displayName: "Levofloxacin", abbreviation: "LE", antibioticClass: "Fluoroquinolone" },
  { displayName: "Nitrofurantoin", antibioticClass: "Nitrofuran" },
  { displayName: "Trimethoprim/Sulfamethoxazole", antibioticClass: "Folate Pathway Inhibitor" },
  { displayName: "Piperacillin/Tazobactam", abbreviation: "PIT", antibioticClass: "Penicillin + Beta-lactamase Inhibitor" },
  { displayName: "Meropenem", abbreviation: "MEM", antibioticClass: "Carbapenem" },
  { displayName: "Imipenem", abbreviation: "IPM", antibioticClass: "Carbapenem" },
  { displayName: "Vancomycin", abbreviation: "VA", antibioticClass: "Glycopeptide" },
  { displayName: "Linezolid", antibioticClass: "Oxazolidinone" },
  { displayName: "Clindamycin", antibioticClass: "Lincosamide" },
  { displayName: "Erythromycin", abbreviation: "E", antibioticClass: "Macrolide" },
  { displayName: "Tetracycline", antibioticClass: "Tetracycline" },
  { displayName: "Cefoxitin", antibioticClass: "Cephamycin" },
  { displayName: "Penicillin", antibioticClass: "Penicillin" },
  { displayName: "Ampicillin/Sulbactam", antibioticClass: "Penicillin + Beta-lactamase Inhibitor" },
  { displayName: "Cefazolin", abbreviation: "CZ", antibioticClass: "Cephalosporin (1st gen)" },
  { displayName: "Cefotaxime", abbreviation: "CTX", antibioticClass: "Cephalosporin (3rd gen)" },
  { displayName: "Ceftizoxime", antibioticClass: "Cephalosporin (3rd gen)" },
  { displayName: "Ofloxacin", abbreviation: "OF", antibioticClass: "Fluoroquinolone" },
  { displayName: "Tobramycin", abbreviation: "TOB", antibioticClass: "Aminoglycoside" },
  { displayName: "Chloramphenicol", abbreviation: "C", antibioticClass: "Amphenicol" },
  { displayName: "Metronidazole", antibioticClass: "Nitroimidazole (Anaerobic Cover)" },
  { displayName: "Polymyxin B", abbreviation: "PB", antibioticClass: "Polymyxin" }
];

async function loadStarterOrganisms() {
  const existing = new Set(cache.organisms.map((o) => o.name.toLowerCase()));
  const toAdd = STARTER_ORGANISMS.filter((o) => !existing.has(o.name.toLowerCase()));
  if (!toAdd.length) return toastOk("Every starter organism is already in your list.");
  if (!await confirmAction(`Add ${toAdd.length} starter organism(s) (E. coli, Klebsiella, Pseudomonas, ...)? You can edit or deactivate any of them afterward.`)) return;
  try {
    await Promise.all(toAdd.map((o) => Culture.saveOrganism(null, o)));
    toastOk(`Added ${toAdd.length} organism(s).`);
    await renderCultureMasters();
  } catch (error) { reportError(error, "Could not add the starter organisms."); }
}

async function loadStarterAntibiotics() {
  const existing = new Set(cache.antibiotics.map((a) => a.displayName.toLowerCase()));
  const toAdd = STARTER_ANTIBIOTICS.filter((a) => !existing.has(a.displayName.toLowerCase()));
  if (!toAdd.length) return toastOk("Every starter antibiotic is already in your list.");
  if (!await confirmAction(`Add ${toAdd.length} starter antibiotic(s) (Ampicillin, Ciprofloxacin, Vancomycin, ...)? You can edit or deactivate any of them afterward.`)) return;
  try {
    await Promise.all(toAdd.map((a) => Culture.saveAntibiotic(null, a)));
    toastOk(`Added ${toAdd.length} antibiotic(s).`);
    await renderCultureMasters();
  } catch (error) { reportError(error, "Could not add the starter antibiotics."); }
}

function renderOrganisms() {
  renderRows("csOrganismsBody", cache.organisms, (o) => `
    <tr><td><b>${esc(o.name)}</b><br><span class="small muted">${esc(o.scientificName)}</span></td>
      <td class="small">${esc(o.gramReaction || "—")}</td>
      <td class="small">${esc(o.aerobicity || "—")}</td>
      <td>${pill(o.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${canManage() ? `
        <button class="btn btn-sm btn-outline" data-edit-organism="${esc(o.id)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-organism="${esc(o.id)}" data-active="${o.isActive}" type="button">
          ${o.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`,
    { colspan: 5, empty: "No organisms yet." });
}

function openOrganismDialog(organism) {
  const { element, close } = openModal({
    title: organism ? `Edit ${organism.name}` : "Add organism",
    wide: true,
    body: `<form id="organismForm"><div class="form-grid">
        <label class="field"><span>Name *</span><input name="name" value="${esc(organism?.name || "")}" required></label>
        <label class="field"><span>Scientific name</span><input name="scientificName" value="${esc(organism?.scientificName || "")}"></label>
        <label class="field"><span>Organism type</span><input name="organismType" value="${esc(organism?.organismType || "")}" placeholder="Bacteria, Yeast, ..."></label>
        <label class="field"><span>Gram reaction</span><select name="gramReaction">
          <option value="">—</option>
          ${Culture.GRAM_REACTIONS.map((g) => `<option ${g === organism?.gramReaction ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Morphology</span><input name="morphology" value="${esc(organism?.morphology || "")}" placeholder="Cocci, Bacilli, ..."></label>
        <label class="field"><span>Aerobic/Anaerobic</span><select name="aerobicity">
          <option value="">—</option>
          ${Culture.AEROBICITY.map((a) => `<option ${a === organism?.aerobicity ? "selected" : ""}>${esc(a)}</option>`).join("")}
        </select></label>
      </div>
      <label class="field"><span>Notes</span><textarea name="notes">${esc(organism?.notes || "")}</textarea></label>
      <label class="field"><input type="checkbox" name="isActive" ${organism?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readFormEl(element.querySelector("#organismForm"));
      await Culture.saveOrganism(organism?.id, data);
      toastOk("Organism saved.");
      close(); await renderCultureMasters();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- antibiotics ----------

function renderAntibiotics() {
  renderRows("csAntibioticsBody", cache.antibiotics, (a) => `
    <tr><td><b>${esc(a.displayName)}</b><br><span class="small muted">${esc(a.genericName)}</span></td>
      <td class="small">${esc(a.abbreviation || "—")}</td>
      <td class="small">${esc(a.antibioticClass || "—")}</td>
      <td class="small">${esc(a.testingMethod)}</td>
      <td>${pill(a.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${canManage() ? `
        <button class="btn btn-sm btn-outline" data-edit-antibiotic="${esc(a.id)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-antibiotic="${esc(a.id)}" data-active="${a.isActive}" type="button">
          ${a.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`,
    { colspan: 6, empty: "No antibiotics yet." });
}

function openAntibioticDialog(antibiotic) {
  const { element, close } = openModal({
    title: antibiotic ? `Edit ${antibiotic.displayName}` : "Add antibiotic",
    wide: true,
    body: `<form id="antibioticForm"><div class="form-grid">
        <label class="field"><span>Display name *</span><input name="displayName" value="${esc(antibiotic?.displayName || "")}" required></label>
        <label class="field"><span>Generic name</span><input name="genericName" value="${esc(antibiotic?.genericName || "")}"></label>
        <label class="field"><span>Abbreviation</span><input name="abbreviation" value="${esc(antibiotic?.abbreviation || "")}" placeholder="AK, CAZ, ..."></label>
        <label class="field"><span>Class</span><input name="antibioticClass" value="${esc(antibiotic?.antibioticClass || "")}" placeholder="Fluoroquinolone, ..."></label>
        <label class="field"><span>Testing method</span><select name="testingMethod">
          ${Culture.TESTING_METHODS.map((m) => `<option ${m === antibiotic?.testingMethod ? "selected" : ""}>${esc(m)}</option>`).join("")}
        </select></label>
        <label class="field"><span>MIC unit</span><input name="micUnit" value="${esc(antibiotic?.micUnit || "µg/mL")}"></label>
      </div>
      <label class="field"><span>Reporting notes</span><input name="reportingNotes" value="${esc(antibiotic?.reportingNotes || "")}"></label>
      <label class="field"><input type="checkbox" name="isActive" ${antibiotic?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readFormEl(element.querySelector("#antibioticForm"));
      await Culture.saveAntibiotic(antibiotic?.id, data);
      toastOk("Antibiotic saved.");
      close(); await renderCultureMasters();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- antibiotic panels ----------

function renderPanels() {
  renderRows("csPanelsBody", cache.panels, (p) => `
    <tr><td><b>${esc(p.name)}</b></td>
      <td class="small">${esc(specimenName(p.specimenId))}</td>
      <td class="small">${p.organismId ? esc(orgName(p.organismId)) : "Any"}</td>
      <td class="small">${esc(p.gramReaction || "Any")}</td>
      <td class="small">${p.antibioticIds.length} antibiotics</td>
      <td>${pill(p.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${canManage() ? `
        <button class="btn btn-sm btn-outline" data-edit-panel="${esc(p.id)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-panel="${esc(p.id)}" data-active="${p.isActive}" type="button">
          ${p.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`,
    { colspan: 7, empty: "No antibiotic panels yet. “Auto Fill Sensitivity Panel” has nothing to load until one is added." });
}

function openPanelDialog(panel) {
  const { element, close } = openModal({
    title: panel ? `Edit ${panel.name}` : "Add antibiotic panel",
    wide: true,
    body: `<form id="panelForm"><div class="form-grid">
        <label class="field"><span>Panel name *</span><input name="name" value="${esc(panel?.name || "")}" placeholder="Urine – Gram Negative Panel" required></label>
        <label class="field"><span>Specimen (optional)</span><select name="specimenId">
          <option value="">Any specimen</option>
          ${cache.specimens.map((s) => `<option value="${esc(s.id)}" ${s.id === panel?.specimenId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Organism (optional)</span><select name="organismId">
          <option value="">Any organism</option>
          ${cache.organisms.filter((o) => o.isActive).map((o) => `<option value="${esc(o.id)}" ${o.id === panel?.organismId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Gram reaction (optional)</span><select name="gramReaction">
          <option value="">Any</option>
          ${Culture.GRAM_REACTIONS.map((g) => `<option ${g === panel?.gramReaction ? "selected" : ""}>${esc(g)}</option>`).join("")}
        </select></label>
      </div>
      <label class="field"><span>Antibiotics in this panel</span>
        <select name="antibioticIds" multiple size="10">
          ${cache.antibiotics.filter((a) => a.isActive).map((a) =>
            `<option value="${esc(a.id)}" ${(panel?.antibioticIds || []).includes(a.id) ? "selected" : ""}>${esc(a.displayName)}</option>`).join("")}
        </select>
      </label>
      <label class="field"><input type="checkbox" name="isActive" ${panel?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readFormEl(element.querySelector("#panelForm"));
      data.antibioticIds = Array.from(element.querySelectorAll('[name="antibioticIds"] option:checked')).map((o) => o.value);
      await Culture.savePanel(panel?.id, data);
      toastOk("Panel saved.");
      close(); await renderCultureMasters();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- breakpoints ----------

function renderBreakpoints() {
  renderRows("csBreakpointsBody", cache.breakpoints, (b) => `
    <tr><td class="small">${esc(orgName(b.organismId))}</td>
      <td class="small">${esc(abxName(b.antibioticId))}</td>
      <td class="small">${esc(b.testingMethod)}</td>
      <td class="small">${esc(b.standard)} ${esc(b.standardVersion || "")}</td>
      <td class="small mono">${b.micSMax != null ? `MIC ≤${b.micSMax}/≥${b.micRMin}` : ""}${b.zoneSMin != null ? ` Zone ≥${b.zoneSMin}/≤${b.zoneRMax}` : ""}</td>
      <td>${pill(b.isActive ? "Active" : "Inactive")}</td>
      <td class="actions">${canManage() ? `
        <button class="btn btn-sm btn-outline" data-edit-breakpoint="${esc(b.id)}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-toggle-breakpoint="${esc(b.id)}" data-active="${b.isActive}" type="button">
          ${b.isActive ? "Deactivate" : "Activate"}</button>` : ""}</td></tr>`,
    { colspan: 7, empty: "No breakpoints configured. S/I/R cannot be auto-interpreted until this laboratory's applicable standard is entered here." });
}

function openBreakpointDialog(breakpoint) {
  const { element, close } = openModal({
    title: breakpoint ? "Edit breakpoint" : "Add breakpoint",
    wide: true,
    body: `<form id="breakpointForm"><div class="form-grid">
        <label class="field"><span>Organism *</span><select name="organismId" required>
          <option value="">Select…</option>
          ${cache.organisms.filter((o) => o.isActive).map((o) => `<option value="${esc(o.id)}" ${o.id === breakpoint?.organismId ? "selected" : ""}>${esc(o.name)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Antibiotic *</span><select name="antibioticId" required>
          <option value="">Select…</option>
          ${cache.antibiotics.filter((a) => a.isActive).map((a) => `<option value="${esc(a.id)}" ${a.id === breakpoint?.antibioticId ? "selected" : ""}>${esc(a.displayName)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Testing method</span><select name="testingMethod">
          ${Culture.TESTING_METHODS.map((m) => `<option ${m === breakpoint?.testingMethod ? "selected" : ""}>${esc(m)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Standard</span><select name="standard">
          ${Culture.BREAKPOINT_STANDARDS.map((s) => `<option ${s === breakpoint?.standard ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select></label>
        <label class="field"><span>Standard version</span><input name="standardVersion" value="${esc(breakpoint?.standardVersion || "")}" placeholder="e.g. 2024"></label>
      </div>
      <p class="small muted" style="margin:6px 0;">Leave a pair blank if this antibiotic isn't tested that way for this organism. Enter values exactly as printed in your chosen standard's table — nothing here is calculated or guessed.</p>
      <div class="form-grid">
        <label class="field"><span>MIC unit</span><input name="micUnit" value="${esc(breakpoint?.micUnit || "µg/mL")}"></label>
        <label class="field"><span>MIC ≤ (Susceptible)</span><input name="micSMax" type="number" step="any" value="${breakpoint?.micSMax ?? ""}"></label>
        <label class="field"><span>MIC ≥ (Resistant)</span><input name="micRMin" type="number" step="any" value="${breakpoint?.micRMin ?? ""}"></label>
        <label class="field"><span>Zone unit</span><input name="zoneUnit" value="${esc(breakpoint?.zoneUnit || "mm")}"></label>
        <label class="field"><span>Zone ≥ (Susceptible)</span><input name="zoneSMin" type="number" step="any" value="${breakpoint?.zoneSMin ?? ""}"></label>
        <label class="field"><span>Zone ≤ (Resistant)</span><input name="zoneRMax" type="number" step="any" value="${breakpoint?.zoneRMax ?? ""}"></label>
        <label class="field"><span>Effective date</span><input name="effectiveDate" type="date" value="${esc(breakpoint?.effectiveDate || "")}"></label>
      </div>
      <label class="field"><input type="checkbox" name="isActive" ${breakpoint?.isActive !== false ? "checked" : ""}> Active</label>
      </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readFormEl(element.querySelector("#breakpointForm"));
      ["micSMax", "micRMin", "zoneSMin", "zoneRMax"].forEach((k) => {
        data[k] = data[k] === "" ? null : Number(data[k]);
      });
      await Culture.saveBreakpoint(breakpoint?.id, data);
      toastOk("Breakpoint saved.");
      close(); await renderCultureMasters();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- shared form read + delegated actions ----------

/** Same shape as core/ui.js's readForm(), local so this file has no other new dependency. */
function readFormEl(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (data[key] === undefined) data[key] = value;
    else data[key] = [].concat(data[key], value);
  });
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => { data[cb.name] = cb.checked; });
  return data;
}

document.addEventListener("click", async (event) => {
  const t = event.target;

  const editSpecimen = t.closest("[data-edit-specimen]");
  if (editSpecimen) return openSpecimenDialog(cache.specimens.find((s) => s.id === editSpecimen.dataset.editSpecimen));
  const toggleSpecimen = t.closest("[data-toggle-specimen]");
  if (toggleSpecimen) return toggleActive("specimen", toggleSpecimen);

  const editOrganism = t.closest("[data-edit-organism]");
  if (editOrganism) return openOrganismDialog(cache.organisms.find((o) => o.id === editOrganism.dataset.editOrganism));
  const toggleOrganism = t.closest("[data-toggle-organism]");
  if (toggleOrganism) return toggleActive("organism", toggleOrganism);

  const editAntibiotic = t.closest("[data-edit-antibiotic]");
  if (editAntibiotic) return openAntibioticDialog(cache.antibiotics.find((a) => a.id === editAntibiotic.dataset.editAntibiotic));
  const toggleAntibiotic = t.closest("[data-toggle-antibiotic]");
  if (toggleAntibiotic) return toggleActive("antibiotic", toggleAntibiotic);

  const editPanel = t.closest("[data-edit-panel]");
  if (editPanel) return openPanelDialog(cache.panels.find((p) => p.id === editPanel.dataset.editPanel));
  const togglePanel = t.closest("[data-toggle-panel]");
  if (togglePanel) return toggleActive("panel", togglePanel);

  const editBreakpoint = t.closest("[data-edit-breakpoint]");
  if (editBreakpoint) return openBreakpointDialog(cache.breakpoints.find((b) => b.id === editBreakpoint.dataset.editBreakpoint));
  const toggleBreakpoint = t.closest("[data-toggle-breakpoint]");
  if (toggleBreakpoint) return toggleActive("breakpoint", toggleBreakpoint);
});

const TOGGLE = {
  specimen: { setActive: Culture.setSpecimenActive, label: "specimen type" },
  organism: { setActive: Culture.setOrganismActive, label: "organism" },
  antibiotic: { setActive: Culture.setAntibioticActive, label: "antibiotic" },
  panel: { setActive: Culture.setPanelActive, label: "panel" },
  breakpoint: { setActive: Culture.setBreakpointActive, label: "breakpoint" }
};

async function toggleActive(kind, button) {
  const id = button.dataset[`toggle${kind[0].toUpperCase()}${kind.slice(1)}`];
  const active = button.dataset.active !== "true";
  const { setActive, label } = TOGGLE[kind];
  if (!await confirmAction(`${active ? "Activate" : "Deactivate"} this ${label}?`, { danger: !active })) return;
  try {
    await setActive(id, active);
    toastOk("Updated.");
    await renderCultureMasters();
  } catch (error) { reportError(error); }
}
