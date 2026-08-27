// Branding and settings screens (spec sections 11, 25 and 27).
//
// Everything a laboratory can change about how the product looks and behaves
// lives here, and nothing here requires a code change or a redeploy.
import { doc, getDoc, setDoc, getDocs, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { db } from "../core/firebase-config.js";
import { settingsDoc, labDoc, col, getLabId, withLabId } from "../core/tenant.js";
import { loadBranding, applyBranding, clearBrandingCache } from "../core/branding.js";
import {
  TEMPLATES, printReport, templateSource, validateTemplate,
  sanitizeTemplate, TEMPLATE_PLACEHOLDERS
} from "../core/report-templates.js";
import { attachImagePicker, LIMITS } from "../core/image-upload.js";
import { listSignatories } from "../core/data/staff.js";
import { sessionCanWrite } from "../core/session.js";
import { PERMISSIONS as P } from "../core/roles.js";
import { PLANS, planLabel } from "../core/subscription.js";
import { formatDate, clean } from "../core/data/helpers.js";
import { logAudit, AUDIT } from "../core/audit.js";
import {
  $, esc, toastOk, toastError, toastWarn, reportError, setBusy, readForm, fillForm,
  openModal, confirmAction, pill
} from "../core/ui.js";

let ctx = { session: null, branding: null };

export function initSettingsScreens(context) {
  ctx = context;
  hydrateBrandingForm();
  setupImagePickers();
  renderTemplateChooser();
  setupTemplateTools();
  renderSignatories();
  hydrateSettingsForms();
  renderBranches();
  renderSubscriptionCard();

  $("#brandingForm").addEventListener("submit", saveBranding);
  $("#generalForm").addEventListener("submit", (e) => saveSettings(e, "general", AUDIT.SETTINGS_UPDATED));
  $("#paymentForm").addEventListener("submit", (e) => saveSettings(e, "payment", AUDIT.SETTINGS_UPDATED));
  $("#whatsappForm").addEventListener("submit", (e) => saveSettings(e, "whatsapp", AUDIT.SETTINGS_UPDATED));
  $("#previewTemplateBtn").addEventListener("click", previewTemplate);
  $("#addBranchBtn")?.addEventListener("click", () => openBranchDialog(null));
  $("#addSignatoryBtn").addEventListener("click", () => openSignatoryDialog(null));
  $("#importSignatoriesBtn").addEventListener("click", importSignatoriesFromStaff);

  $("#signatoryList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-sig-edit],[data-sig-remove],[data-sig-up],[data-sig-down]");
    if (!button) return;
    const d = button.dataset;
    try {
      if (d.sigEdit !== undefined) return openSignatoryDialog(Number(d.sigEdit));
      if (d.sigRemove !== undefined) {
        const i = Number(d.sigRemove);
        if (!await confirmAction(`Remove ${signatories[i]?.name || "this signatory"} from your reports?`,
          { danger: true, confirmLabel: "Remove" })) return;
        signatories.splice(i, 1);
        await saveSignatories();
        return toastOk("Signatory removed.");
      }
      const i = Number(d.sigUp ?? d.sigDown);
      const j = d.sigUp !== undefined ? i - 1 : i + 1;
      [signatories[i], signatories[j]] = [signatories[j], signatories[i]];
      await saveSignatories();
    } catch (error) { reportError(error); }
  });
}

// ---------- branding ----------

/** Nested social.* fields are flattened for the form and rebuilt on save. */
function flatten(branding) {
  const flat = { ...branding };
  Object.entries(branding.social || {}).forEach(([k, v]) => { flat[`social.${k}`] = v; });
  delete flat.social;
  return flat;
}

function unflatten(data) {
  const out = { social: {} };
  Object.entries(data).forEach(([key, value]) => {
    if (key.startsWith("social.")) out.social[key.slice(7)] = value;
    else out[key] = value;
  });
  return out;
}

function hydrateBrandingForm() {
  fillForm($("#brandingForm"), flatten(ctx.branding));
}

async function saveBranding(event) {
  event.preventDefault();
  if (!sessionCanWrite(P.BRANDING_EDIT, ctx.session)) return reportError(new Error("You cannot edit branding."));
  const button = event.submitter || event.currentTarget.querySelector("[type=submit]");
  setBusy(button, true, "Saving...");
  try {
    const patch = unflatten(readForm(event.currentTarget));
    await setDoc(settingsDoc("branding"), clean({ ...patch, labId: getLabId(), updatedAt: serverTimestamp() }), { merge: true });

    // Keep the registry copy in step so the Super Admin list and the public
    // site show the same name and logo the laboratory just set.
    await setDoc(labDoc(), clean({
      labName: patch.labName, logoUrl: patch.logoUrl, phone: patch.phone,
      whatsapp: patch.whatsapp, email: patch.email, website: patch.website,
      address: patch.address, city: patch.city, state: patch.state, pincode: patch.pincode,
      gstNumber: patch.gstNumber, licenseNumber: patch.licenseNumber,
      updatedAt: serverTimestamp()
    }), { merge: true }).catch(() => { /* registry fields are Super Admin owned; branding still saved */ });

    clearBrandingCache();
    ctx.branding = await loadBranding(getLabId(), { force: true });
    applyBranding(ctx.branding);
    logAudit(AUDIT.BRANDING_UPDATED, { entityType: "settings", entityId: "branding", summary: "Branding updated" });
    toastOk("Branding saved — it is live everywhere immediately.");
  } catch (error) {
    reportError(error, "Could not save branding.");
  } finally {
    setBusy(button, false);
  }
}

// ---------- report template ----------

function renderTemplateChooser() {
  const active = ctx.branding.reportTemplate || "modern-diagnostic";
  $("#templateChooser").innerHTML = TEMPLATES.map((t) => `
    <label class="card" style="box-shadow:none;cursor:pointer;padding:11px 13px;border-color:${
      t.id === active ? "var(--brand-primary)" : "var(--line)"};">
      <div class="row-flex">
        <input type="radio" name="reportTemplate" value="${esc(t.id)}" ${t.id === active ? "checked" : ""}>
        <div><b>${esc(t.name)}</b><div class="small muted">${esc(t.description)}</div></div>
      </div>
    </label>`).join("");

  $("#templateChooser").addEventListener("change", async (event) => {
    if (event.target.name !== "reportTemplate") return;
    try {
      const templateId = event.target.value;
      await setDoc(settingsDoc("report"), { templateId, labId: getLabId(), updatedAt: serverTimestamp() }, { merge: true });
      await setDoc(settingsDoc("branding"), { reportTemplate: templateId, updatedAt: serverTimestamp() }, { merge: true });
      clearBrandingCache();
      ctx.branding = await loadBranding(getLabId(), { force: true });
      renderTemplateChooser();
      toastOk("Report template updated.");
    } catch (error) { reportError(error); }
  });
}

/** Sample report so a laboratory can see a template before committing to it. */
function sampleReport() {
  return {
    reportId: "SAMPLE", billNo: `${getLabId()}-B00042`, patientId: `${getLabId()}-P00017`,
    patientName: "SAMPLE PATIENT", age: "34", gender: "Male", refBy: "Dr. A. Sharma",
    collectionDate: new Date().toISOString(), reportingDate: new Date().toISOString(),
    sampleType: "Whole Blood (EDTA)", reportStatus: "Final",
    // A placeholder link so the scan-to-verify QR shows in the template preview
    // exactly where it will print on a real released report.
    verifyUrl: `${location.origin}/report.html?t=sample-preview`,
    interpretation: "Mild anaemia. Correlate clinically and repeat after four weeks.",
    groups: [{
      testId: "CBC", testCode: "KT0157", testName: "Complete Blood Count (CBC)",
      sample: "Whole Blood (EDTA)", notes: "Analysed on a 5-part differential cell counter.",
      rows: [
        { name: "Haemoglobin", value: "10.4", unit: "g/dL", referenceRange: "13.2 - 16.6", flag: "Low" },
        { name: "Total WBC Count", value: "7800", unit: "/cmm", referenceRange: "4000 - 11000", flag: "" },
        { name: "Platelet Count", value: "1.9", unit: "lakh/cmm", referenceRange: "1.5 - 4.1", flag: "" },
        { name: "Neutrophils", value: "78", unit: "%", referenceRange: "40 - 75", flag: "High" }
      ]
    }, {
      testId: "LFT", testCode: "KT0301", testName: "Liver Function Test (LFT)", sample: "Serum",
      rows: [
        { name: "Total Bilirubin", value: "0.9", unit: "mg/dL", referenceRange: "0.2 - 1.2", flag: "" },
        { name: "SGPT (ALT)", value: "96", unit: "U/L", referenceRange: "< 45", flag: "High" }
      ]
    }]
  };
}

async function previewTemplate() {
  try {
    const snap = await getDoc(settingsDoc("report"));
    printReport(sampleReport(), ctx.branding, snap.exists() ? snap.data() : {});
  } catch (error) { reportError(error, "Could not open the preview."); }
}

// ---------- report signatories ----------
//
// Every laboratory has its OWN technician and pathologist, so these are edited
// here directly rather than being derived from staff accounts. A small lab
// should not have to create a Firebase user just to put a name on a report.
//
// They used to be overwritten from the staff list on every visit to this
// screen, which silently discarded anything typed here. Staff import is now an
// explicit button.

let signatories = [];

async function renderSignatories() {
  try {
    const snap = await getDoc(settingsDoc("report"));
    signatories = Array.isArray(snap.data()?.signatories) ? snap.data().signatories : [];
  } catch {
    $("#signatoryList").innerHTML = `<p class="small muted">Signatories are not readable with your role.</p>`;
    return;
  }
  paintSignatories();
}

function paintSignatories() {
  const host = $("#signatoryList");
  if (!signatories.length) {
    host.innerHTML = `<p class="small muted">
      No signatories yet. Reports will print without a signature block.
      Press <b>Add</b> to enter your technician and pathologist.</p>`;
    return;
  }
  host.innerHTML = signatories.map((s, i) => `
    <div class="row-flex" style="padding:9px 0;border-bottom:1px solid var(--line);align-items:flex-start;">
      <span class="sig-badge">${esc((s.badge || (s.designation || s.name || "?").charAt(0)).toUpperCase().slice(0, 2))}</span>
      <div style="flex:1;min-width:0;">
        <b>${esc(s.name || "(no name)")}</b>
        <div class="small muted">${esc([s.designation, s.qualification].filter(Boolean).join(" · "))}
          ${s.registrationNumber ? ` · Reg. ${esc(s.registrationNumber)}` : ""}</div>
        ${s.canApproveReports ? `<span class="pill ok" style="margin-top:3px;">May approve reports</span>` : ""}
        ${s.signatureUrl ? `<img src="${esc(s.signatureUrl)}" alt="" style="max-height:30px;margin-top:4px;">` : ""}
      </div>
      <div class="btn-row">
        <button class="btn btn-sm btn-ghost" data-sig-up="${i}" type="button" ${i === 0 ? "disabled" : ""} title="Move left on the report">↑</button>
        <button class="btn btn-sm btn-ghost" data-sig-down="${i}" type="button" ${i === signatories.length - 1 ? "disabled" : ""} title="Move right on the report">↓</button>
        <button class="btn btn-sm btn-outline" data-sig-edit="${i}" type="button">Edit</button>
        <button class="btn btn-sm btn-ghost" data-sig-remove="${i}" type="button">Remove</button>
      </div>
    </div>`).join("")
    + `<p class="small muted" style="margin-top:8px;">
        They print left to right in this order, on every page of a report.</p>`;
}

async function saveSignatories() {
  // Written to BOTH settings documents: the printable report reads
  // settings/report, and branding carries a copy so a patient opening a shared
  // link — who cannot read report settings — still gets a signed report.
  const clean = signatories.map((s) => ({
    name: String(s.name || "").trim(),
    designation: String(s.designation || "").trim(),
    qualification: String(s.qualification || "").trim(),
    registrationNumber: String(s.registrationNumber || "").trim(),
    badge: String(s.badge || "").trim().toUpperCase().slice(0, 2),
    signatureUrl: String(s.signatureUrl || ""),
    // Whether this person may approve a clinical report and sign off a
    // medical rule. A technician's name printing on a report does not make
    // them a pathologist, so this is separate and off by default.
    canApproveReports: s.canApproveReports === true
  })).filter((s) => s.name);

  await setDoc(settingsDoc("report"),
    { signatories: clean, labId: getLabId(), updatedAt: serverTimestamp() }, { merge: true });
  await setDoc(settingsDoc("branding"),
    { signatories: clean, updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});

  clearBrandingCache();
  ctx.branding = await loadBranding(getLabId(), { force: true });
  logAudit(AUDIT.SETTINGS_UPDATED, {
    entityType: "settings", entityId: "report",
    summary: `Report signatories updated (${clean.length})`
  });
  signatories = clean;
  paintSignatories();
}

const SIGNATORY_FIELDS = [
  ["name", "Full name", "DR. N. K. SUMAN"],
  ["designation", "Role as printed", "Consultant Pathologist"],
  ["qualification", "Qualification", "MBBS, MD (Pathology)"],
  ["registrationNumber", "Registration number", "REG-2011-8842"],
  ["badge", "Badge letter", "M"]
];

function openSignatoryDialog(index) {
  const existing = index == null ? {} : signatories[index];
  const { element, close } = openModal({
    title: index == null ? "Add signatory" : `Edit ${existing.name || "signatory"}`,
    body: `
      <form id="sigForm"><div class="form-grid">
        ${SIGNATORY_FIELDS.map(([name, label, placeholder]) =>
          `<label class="field"><span>${esc(label)}</span>
            <input name="${name}" value="${esc(existing[name] || "")}" placeholder="${esc(placeholder)}">
          </label>`).join("")}
      </div></form>
      <p class="small muted" style="margin:-4px 0 10px;">
        The badge letter is the initial shown in the circle above the role —
        <b>T</b> for a technician, <b>M</b> for a pathologist. Leave blank to use
        the first letter of the role.
      </p>
      <label class="small" style="display:flex;gap:8px;align-items:flex-start;margin:4px 0 12px;">
        <input type="checkbox" id="sigApprove" ${existing.canApproveReports ? "checked" : ""}
          style="margin-top:3px;">
        <span><b>May approve and sign clinical reports</b><br>
          <span class="muted">Tick this only for a qualified pathologist authorised by this laboratory.
          Only they can release a report's interpretation and sign off a reference interval or a
          calculation. A technician who prints on the report but does not authorise it should be
          left unticked.</span></span>
      </label>
      <div class="small" style="font-weight:600;margin-bottom:5px;">Signature image</div>
      <div class="upload-box">
        <img id="sigPreview" alt="" ${existing.signatureUrl ? `src="${esc(existing.signatureUrl)}"` : "hidden"}>
        <button class="btn btn-outline btn-sm" id="sigPick" type="button">Choose file…</button>
        <button class="btn btn-ghost btn-sm" id="sigClear" type="button">Clear</button>
      </div>
      <div class="small muted" id="sigNote"></div>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save</button>`
  });

  let signatureUrl = existing.signatureUrl || "";
  const preview = element.querySelector("#sigPreview");
  attachImagePicker({
    button: element.querySelector("#sigPick"),
    preview,
    kind: "signature",
    onReady: (result) => {
      signatureUrl = result.dataUrl;
      element.querySelector("#sigNote").textContent = result.note;
    },
    onError: (error) => reportError(error, "Could not use that signature image.")
  });
  element.querySelector("#sigClear").addEventListener("click", () => {
    signatureUrl = "";
    preview.removeAttribute("src");
    preview.hidden = true;
    element.querySelector("#sigNote").textContent = "";
  });

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    const data = readForm(element.querySelector("#sigForm"));
    if (!String(data.name || "").trim()) return toastError("A signatory needs a name.");
    setBusy(e.target, true, "Saving...");
    try {
      const record = {
        ...data, signatureUrl,
        canApproveReports: element.querySelector("#sigApprove").checked
      };
      if (index == null) signatories.push(record);
      else signatories[index] = record;
      await saveSignatories();
      toastOk("Signatory saved — it appears on every report from now on.");
      close();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

/** Pull anyone marked "may sign reports" out of Staff, without discarding manual entries. */
async function importSignatoriesFromStaff() {
  try {
    const staff = await listSignatories();
    if (!staff.length) {
      return toastWarn('No staff are marked "May sign reports". Set that under Staff first.');
    }
    let added = 0;
    staff.forEach((s) => {
      if (signatories.some((x) => x.name?.toUpperCase() === s.name?.toUpperCase())) return;
      signatories.push({
        name: s.name, designation: s.designation || "", qualification: s.qualification || "",
        registrationNumber: s.registrationNumber || "", signatureUrl: s.signatureUrl || "",
        badge: "",
        // Deliberately NOT carried over from the staff record. Authority to
        // approve a clinical report is granted here, by name, on purpose -
        // never as a side effect of an import.
        canApproveReports: false
      });
      added += 1;
    });
    if (!added) return toastWarn("Everyone who signs reports is already listed.");
    await saveSignatories();
    toastOk(`Added ${added} signatory/ies from Staff. Open each one and tick `
      + `"May approve and sign clinical reports" for anyone authorised to release interpretations.`);
  } catch (error) {
    reportError(error, "Could not read the staff list.");
  }
}

// ---------- generic settings documents ----------

async function hydrateSettingsForms() {
  const load = async (key, formId) => {
    try {
      const snap = await getDoc(settingsDoc(key));
      if (snap.exists()) fillForm($(formId), snap.data());
    } catch (error) { console.warn(`settings/${key} not readable`, error?.message); }
  };
  await Promise.all([
    load("general", "#generalForm"),
    load("payment", "#paymentForm"),
    load("whatsapp", "#whatsappForm")
  ]);
}

async function saveSettings(event, key, auditAction) {
  event.preventDefault();
  if (!sessionCanWrite(P.SETTINGS_EDIT, ctx.session)) return reportError(new Error("You cannot change settings."));
  const button = event.submitter || event.currentTarget.querySelector("[type=submit]");
  setBusy(button, true, "Saving...");
  try {
    await setDoc(settingsDoc(key),
      clean({ ...readForm(event.currentTarget), labId: getLabId(), updatedAt: serverTimestamp() }), { merge: true });
    logAudit(auditAction, { entityType: "settings", entityId: key, summary: `${key} settings updated` });
    toastOk("Saved.");
  } catch (error) {
    reportError(error, `Could not save ${key} settings.`);
  } finally {
    setBusy(button, false);
  }
}

// ---------- branches ----------

async function renderBranches() {
  try {
    const snap = await getDocs(col("branches"));
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("#branchList").innerHTML = rows.length ? rows.map((b) => `
      <div class="row-flex" style="padding:9px 0;border-bottom:1px solid var(--line);">
        <div><b>${esc(b.name)}</b> ${b.isMain ? '<span class="pill info">Main</span>' : ""}
          <div class="small muted">${esc([b.address, b.city, b.pincode].filter(Boolean).join(", ") || "No address")}</div></div>
        <span class="spacer"></span>
        ${pill(b.isActive === false ? "Inactive" : "Active")}
        <button class="btn btn-sm btn-ghost" data-edit-branch="${esc(b.id)}" type="button">Edit</button>
      </div>`).join("")
      : `<p class="small muted">No branches configured.</p>`;

    $("#branchList").onclick = (event) => {
      const edit = event.target.closest("[data-edit-branch]");
      if (edit) openBranchDialog(rows.find((r) => r.id === edit.dataset.editBranch));
    };
  } catch (error) {
    $("#branchList").innerHTML = `<p class="small muted">Branches are not readable with your role.</p>`;
  }
}

function openBranchDialog(branch) {
  const { element, close } = openModal({
    title: branch ? `Edit ${branch.name}` : "Add branch",
    body: `<form id="branchForm"><div class="form-grid">
      <label class="field"><span>Branch code *</span><input name="branchId" value="${esc(branch?.branchId || branch?.id || "")}" ${branch ? "readonly" : "required"} placeholder="CC01"></label>
      <label class="field"><span>Name *</span><input name="name" value="${esc(branch?.name || "")}" required></label>
      <label class="field"><span>Phone</span><input name="phone" value="${esc(branch?.phone || "")}"></label>
      <label class="field"><span>City</span><input name="city" value="${esc(branch?.city || "")}"></label>
      <label class="field"><span>State</span><input name="state" value="${esc(branch?.state || "")}"></label>
      <label class="field"><span>PIN code</span><input name="pincode" value="${esc(branch?.pincode || "")}"></label>
    </div>
    <label class="field"><span>Address</span><input name="address" value="${esc(branch?.address || "")}"></label>
    <label class="field"><input type="checkbox" name="isActive" ${branch?.isActive !== false ? "checked" : ""}> Active</label>
    </form>`,
    footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
             <button class="btn" data-act="save" type="button">Save branch</button>`
  });
  element.querySelector('[data-act="cancel"]').addEventListener("click", close);
  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    setBusy(e.target, true);
    try {
      const data = readForm(element.querySelector("#branchForm"));
      const id = String(data.branchId).trim().toUpperCase();
      await setDoc(doc(db, `labs/${getLabId()}/branches/${id}`),
        withLabId({ ...data, branchId: id, isMain: branch?.isMain === true, updatedAt: serverTimestamp() }), { merge: true });
      toastOk("Branch saved."); close(); renderBranches();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

// ---------- subscription ----------

function renderSubscriptionCard() {
  const lab = ctx.session.lab;
  const sub = ctx.session.subscription;
  if (!lab) { $("#subscriptionCard").innerHTML = `<p class="small muted">Subscription details unavailable.</p>`; return; }

  const plan = PLANS[lab.plan] || PLANS.starter;
  $("#subscriptionCard").innerHTML = `
    <div class="row-flex"><b>${esc(planLabel(lab.plan))}</b> ${pill(sub.state)}</div>
    <p class="small muted" style="margin:6px 0;">${esc(plan.summary)}</p>
    <div class="row-flex"><span class="small">Started</span><span class="spacer"></span>
      <b class="small">${esc(formatDate(lab.subscriptionStart) || "—")}</b></div>
    <div class="row-flex"><span class="small">Expires</span><span class="spacer"></span>
      <b class="small">${esc(formatDate(lab.subscriptionEnd) || "—")}</b></div>
    ${sub.daysRemaining != null ? `<div class="row-flex"><span class="small">Days remaining</span><span class="spacer"></span>
      <b class="small">${sub.daysRemaining}</b></div>` : ""}
    ${sub.message ? `<div class="notice ${sub.readOnly ? "danger" : "warn"}" style="margin-top:10px;">${esc(sub.message)}</div>` : ""}
    <p class="small muted" style="margin-top:10px;">
      To change your plan, renew, or add branches, contact Swati Softtech Solution.
      Your data is never deleted when a subscription lapses.
    </p>`;
}


// ---------- image uploads ----------

/**
 * Wire the logo / stamp / favicon pickers. A picked file is resized in the
 * browser and written straight into the form's URL field as a data URI, so it
 * saves with the rest of branding and needs no Cloud Storage bucket.
 */
function setupImagePickers() {
  [["logo", "logoUrl"], ["stamp", "stampUrl"], ["favicon", "faviconUrl"]].forEach(([kind, field]) => {
    const form = $("#brandingForm");
    const input = form.elements[field];
    const preview = $(`#${kind}Preview`);
    const note = $(`#${kind}Note`);
    const limit = LIMITS[kind] || LIMITS.logo;

    const show = (value) => {
      if (value) { preview.src = value; preview.hidden = false; }
      else { preview.removeAttribute("src"); preview.hidden = true; }
    };
    show(input.value);
    input.addEventListener("change", () => show(input.value));

    attachImagePicker({
      button: $(`#${kind}Pick`),
      preview,
      kind,
      onReady: (result) => {
        input.value = result.dataUrl;
        note.textContent = result.note;
        toastOk(`${limit.label} ready — press Save branding to apply it.`);
      },
      onError: (error) => { note.textContent = ""; reportError(error, `Could not use that ${kind}.`); }
    });

    $(`#${kind}Clear`).addEventListener("click", () => {
      input.value = "";
      note.textContent = "";
      show("");
    });
  });
}

// ---------- laboratory-supplied report templates ----------

function setupTemplateTools() {
  $("#downloadTemplateBtn").addEventListener("click", downloadTemplate);
  $("#uploadTemplateBtn").addEventListener("click", uploadTemplate);
  $("#editTemplateBtn").addEventListener("click", () => openTemplateEditor());
  $("#removeTemplateBtn").addEventListener("click", removeCustomTemplate);
  $("#pageBreakPerTest").addEventListener("change", savePageBreakSetting);
  refreshTemplateState();
}

async function currentReportSettings() {
  try {
    const snap = await getDoc(settingsDoc("report"));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

async function refreshTemplateState() {
  const settings = await currentReportSettings();
  $("#pageBreakPerTest").checked = settings.pageBreakPerTest !== false;
  const custom = settings.customTemplate?.html;
  const pill = $("#customTemplateState");
  pill.textContent = custom ? `In use — ${settings.customTemplate.name || "custom"}` : "Not in use";
  pill.className = `pill ${custom ? "ok" : ""}`;
  $("#removeTemplateBtn").classList.toggle("hidden", !custom);
}

async function savePageBreakSetting(event) {
  try {
    await setDoc(settingsDoc("report"),
      { pageBreakPerTest: event.target.checked, labId: getLabId(), updatedAt: serverTimestamp() }, { merge: true });
    toastOk(event.target.checked
      ? "Each test will now print on its own page."
      : "Tests will now flow onto one continuous sheet.");
  } catch (error) { reportError(error); }
}

async function downloadTemplate() {
  const settings = await currentReportSettings();
  const html = settings.customTemplate?.html
    || templateSource(settings.templateId || ctx.branding.reportTemplate || "modern-diagnostic");
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${getLabId()}-report-template.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toastOk("Template downloaded. Edit it, then use Upload to put it back.");
}

function uploadTemplate() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".html,.htm,text/html";
  input.hidden = true;
  document.body.appendChild(input);
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;
    if (file.size > 512 * 1024) return toastError("That template is over 512 KB. Templates are markup, not images.");
    openTemplateEditor(await file.text(), file.name);
  });
  input.click();
}

/**
 * Edit and save a laboratory's own template. The editor validates before it
 * lets anything through, and the preview renders exactly what will print, so
 * a broken template is caught here rather than on a patient's report.
 */
async function openTemplateEditor(initialHtml = null, sourceName = "") {
  const settings = await currentReportSettings();
  const html = initialHtml
    ?? settings.customTemplate?.html
    ?? templateSource(settings.templateId || ctx.branding.reportTemplate || "modern-diagnostic");

  const { element, close } = openModal({
    title: sourceName ? `Review ${sourceName}` : "Edit report template",
    wide: true,
    body: `
      <div class="notice hidden" id="tplProblems" role="alert"></div>
      <label class="field"><span>Template name</span>
        <input id="tplName" value="${esc(settings.customTemplate?.name || sourceName.replace(/\.html?$/i, "") || "Custom template")}"></label>
      <div class="small" style="font-weight:600;margin-bottom:5px;">Click a placeholder to insert it</div>
      <div class="placeholder-list">${TEMPLATE_PLACEHOLDERS.map((k) =>
        `<button type="button" data-ph="${esc(k)}">{{${esc(k)}}}</button>`).join("")}</div>
      <label class="field" style="margin-top:10px;"><span>HTML</span>
        <textarea class="template-editor" id="tplHtml" spellcheck="false">${esc(html)}</textarea></label>
      <p class="small muted">
        Script tags and <code>on*</code> handlers are removed when saved — a report template is
        opened by patients from a WhatsApp link, so it must not be able to run code.
      </p>`,
    footer: `
      <button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
      <button class="btn btn-outline" data-act="preview" type="button">Preview</button>
      <button class="btn" data-act="save" type="button">Save &amp; use</button>`
  });

  const area = element.querySelector("#tplHtml");
  const problemBox = element.querySelector("#tplProblems");

  element.querySelector(".placeholder-list").addEventListener("click", (e) => {
    const button = e.target.closest("[data-ph]");
    if (!button) return;
    const token = `{{${button.dataset.ph}}}`;
    const start = area.selectionStart ?? area.value.length;
    area.value = area.value.slice(0, start) + token + area.value.slice(area.selectionEnd ?? start);
    area.focus();
    area.selectionStart = area.selectionEnd = start + token.length;
  });

  const check = () => {
    const problems = validateTemplate(area.value);
    if (problems.length) {
      problemBox.className = "notice warn";
      problemBox.innerHTML = `<b>${problems.length} thing(s) to look at:</b><ul style="margin:6px 0 0;padding-left:18px;">${
        problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
      problemBox.classList.remove("hidden");
    } else {
      problemBox.className = "notice ok";
      problemBox.textContent = "Template looks good.";
      problemBox.classList.remove("hidden");
    }
    return problems;
  };
  area.addEventListener("input", () => { problemBox.classList.add("hidden"); });
  check();

  element.querySelector('[data-act="cancel"]').addEventListener("click", close);

  element.querySelector('[data-act="preview"]').addEventListener("click", () => {
    check();
    try {
      printReport(sampleReport(), ctx.branding, {
        ...settings,
        customTemplate: { html: area.value },
        signatories: settings.signatories || ctx.branding.signatories
      });
    } catch (error) { reportError(error, "Could not preview that template."); }
  });

  element.querySelector('[data-act="save"]').addEventListener("click", async (e) => {
    const problems = check();
    const blocking = problems.filter((x) => x.includes("{{results}}") || x.includes("empty"));
    if (blocking.length) return toastError(blocking[0]);

    setBusy(e.target, true, "Saving...");
    try {
      await setDoc(settingsDoc("report"), {
        labId: getLabId(),
        customTemplate: {
          name: element.querySelector("#tplName").value.trim() || "Custom template",
          html: sanitizeTemplate(area.value),
          updatedAt: new Date().toISOString(),
          updatedBy: ctx.session.name || ctx.session.email || ""
        },
        updatedAt: serverTimestamp()
      }, { merge: true });
      logAudit(AUDIT.SETTINGS_UPDATED, {
        entityType: "settings", entityId: "report", summary: "Custom report template saved"
      });
      toastOk("Your template is now in use for every report.");
      close();
      refreshTemplateState();
    } catch (error) { reportError(error); setBusy(e.target, false); }
  });
}

async function removeCustomTemplate() {
  if (!await confirmAction(
    "Stop using your own template and go back to the built-in layout? Your template is deleted.",
    { danger: true, confirmLabel: "Stop using it" })) return;
  try {
    await setDoc(settingsDoc("report"),
      { customTemplate: null, labId: getLabId(), updatedAt: serverTimestamp() }, { merge: true });
    toastOk("Back to the built-in template.");
    refreshTemplateState();
  } catch (error) { reportError(error); }
}
