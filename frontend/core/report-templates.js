// Configurable printable report templates (spec section 11).
//
// A template is a pure function of (report, branding, settings) -> HTML. No
// laboratory name, colour, address or signature is baked in; everything comes
// from /labs/{labId}/settings. Switching a customer from "Traditional" to
// "Hospital Style" is a dropdown in Lab Settings, never a code change.
//
// All four share one <style> block driven by CSS custom properties, so a lab's
// primary colour recolours whichever template it picks.
import { isAbnormal, isCritical } from "./flags.js";
import { formatDate, formatDateTime } from "./format.js";
import { qrSvg } from "./qrcode.js";
import { barcodeSvg, barcodeSvgVertical } from "./barcode.js";

export const TEMPLATES = Object.freeze([
  { id: "minimal-clinical",   name: "Minimal Clinical",     description: "Clean typographic layout, thin rules, maximum white space." },
  { id: "modern-diagnostic",  name: "Modern Diagnostic",    description: "Coloured header band, zebra rows, bold abnormal flags." },
  { id: "traditional-pathology", name: "Traditional Pathology", description: "Classic bordered letterhead in the style Indian labs print today." },
  { id: "hospital-style",     name: "Hospital Style",       description: "Dense two-column header with a department strip, built for volume." },
  { id: "classic-letterhead", name: "Classic Letterhead",   description: "The layout most Indian pathology labs print today: coloured band, barcode and QR beside the patient block, signature panel, footer strip." }
]);

export function templateById(id) {
  return TEMPLATES.find((t) => t.id === id) || TEMPLATES[1];
}

// ---------- shared helpers ----------

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function flagClass(flag) {
  if (isCritical(flag)) return "critical";
  if (isAbnormal(flag)) return "abnormal";
  return "";
}

function flagMark(flag) {
  if (flag === "Critical High") return "↑↑";
  if (flag === "Critical Low") return "↓↓";
  if (flag === "High") return "↑";
  if (flag === "Low") return "↓";
  return "";
}

/**
 * The small marker printed beside a value the analyser or the engine produced,
 * rather than a person entering it at the bench. A blank string for an
 * ordinary measured result, so nothing is added there.
 */
function calcOriginLabel(row) {
  if (row.calculated === true) return "Calculated";
  if (row.origin === "ANALYZER_DERIVED") return "Analyser-derived";
  if (row.origin === "MANUALLY_VERIFIED") return "Manually verified";
  return "";
}

/**
 * The report's statement about its own validation.
 *
 * Printed small, but printed. A clinician reading a calculated eGFR is
 * entitled to know that the equation behind it has not been verified against
 * this laboratory's own creatinine method, and that the interpretation
 * remains theirs to make.
 */
function medicalNoticeBlock(report) {
  const lines = Array.isArray(report.medicalNotices) ? report.medicalNotices.filter(Boolean) : [];
  if (!lines.length) return "";
  return `<div class="medical-notice">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}</div>`;
}

/**
 * The scan-to-verify QR for the footer templates. Encodes ONLY the report's
 * unguessable verification link - no patient name, no results. Prints at
 * ~30 mm so it survives a photocopy and a phone scan from A4.
 *
 * When there is no verification link yet, a comment marker goes into the HTML
 * instead of a broken or empty QR (spec §11), so the omission is visible to
 * anyone inspecting the output rather than silent.
 */
function verifyBlock(settings, report, branding) {
  if (settings?.showQrVerification === false) return "";
  const url = report.verifyUrl || "";
  if (!url) return "<!-- QR omitted: report verification link not available -->";
  let svg;
  try {
    svg = qrSvg(url, { size: 150, margin: 2, label: "Scan to verify this report" });
  } catch {
    return "<!-- QR omitted: could not encode the verification link -->";
  }
  return `
    <div class="verify">
      <span class="verify-qr">${svg}</span>
      <span>Scan to verify<br>this report${branding.website ? `<br><small>${esc(branding.website)}</small>` : ""}</span>
    </div>`;
}

/** Bill-number barcode for the bench. Also generated locally. */
function barcodeBlock(report, { vertical = false } = {}) {
  const value = String(report.billNo || report.reportId || "").trim();
  if (!value) return "";
  try {
    const svg = vertical
      ? barcodeSvgVertical(value, { length: 30, moduleWidth: 0.62, margin: 2 })
      : barcodeSvg(value, { height: 34, moduleWidth: 1.0, margin: 2 });
    return `<span class="rp-barcode">${svg}</span>`;
  } catch {
    return "";
  }
}

/** Classic signature panel: initial badge, role, rule, then the name in the brand colour. */
function classicSignatures(settings, branding, report) {
  const list = report.signatory ? [report.signatory] : (settings?.signatories || branding.signatories || []);
  if (!list.length) return "";
  return `<div class="cl-signs">${list.map((s) => `
    <div class="cl-sign">
      <span class="cl-badge">${esc((s.badge || (s.designation || s.name || "?").trim().charAt(0)).toUpperCase().slice(0, 2))}</span>
      <div class="cl-role">${esc(s.designation || s.qualification || "")}</div>
      ${s.signatureUrl ? `<img class="cl-signimg" src="${esc(s.signatureUrl)}" alt="">` : ""}
      <div class="cl-rule"></div>
      <div class="cl-signame">${esc(s.name || "")}</div>
      ${s.registrationNumber ? `<div class="cl-reg">Reg. No: ${esc(s.registrationNumber)}</div>` : ""}
    </div>`).join("")}</div>`;
}

function signatureBlock(settings, branding, report) {
  const list = (report.signatory ? [report.signatory] : (settings?.signatories || branding.signatories || []));
  if (!list.length) return "";
  return `<div class="signatures">${list.map((s) => `
    <div class="signature">
      ${s.signatureUrl ? `<img src="${esc(s.signatureUrl)}" alt="">` : `<span class="sig-space"></span>`}
      <div class="sig-line"></div>
      <div class="sig-name">${esc(s.name || "")}</div>
      <div class="sig-role">${esc(s.qualification || s.designation || "")}</div>
      ${s.registrationNumber ? `<div class="sig-reg">Reg. No: ${esc(s.registrationNumber)}</div>` : ""}
    </div>`).join("")}</div>`;
}

function patientRows(report) {
  return [
    ["Patient Name", report.patientName],
    ["Patient ID", report.patientId],
    ["Age / Gender", [report.age, report.gender].filter(Boolean).join(" / ")],
    ["Bill / Booking No", report.billNo],
    ["Referred By", report.refBy || "Self"],
    ["Sample Type", report.sampleType],
    ["Collection Date", formatDate(report.collectionDate)],
    ["Reporting Date", formatDate(report.reportingDate || report.approvedAt)],
    ["Report Status", report.reportStatus]
  ].filter(([, value]) => String(value || "").trim() !== "");
}

/**
 * @param {object} group
 * @param {{showMethod?:boolean, rangeBeforeUnit?:boolean, labels?:string[]}} options
 *   rangeBeforeUnit puts Reference Value before Unit, which is the column order
 *   Indian pathology reports are read in and what the Classic layout uses.
 */
function resultsTable(group, { showMethod = false, rangeBeforeUnit = false, labels = null } = {}) {
  const heads = labels || (rangeBeforeUnit
    ? ["Investigation", "Result", "Reference Value", "Unit"]
    : ["Investigation", "Result", "Unit", "Reference Range"]);
  const span = heads.length + (showMethod ? 1 : 0);

  const rows = group.rows.map((r) => {
    if (r.isHeading) return `<tr class="heading-row"><td colspan="${span}"><b>${esc(r.name)}</b></td></tr>`;
    const unit = `<td class="p-unit">${esc(r.unit)}</td>`;
    const range = `<td class="p-range">${esc(r.referenceRange)}</td>`;
    // A calculated (or analyser-derived, or manually verified) value is marked,
    // so a clinician never mistakes a derived number for a measured one, and the
    // formula behind it is printed small on its own line.
    const originLabel = calcOriginLabel(r);
    const subLines = [
      r.sample && `Sample: ${r.sample}`,
      r.method && `Method: ${r.method}`,
      originLabel && r.formulaText && `Formula: ${r.formulaText}`
    ].filter(Boolean);
    return `<tr class="${flagClass(r.flag)}${originLabel ? " p-derived" : ""}">
      <td class="p-name">${esc(r.name)}${
        subLines.length
          ? `<div class="p-method-line">${esc(subLines.join("  "))}</div>`
          : ""}</td>
      <td class="p-value"><b>${esc(r.value)}</b> <span class="flag">${flagMark(r.flag)}</span>${
        originLabel ? ` <span class="p-calc-tag">${esc(originLabel)}</span>` : ""}</td>
      ${rangeBeforeUnit ? range + unit : unit + range}
      ${showMethod ? `<td class="p-method">${esc(r.method)}</td>` : ""}
    </tr>`;
  }).join("");

  return `
    <section class="test-block">
      <h3 class="test-title">${esc(group.testName)}</h3>
      ${group.sample ? `<div class="test-sample">Sample Type: ${esc(group.sample)}</div>` : ""}
      <table class="results">
        <thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}${showMethod ? "<th>Method</th>" : ""}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
      ${group.notes ? `<p class="test-note">${esc(group.notes)}</p>` : ""}
    </section>`;
}

// ---------- one stylesheet, four skins ----------

export function reportStyles(branding) {
  return `
  :root {
    --rp-primary: ${branding.primaryColor || "#c62828"};
    --rp-secondary: ${branding.secondaryColor || "#0f172a"};
    --rp-accent: ${branding.accentColor || "#0369a1"};
    --rp-ink: #111827;
    --rp-muted: #6b7280;
    --rp-line: #d1d5db;
  }
  * { box-sizing: border-box; }
  .report-page {
    font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
    color: var(--rp-ink); background: #fff;
    width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm 12mm 16mm;
    position: relative; font-size: 12px; line-height: 1.45;
  }
  .report-page .watermark {
    position: absolute; inset: 0; display: grid; place-items: center;
    opacity: .04; pointer-events: none;
  }
  .report-page .watermark img { width: 110mm; }
  .brand-row { display: flex; align-items: center; gap: 14px; }
  .brand-logo { max-height: 68px; max-width: 150px; object-fit: contain; }
  .brand-name { font-size: 26px; font-weight: 800; letter-spacing: .4px; color: var(--rp-primary); margin: 0; }
  .brand-legal { font-size: 11px; color: var(--rp-muted); }
  .brand-tagline { font-size: 11px; letter-spacing: 2px; text-transform: uppercase; color: var(--rp-secondary); }
  .brand-contact { margin-left: auto; text-align: right; font-size: 11px; line-height: 1.6; color: var(--rp-secondary); }
  .brand-contact div { white-space: nowrap; }
  .patient-grid {
    display: grid; grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 2px 24px; margin: 12px 0; font-size: 11.5px;
  }
  .patient-grid .row { display: flex; gap: 6px; padding: 3px 0; }
  .patient-grid .label { min-width: 108px; color: var(--rp-muted); }
  .patient-grid .value { font-weight: 600; }
  .test-block { margin: 14px 0; page-break-inside: avoid; }
  .test-title { font-size: 13px; margin: 0 0 6px; text-transform: uppercase; letter-spacing: .5px; color: var(--rp-primary); }
  .test-title small { font-weight: 400; text-transform: none; color: var(--rp-muted); }
  table.results { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  table.results th {
    text-align: left; padding: 6px 8px; font-size: 10.5px; text-transform: uppercase;
    letter-spacing: .4px; color: var(--rp-secondary); border-bottom: 1.5px solid var(--rp-primary);
  }
  table.results td { padding: 5px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  table.results .p-value { white-space: nowrap; }
  table.results .p-range { color: var(--rp-muted); }
  table.results tr.abnormal .p-value { color: #b45309; }
  table.results tr.critical .p-value { color: #b91c1c; }
  table.results tr.critical { background: #fef2f2; }
  table.results tr.heading-row td { background: #f8fafc; border-bottom: none; padding-top: 8px; }
  .flag { font-weight: 700; }
  .p-calc-tag { display: inline-block; font-size: 8.5px; font-weight: 600; letter-spacing: .02em;
                text-transform: uppercase; color: var(--rp-muted); border: 1px solid var(--rp-line);
                border-radius: 3px; padding: 0 3px; margin-left: 4px; vertical-align: 1px; }
  .test-note { font-size: 10.5px; color: var(--rp-muted); margin: 6px 0 0; }
  .interpretation { margin-top: 14px; font-size: 11.5px; }
  .medical-notice { margin-top: 10px; font-size: 9.5px; line-height: 1.45; color: #444;
                    border-top: 1px dashed #bbb; padding-top: 6px; }
  .medical-notice p { margin: 0 0 3px; }
  .interpretation h4 { margin: 0 0 4px; font-size: 12px; color: var(--rp-primary); }
  .report-foot { margin-top: 22px; page-break-inside: avoid; }
  .signatures { display: flex; gap: 40px; justify-content: flex-end; margin-top: 26px; }
  .signature { text-align: center; min-width: 150px; font-size: 11px; }
  .signature img { max-height: 44px; display: block; margin: 0 auto 2px; }
  .signature .sig-space { display: block; height: 44px; }
  .sig-line { border-top: 1px solid var(--rp-ink); margin-bottom: 3px; }
  .sig-name { font-weight: 700; }
  .sig-role, .sig-reg { color: var(--rp-muted); font-size: 10px; }
  .verify { display: flex; align-items: center; gap: 8px; font-size: 10px; color: var(--rp-muted); page-break-inside: avoid; }
  .verify-qr { width: 30mm; height: 30mm; flex: none; }
  .verify-qr svg { width: 100%; height: 100%; display: block; }
  .disclaimer { margin-top: 14px; font-size: 9.5px; color: var(--rp-muted); border-top: 1px dashed var(--rp-line); padding-top: 6px; }
  .powered { text-align: center; font-size: 9px; color: var(--rp-muted); margin-top: 8px; }
  .end-mark { text-align: center; font-size: 10px; letter-spacing: 3px; color: var(--rp-muted); margin-top: 10px; }

  /* --- Minimal Clinical --- */
  .tpl-minimal-clinical .brand-name { color: var(--rp-ink); font-weight: 600; letter-spacing: 1px; }
  .tpl-minimal-clinical .header-rule { border-bottom: 1px solid var(--rp-ink); margin: 10px 0 0; }
  .tpl-minimal-clinical table.results th { border-bottom-color: var(--rp-ink); }
  .tpl-minimal-clinical .test-title { color: var(--rp-ink); }
  .tpl-minimal-clinical .patient-grid { border-top: 1px solid #eee; border-bottom: 1px solid #eee; padding: 8px 0; }

  /* --- Modern Diagnostic --- */
  .tpl-modern-diagnostic .header-band {
    background: linear-gradient(135deg, var(--rp-primary), var(--rp-accent));
    color: #fff; margin: -12mm -12mm 0; padding: 10mm 12mm 7mm;
  }
  .tpl-modern-diagnostic .header-band .brand-name,
  .tpl-modern-diagnostic .header-band .brand-tagline,
  .tpl-modern-diagnostic .header-band .brand-contact { color: #fff; }
  .tpl-modern-diagnostic .header-band .brand-legal { color: rgba(255,255,255,.8); }
  .tpl-modern-diagnostic .brand-logo { background: #fff; border-radius: 8px; padding: 4px; }
  .tpl-modern-diagnostic .patient-grid {
    background: #f8fafc; border-radius: 8px; padding: 10px 14px; margin-top: 14px;
  }
  .tpl-modern-diagnostic table.results tbody tr:nth-child(even) { background: #fafbfc; }

  /* --- Traditional Pathology --- */
  .tpl-traditional-pathology { border: 2px solid var(--rp-primary); }
  .tpl-traditional-pathology .brand-row { border-bottom: 2px solid var(--rp-primary); padding-bottom: 8px; }
  .tpl-traditional-pathology .brand-name { font-family: Georgia, "Times New Roman", serif; }
  .tpl-traditional-pathology .patient-grid {
    border: 1px solid var(--rp-line); padding: 8px 12px; border-radius: 2px;
  }
  .tpl-traditional-pathology table.results { border: 1px solid var(--rp-line); }
  .tpl-traditional-pathology table.results th { background: #f4f4f5; border: 1px solid var(--rp-line); }
  .tpl-traditional-pathology table.results td { border: 1px solid #e5e7eb; }
  .tpl-traditional-pathology .test-title {
    background: var(--rp-primary); color: #fff; padding: 4px 10px; display: inline-block; border-radius: 2px;
  }
  .tpl-traditional-pathology .test-title small { color: rgba(255,255,255,.85); }

  /* --- Hospital Style --- */
  .tpl-hospital-style { font-size: 11px; padding: 10mm; }
  .tpl-hospital-style .brand-row { align-items: flex-start; border-bottom: 3px double var(--rp-secondary); padding-bottom: 6px; }
  .tpl-hospital-style .brand-name { font-size: 22px; color: var(--rp-secondary); }
  .tpl-hospital-style .dept-strip {
    background: var(--rp-secondary); color: #fff; padding: 3px 10px; font-size: 10px;
    letter-spacing: 2px; text-transform: uppercase; margin: 0 -10mm 8px; padding-left: 10mm;
  }
  .tpl-hospital-style .patient-grid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0 16px; font-size: 10.5px; }
  .tpl-hospital-style .patient-grid .label { min-width: 78px; }
  .tpl-hospital-style table.results { font-size: 10.5px; }
  .tpl-hospital-style table.results td { padding: 3px 6px; }
  .tpl-hospital-style .test-title { font-size: 11.5px; border-left: 4px solid var(--rp-primary); padding-left: 8px; }

  .page-count {
    position: absolute; bottom: 6mm; right: 12mm;
    font-size: 9px; color: var(--rp-muted);
  }
  /* Classic ends in a dark band, so the page number sits ON it — at the LEFT,
     beside the slashes, because the disclaimer is right-aligned there and a
     long one ran straight into it. */
  .tpl-classic-letterhead .page-count {
    bottom: 3.4mm; left: 16mm; right: auto; color: rgba(255, 255, 255, .75);
  }
  /* ---- Classic Letterhead ----
     Reproduces the layout these laboratories print today. Every colour comes
     from the brand tokens, so the same structure carries any customer's
     identity without a code change. */
  .tpl-classic-letterhead {
    padding: 0; font-size: 11.5px;
    display: flex; flex-direction: column;   /* so the footer can sit at the bottom */
  }
  .tpl-classic-letterhead > .test-block:last-of-type { margin-bottom: 0; }
  .tpl-classic-letterhead .cl-topband { height: 7mm; background: var(--rp-primary); }
  .cl-head {
    display: flex; align-items: stretch; gap: 0;
    background: #fff; position: relative; min-height: 24mm;
  }
  .cl-brand { display: flex; align-items: center; gap: 10px; padding: 4mm 0 4mm 8mm; }
  .cl-logo { max-height: 20mm; max-width: 26mm; object-fit: contain; }
  .cl-name {
    font-size: 30px; font-weight: 800; letter-spacing: .5px; line-height: 1;
    color: var(--rp-secondary);
  }
  .cl-name .cl-accent { color: var(--rp-primary); }
  .cl-sub { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
  .cl-sub span {
    font-size: 13px; font-weight: 700; letter-spacing: 6px; color: var(--rp-secondary);
  }
  .cl-sub::before, .cl-sub::after {
    content: ""; flex: 1; height: 1px; background: var(--rp-secondary); min-width: 14px;
  }
  .cl-tag {
    font-size: 7.5px; letter-spacing: 2.6px; color: var(--rp-muted);
    text-transform: uppercase; margin-top: 3px; text-align: center;
  }
  .cl-slashes { flex: 1; position: relative; overflow: hidden; }
  .cl-slashes i {
    position: absolute; top: -10%; height: 120%; width: 3px;
    background: var(--rp-accent); opacity: .55; transform: skewX(-24deg);
  }
  .cl-slashes i:nth-child(1) { left: 30%; opacity: .25; }
  .cl-slashes i:nth-child(2) { left: 36%; opacity: .4; }
  .cl-slashes i:nth-child(3) { left: 42%; opacity: .6; }
  .cl-slashes i:nth-child(4) { left: 48%; opacity: .8; }
  .cl-contact {
    background: var(--rp-secondary); color: #fff; padding: 5mm 8mm 5mm 12mm;
    display: grid; align-content: center; gap: 3px; font-size: 10px;
    clip-path: polygon(14px 0, 100% 0, 100% 100%, 0 100%);
    min-width: 62mm;
  }
  .cl-contact div { display: flex; align-items: center; gap: 7px; white-space: nowrap; }
  .cl-ico {
    display: inline-grid; place-items: center; width: 13px; height: 13px; border-radius: 50%;
    background: var(--rp-primary); color: #fff; font-size: 8px; font-weight: 700; flex: none;
  }

  .cl-patient {
    display: flex; align-items: center; gap: 4mm; margin: 5mm 8mm 0;
    padding: 3mm 0; border-top: 1px solid var(--rp-ink); border-bottom: 1px solid var(--rp-ink);
  }
  .cl-patient .rp-barcode { flex: none; display: block; }
  .cl-patient .rp-barcode svg { height: 16mm; width: auto; display: block; }
  .cl-pcol { flex: 1; display: grid; gap: 1px; min-width: 0; }
  .cl-prow {
    display: grid; grid-template-columns: minmax(0, 24mm) 3mm minmax(0, 1fr);
    font-size: 10px; align-items: baseline; gap: 0;
  }
  .cl-prow > span { overflow-wrap: anywhere; }
  .cl-prow > span:first-child { color: var(--rp-ink); }
  .cl-prow > span:last-child { font-weight: 700; }
  .cl-prow.cl-strong > span:first-child { font-weight: 700; }
  .cl-qr { flex: none; display: grid; place-items: center; gap: 1mm; page-break-inside: avoid; }
  .cl-qr svg { display: block; width: 26mm; height: 26mm; }
  .cl-qr-cap { font-size: 7.5px; letter-spacing: .02em; color: var(--rp-muted); text-transform: uppercase; }

  .tpl-classic-letterhead .test-block { margin: 5mm 8mm; }
  .tpl-classic-letterhead .test-title {
    text-align: center; color: var(--rp-ink); font-size: 13px; letter-spacing: .3px;
    text-transform: uppercase; margin-bottom: 3px;
  }
  .test-sample { font-size: 10px; font-weight: 700; margin: 0 0 4px; }
  .p-method-line { font-size: 8.5px; font-style: italic; color: var(--rp-muted); font-weight: 400; }
  .tpl-classic-letterhead table.results th {
    border-top: 1px solid var(--rp-ink); border-bottom: 1px solid var(--rp-ink);
    color: var(--rp-ink); font-size: 10.5px; text-transform: none; font-weight: 700;
  }
  .tpl-classic-letterhead table.results td { border-bottom: 1px solid #e5e7eb; }
  .tpl-classic-letterhead table.results .p-name { font-weight: 700; }
  .tpl-classic-letterhead table.results .p-value,
  .tpl-classic-letterhead table.results .p-range,
  .tpl-classic-letterhead table.results .p-unit { text-align: center; }
  .tpl-classic-letterhead .end-mark {
    letter-spacing: 0; font-weight: 700; color: var(--rp-ink); font-size: 12px;
    border-top: 1px dashed var(--rp-line); padding-top: 4mm; margin: 4mm 8mm 0;
  }

  /* margin-top:auto takes up whatever height the results left over, so the
     signature panel and footer band land at the foot of the A4 sheet. */
  .cl-foot { margin: auto 0 0; }
  .cl-signs { display: flex; justify-content: space-around; gap: 10mm; margin: 12mm 8mm 6mm; }
  .cl-sign { text-align: center; min-width: 38mm; }
  .cl-badge {
    display: inline-grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
    background: var(--rp-secondary); color: #fff; font-size: 11px; font-weight: 700;
  }
  .cl-role { font-size: 10px; color: var(--rp-ink); margin-top: 3px; }
  .cl-signimg { max-height: 10mm; display: block; margin: 2px auto 0; }
  .cl-rule { border-top: 1.5px solid var(--rp-secondary); margin: 3px 0; }
  .cl-signame { font-size: 12px; font-weight: 700; color: var(--rp-primary); }
  .cl-reg { font-size: 9px; color: var(--rp-muted); }
  .cl-note {
    display: flex; gap: 8px; align-items: flex-start; justify-content: center;
    margin: 0 8mm 4mm; font-size: 9.5px; color: var(--rp-ink); max-width: 120mm;
    margin-left: auto; margin-right: auto;
  }
  .cl-noteicon {
    flex: none; width: 15px; height: 17px; border: 1.2px solid var(--rp-ink); border-radius: 2px;
    background: repeating-linear-gradient(var(--rp-ink) 0 1.2px, transparent 1.2px 4px);
    background-position: center; background-size: 9px 12px; background-repeat: no-repeat;
  }
  .cl-strip {
    background: var(--rp-secondary); color: #fff; display: flex; align-items: center;
    justify-content: flex-end; gap: 12px; padding: 3mm 8mm; margin: 3mm 0 0;
    min-height: 9mm;
  }
  .cl-strip-slashes { display: inline-flex; gap: 3px; margin-right: auto; }
  .cl-strip-slashes i {
    width: 3px; height: 14px; background: var(--rp-primary); transform: skewX(-24deg); display: block;
  }
  .cl-strip-text {
    font-size: 10px; font-weight: 700; color: var(--rp-primary);
    text-align: right; line-height: 1.35; max-width: 130mm;
  }
  .tpl-classic-letterhead .powered { margin: 0 0 2mm; }
  .tpl-classic-letterhead .disclaimer { display: none; }
  .rp-barcode svg { display: block; }

  @media print {
    body { margin: 0; background: #fff; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 0; }
    /* Each .report-page is one printed sheet, exactly as the KhunTest reports
       these laboratories already hand out are laid out. The last one must not
       force a trailing blank page. */
    .report-page {
      width: 210mm; min-height: 297mm; margin: 0; padding: 10mm 12mm 16mm;
      box-shadow: none; page-break-after: always; break-after: page;
      page-break-inside: avoid;
    }
    /* Classic runs its bands to the paper edge, so it supplies its own insets
       and must fill the sheet exactly rather than min-height it. */
    .report-page.tpl-classic-letterhead {
      padding: 0; height: 297mm; min-height: 297mm;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .report-page:last-child { page-break-after: auto; break-after: auto; }
    table.results { page-break-inside: auto; }
    table.results tr { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
  }
  @media screen {
    .report-page { box-shadow: 0 2px 24px rgba(15, 23, 42, .12); margin-block: 16px; }
  }
  /* ---- A4 on a phone ----
     Every query below is scoped to screen for a reason: A4 paper is about 794 CSS
     pixels wide, so a bare max-width:820px query also matches when PRINTING and
     shrank every printed report to 92% of the sheet.
     The page is SCALED to the screen rather than reflowed. A patient opening a
     report link expects the document their laboratory printed; reflowing broke
     the letterhead, split the patient block and turned the results into a
     sideways-scrolling strip.

     NOTE ON THE MATHS. scale(calc(100vw / 210mm)) looks right and is invalid
     CSS twice over: calc() cannot divide a length by a length, and scale()
     takes a plain number. A browser drops the whole declaration, so the page
     would silently not scale at all. So --rp-scale is a plain number, stepped
     by breakpoint here and set exactly by fitReportsToWidth() when scripting
     is available. Multiplying a length BY that number is valid, which is how
     the reserved height is corrected. */
  @media screen and (max-width: 820px) {
    .report-page {
      --rp-scale: .92;
      transform: scale(var(--rp-scale));
      transform-origin: top left;
      /* The un-scaled box still reserves 297mm of layout height; reclaim it. */
      margin: 0 0 calc(297mm * (var(--rp-scale) - 1));
      box-shadow: none;
    }
    .report-page + .report-page { margin-top: 10px; }
  }
  @media screen and (max-width: 760px) { .report-page { --rp-scale: .84; } }
  @media screen and (max-width: 640px) { .report-page { --rp-scale: .70; } }
  @media screen and (max-width: 540px) { .report-page { --rp-scale: .60; } }
  @media screen and (max-width: 440px) { .report-page { --rp-scale: .49; } }
  @media screen and (max-width: 380px) { .report-page { --rp-scale: .42; } }

  @media print {
    body { margin: 0; background: #fff; }
    .no-print { display: none !important; }
    @page { size: A4; margin: 0; }
    /* Each .report-page is one printed sheet, exactly as the KhunTest reports
       these laboratories already hand out are laid out. The last one must not
       force a trailing blank page. */
    .report-page {
      width: 210mm; min-height: 297mm; margin: 0; padding: 10mm 12mm 16mm;
      box-shadow: none; page-break-after: always; break-after: page;
      page-break-inside: avoid;
    }
    /* Classic runs its bands to the paper edge, so it supplies its own insets
       and must fill the sheet exactly rather than min-height it. */
    .report-page.tpl-classic-letterhead {
      padding: 0; height: 297mm; min-height: 297mm;
      display: flex; flex-direction: column; overflow: hidden;
    }
    .report-page:last-child { page-break-after: auto; break-after: auto; }
    table.results { page-break-inside: auto; }
    table.results tr { page-break-inside: avoid; break-inside: avoid; }
    thead { display: table-header-group; }
  }
  @media screen {
    .report-page { box-shadow: 0 2px 24px rgba(15, 23, 42, .12); margin-block: 16px; }
  }
`;
}

// ---------- header variants ----------

function contactLines(branding) {
  return [
    branding.fullAddress,
    [branding.phone, branding.altPhone].filter(Boolean).join(", "),
    branding.whatsapp ? `WhatsApp: ${branding.whatsapp}` : "",
    branding.email,
    branding.website
  ].filter(Boolean).map((line) => `<div>${esc(line)}</div>`).join("");
}

function brandRow(branding) {
  return `
    <div class="brand-row">
      ${branding.logoUrl ? `<img class="brand-logo" src="${esc(branding.logoUrl)}" alt="${esc(branding.labName)}">` : ""}
      <div>
        <h1 class="brand-name">${esc(branding.labName)}</h1>
        ${branding.legalName ? `<div class="brand-legal">${esc(branding.legalName)}</div>` : ""}
        ${branding.tagline ? `<div class="brand-tagline">${esc(branding.tagline)}</div>` : ""}
        ${branding.licenseNumber ? `<div class="brand-legal">Licence: ${esc(branding.licenseNumber)}</div>` : ""}
      </div>
      <div class="brand-contact">${contactLines(branding)}</div>
    </div>`;
}

/**
 * Classic Letterhead: the layout most Indian pathology laboratories print
 * today — coloured top band, split-colour wordmark, diagonal rule, and a dark
 * contact panel with round icon badges.
 *
 * Every part of it is brand-driven. `brandLine1` / `brandLine2` and
 * `brandAccentLength` let a laboratory reproduce a two-tone wordmark (the
 * first N characters in the primary colour) without any code change; they
 * default to the laboratory name with no split.
 */
function classicHeader(b) {
  const line1 = b.brandLine1 || b.labName || "";
  const line2 = b.brandLine2 || "";
  const accent = Math.max(0, Math.min(Number(b.brandAccentLength) || 0, line1.length));
  const wordmark = accent
    ? `<span class="cl-accent">${esc(line1.slice(0, accent))}</span>${esc(line1.slice(accent))}`
    : esc(line1);

  const contact = [
    ["P", b.fullAddress],
    ["T", [b.phone, b.altPhone].filter(Boolean).join(", ")],
    ["@", b.email],
    ["W", b.website]
  ].filter(([, v]) => v);

  return `
    <div class="cl-topband"></div>
    <header class="cl-head">
      <div class="cl-brand">
        ${b.logoUrl ? `<img class="cl-logo" src="${esc(b.logoUrl)}" alt="${esc(b.labName)}">` : ""}
        <div class="cl-words">
          <div class="cl-name">${wordmark}</div>
          ${line2 ? `<div class="cl-sub"><span>${esc(line2)}</span></div>` : ""}
          ${b.tagline ? `<div class="cl-tag">${esc(b.tagline)}</div>` : ""}
        </div>
      </div>
      <div class="cl-slashes" aria-hidden="true"><i></i><i></i><i></i><i></i></div>
      <div class="cl-contact">
        ${contact.map(([icon, value]) =>
          `<div><span class="cl-ico">${esc(icon)}</span><span>${esc(value)}</span></div>`).join("")}
      </div>
    </header>`;
}

const HEADERS = {
  "minimal-clinical": (b) => `${brandRow(b)}<div class="header-rule"></div>`,
  "modern-diagnostic": (b) => `<div class="header-band">${brandRow(b)}</div>`,
  "traditional-pathology": (b) => brandRow(b),
  "hospital-style": (b) => `${brandRow(b)}<div class="dept-strip">Department of Laboratory Medicine</div>`,
  "classic-letterhead": classicHeader
};

// ---------- the renderer ----------

/**
 * Render one report to standalone HTML.
 *
 * By default each booked test prints on its OWN A4 page, with the full
 * letterhead, patient block and signatures repeated - which is how a
 * pathology report is handed over in practice, and what the KhunTest reports
 * these labs already issue look like. A page that is handed to a referring
 * doctor has to stand alone.
 *
 * Set `pageBreakPerTest: false` in Lab Settings to flow every test onto one
 * continuous sheet instead, which uses far less paper for small panels.
 *
 * @param {object} report   normalised report (see data/reports.js)
 * @param {object} branding resolved branding (see branding.js)
 * @param {object} settings /labs/{labId}/settings/report
 */
export function renderReport(report, branding, settings = {}) {
  // The laboratory's CURRENT choice wins over whatever template was in force
  // when the report was saved. Changing the template in Lab Settings is meant
  // to restyle every report, new and old - with the report's stored value
  // winning, a lab that switched to Classic Letterhead kept printing the old
  // layout for everything already entered.
  //
  // report.templateId remains the fallback for a shared patient link, where
  // settings/report is not readable.
  const templateId = settings.templateId
    || branding.reportTemplate
    || report.templateId
    || "modern-diagnostic";

  // A laboratory's own uploaded template takes precedence over the built-ins.
  if (settings.customTemplate?.html) {
    return renderCustomTemplate(report, branding, settings);
  }

  const template = templateById(templateId);
  const header = (HEADERS[template.id] || HEADERS["modern-diagnostic"])(branding);
  const showMethod = settings.showMethod === true;
  const perTest = settings.pageBreakPerTest !== false;
  const tableOptions = {
    showMethod,
    rangeBeforeUnit: template.id === "classic-letterhead" || settings.rangeBeforeUnit === true
  };
  const groups = report.groups || [];

  const watermark = branding.logoUrl && settings.showWatermark !== false
    ? `<div class="watermark"><img src="${esc(branding.logoUrl)}" alt=""></div>` : "";

  // Classic prints the patient details as two columns with the barcode on the
  // left and the scan-to-open QR between them, exactly as the sample does.
  const patientBlock = template.id === "classic-letterhead"
    ? `<div class="cl-patient">
         ${barcodeBlock(report, { vertical: true })}
         <div class="cl-pcol">
           ${[["PATIENT NAME", report.patientName], ["Bill No", report.billNo],
              ["Age/Gender", [report.age, report.gender].filter(Boolean).join("/")],
              ["Report Status", report.reportStatus || "Final"]]
             .filter(([, v]) => String(v || "").trim())
             .map(([k, v], i) =>
               `<div class="cl-prow${i === 0 ? " cl-strong" : ""}"><span>${esc(k)}</span><b>:</b><span>${esc(v)}</span></div>`)
             .join("")}
         </div>
         <div class="cl-qr">${(() => {
           if (settings.showQrVerification === false) return "";
           if (!report.verifyUrl) return "<!-- QR omitted: report verification link not available -->";
           try {
             return qrSvg(report.verifyUrl, { size: 150, margin: 2, label: "Scan to verify this report" })
               + `<span class="cl-qr-cap">Scan to verify</span>`;
           } catch { return "<!-- QR omitted: could not encode the verification link -->"; }
         })()}</div>
         <div class="cl-pcol">
           ${[["Registered Date", formatDateTime(report.registeredDate || report.createdAt) || formatDate(report.collectionDate)],
              ["Collection Date", formatDateTime(report.collectionDate) || formatDate(report.collectionDate)],
              ["Reported Date", formatDateTime(report.reportingDate || report.approvedAt) || formatDate(report.reportingDate)],
              ["Ref. By", report.refBy || "Self"]]
             .filter(([, v]) => String(v || "").trim())
             .map(([k, v]) => `<div class="cl-prow"><span>${esc(k)}</span><b>:</b><span>${esc(v)}</span></div>`)
             .join("")}
         </div>
       </div>`
    : `<div class="patient-grid">
        ${patientRows(report).map(([label, value]) =>
          `<div class="row"><span class="label">${esc(label)}</span><span class="value">${esc(value)}</span></div>`).join("")}
      </div>`;

  // Signatures on EVERY page, not only the last. A pathology report is often
  // separated and a single page handed to a referring doctor, so an unsigned
  // page is not much use - and it is how the sample report prints.
  const classicFooter = () => `
    <div class="report-foot cl-foot">
      ${classicSignatures(settings, branding, report)}
      <div class="cl-note">
        <span class="cl-noteicon" aria-hidden="true"></span>
        <span>${esc(settings.footerNote
          || "The report finding should be correlated with clinical parameters. The test may be repeated if needed.")}</span>
      </div>
      ${branding.showPoweredBy !== false ? `<p class="powered">Powered by Swati Softtech Solution</p>` : ""}
      <div class="cl-strip">
        <span class="cl-strip-slashes" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="cl-strip-text">${esc(settings.disclaimer || branding.disclaimer)}</span>
      </div>
    </div>`;

  const standardFooter = (isLast) => `
    <div class="report-foot">
      ${isLast ? signatureBlock(settings, branding, report) : ""}
      ${isLast ? `<div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-top:14px;">
        ${verifyBlock(settings, report, branding)}
        ${branding.stampUrl ? `<img src="${esc(branding.stampUrl)}" alt="Laboratory stamp" style="max-height:70px;">` : "<span></span>"}
      </div>` : ""}
      ${settings.footerNote ? `<p class="test-note">${esc(settings.footerNote)}</p>` : ""}
      <p class="disclaimer">${esc(settings.disclaimer || branding.disclaimer)}</p>
      ${branding.showPoweredBy !== false ? `<p class="powered">Powered by Swati Softtech Solution</p>` : ""}
    </div>`;

  const footer = template.id === "classic-letterhead" ? classicFooter : standardFooter;

  const pageFoot = (n, total) =>
    total > 1 ? `<div class="page-count">Page ${n} of ${total}</div>` : "";

  // "*** End of Report ***" is what these laboratories print today.
  const endMark = template.id === "classic-letterhead"
    ? (last) => (last ? "*** End of Report ***" : "*** Continued ***")
    : (last) => (last ? "— END OF REPORT —" : "— CONTINUED —");

  // --- one continuous sheet ---
  if (!perTest || groups.length <= 1) {
    return `
<div class="report-page tpl-${template.id}">
  ${watermark}
  ${header}
  ${settings.headerNote ? `<p class="test-note">${esc(settings.headerNote)}</p>` : ""}
  ${patientBlock}
  ${groups.length
    ? groups.map((g) => resultsTable(g, tableOptions)).join("")
    : `<p class="test-note">No results have been entered for this report yet.</p>`}
  ${report.interpretation
    ? `<div class="interpretation"><h4>Interpretation / Comments</h4><p>${esc(report.interpretation)}</p></div>` : ""}
  ${medicalNoticeBlock(report)}
  <div class="end-mark">${endMark(true)}</div>
  ${footer(true)}
</div>`;
  }

  // --- one page per test ---
  const total = groups.length;
  return groups.map((group, index) => {
    const isLast = index === total - 1;
    return `
<div class="report-page tpl-${template.id}">
  ${watermark}
  ${header}
  ${index === 0 && settings.headerNote ? `<p class="test-note">${esc(settings.headerNote)}</p>` : ""}
  ${patientBlock}
  ${resultsTable(group, tableOptions)}
  ${isLast && report.interpretation
    ? `<div class="interpretation"><h4>Interpretation / Comments</h4><p>${esc(report.interpretation)}</p></div>` : ""}
  ${isLast ? medicalNoticeBlock(report) : ""}
  <div class="end-mark">${endMark(isLast)}</div>
  ${footer(isLast)}
  ${pageFoot(index + 1, total)}
</div>`;
  }).join("\n");
}

// ---------- laboratory-supplied templates ----------

/**
 * A laboratory may upload its own layout. It is rendered through a deliberately
 * small placeholder language rather than as live HTML: the uploaded markup is
 * sanitised (see sanitizeTemplate) and every value substituted into it is
 * escaped. A report template is viewed by patients on a shared link, so an
 * uploaded <script> would be a stored XSS against them.
 */
export function renderCustomTemplate(report, branding, settings = {}) {
  const html = sanitizeTemplate(settings.customTemplate.html);
  const perTest = settings.pageBreakPerTest !== false;
  const groups = report.groups || [];
  const showMethod = settings.showMethod === true;

  const base = {
    ...flattenBranding(branding),
    patientName: report.patientName, patientId: report.patientId,
    age: report.age, gender: report.gender,
    ageGender: [report.age, report.gender].filter(Boolean).join(" / "),
    billNo: report.billNo, refBy: report.refBy || "Self",
    sampleType: report.sampleType, reportStatus: report.reportStatus,
    collectionDate: formatDate(report.collectionDate),
    reportingDate: formatDate(report.reportingDate || report.approvedAt),
    interpretation: report.interpretation || "",
    disclaimer: settings.disclaimer || branding.disclaimer,
    footerNote: settings.footerNote || "",
    headerNote: settings.headerNote || "",
    signatures: signatureBlock(settings, branding, report),
    verification: verifyBlock(settings, report, branding),
    poweredBy: branding.showPoweredBy !== false
      ? '<span class="powered">Powered by Swati Softtech Solution</span>' : ""
  };

  const pages = perTest && groups.length > 1 ? groups.map((g) => [g]) : [groups];
  return pages.map((pageGroups, index) => fillTemplate(html, {
    ...base,
    pageNumber: index + 1,
    pageCount: pages.length,
    endMark: index === pages.length - 1 ? "— END OF REPORT —" : "— CONTINUED —",
    results: pageGroups.map((g) => resultsTable(g, { showMethod })).join(""),
    testName: pageGroups[0]?.testName || "",
    testCode: pageGroups[0]?.testCode || "",
    sample: pageGroups[0]?.sample || ""
  })).join("\n");
}

function flattenBranding(branding) {
  const out = {};
  Object.entries(branding).forEach(([key, value]) => {
    if (typeof value === "string" || typeof value === "number") out[key] = value;
  });
  out.logo = branding.logoUrl
    ? `<img src="${esc(branding.logoUrl)}" alt="${esc(branding.labName)}" style="max-height:70px;max-width:160px;object-fit:contain;">`
    : "";
  out.stamp = branding.stampUrl
    ? `<img src="${esc(branding.stampUrl)}" alt="" style="max-height:70px;">` : "";
  return out;
}

/** Values already containing markup we generated ourselves. */
const RAW_PLACEHOLDERS = new Set([
  "results", "signatures", "verification", "logo", "stamp", "poweredBy"
]);

/** {{placeholder}} substitution. Everything is escaped unless we produced it. */
export function fillTemplate(template, values) {
  return String(template || "").replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key) => {
    const value = values[key];
    if (value === undefined || value === null) return "";
    return RAW_PLACEHOLDERS.has(key) ? String(value) : esc(String(value));
  });
}

/**
 * Strip anything executable from an uploaded template. The output of this is
 * inserted into a page that patients open from a WhatsApp link, so this is a
 * security boundary, not a tidy-up.
 */
export function sanitizeTemplate(html) {
  return String(html || "")
    .replace(/<\s*script[\s\S]*?<\s*\/\s*script\s*>/gi, "")
    .replace(/<\s*script[^>]*\/?>/gi, "")
    .replace(/<\s*iframe[\s\S]*?<\s*\/\s*iframe\s*>/gi, "")
    .replace(/<\s*(iframe|object|embed|form|input|button|link|meta|base)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
    .replace(/\son\w+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/data\s*:\s*text\/html/gi, "");
}

/** Problems worth telling the operator about before they save a template. */
export function validateTemplate(html) {
  const problems = [];
  const text = String(html || "");
  if (!text.trim()) problems.push("The template is empty.");
  if (!/\{\{\s*results\s*\}\}/.test(text)) {
    problems.push("No {{results}} placeholder - the test results would not appear.");
  }
  if (!/report-page/.test(text)) {
    problems.push('No element with class "report-page" - page breaks and A4 sizing will not apply.');
  }
  if (/<\s*script/i.test(text)) problems.push("A <script> tag was found and will be removed.");
  if (/\son\w+\s*=/i.test(text)) problems.push("Inline event handlers were found and will be removed.");
  const unknown = [...text.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1])
    .filter((k) => !TEMPLATE_PLACEHOLDERS.includes(k));
  if (unknown.length) {
    problems.push(`Unknown placeholder(s): ${[...new Set(unknown)].join(", ")}`);
  }
  return problems;
}

/** Every placeholder an uploaded template may use. Shown in the editor. */
export const TEMPLATE_PLACEHOLDERS = Object.freeze([
  "labName", "legalName", "tagline", "logo", "stamp", "fullAddress", "address", "city",
  "state", "pincode", "phone", "altPhone", "whatsapp", "email", "website",
  "gstNumber", "licenseNumber", "registrationNumber", "businessHours",
  "patientName", "patientId", "age", "gender", "ageGender", "billNo", "refBy",
  "sampleType", "reportStatus", "collectionDate", "reportingDate",
  "results", "testName", "testCode", "sample", "interpretation",
  "signatures", "verification", "disclaimer", "headerNote", "footerNote",
  "endMark", "pageNumber", "pageCount", "poweredBy"
]);

/**
 * The built-in layout as an editable starting point. A laboratory downloads
 * this, edits it, and uploads it back - which is what "upload a modified
 * template" means in practice.
 */
export function templateSource(templateId = "modern-diagnostic") {
  const t = templateById(templateId);
  return `<!-- ${t.name} - editable copy.
     Placeholders: {{labName}} {{logo}} {{fullAddress}} {{phone}} {{email}}
                   {{patientName}} {{patientId}} {{ageGender}} {{billNo}} {{refBy}}
                   {{collectionDate}} {{reportingDate}} {{sampleType}} {{reportStatus}}
                   {{results}} {{interpretation}} {{signatures}} {{verification}}
                   {{disclaimer}} {{endMark}} {{pageNumber}} {{pageCount}} {{poweredBy}}
     Keep class="report-page" on the outer element so A4 sizing and page breaks work.
     Script tags and on* event handlers are stripped on save. -->
<div class="report-page tpl-${t.id}">
  <header class="lab-head" style="display:flex;align-items:center;gap:14px;border-bottom:2px solid var(--rp-primary);padding-bottom:8px;">
    {{logo}}
    <div>
      <h1 style="margin:0;font-size:24px;color:var(--rp-primary);">{{labName}}</h1>
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;">{{tagline}}</div>
      <div style="font-size:11px;color:#6b7280;">Licence: {{licenseNumber}}</div>
    </div>
    <div style="margin-left:auto;text-align:right;font-size:11px;line-height:1.6;">
      <div>{{fullAddress}}</div>
      <div>{{phone}}</div>
      <div>{{email}}</div>
      <div>{{website}}</div>
    </div>
  </header>

  <div class="patient-grid">
    <div class="row"><span class="label">Patient Name</span><span class="value">{{patientName}}</span></div>
    <div class="row"><span class="label">Patient ID</span><span class="value">{{patientId}}</span></div>
    <div class="row"><span class="label">Age / Gender</span><span class="value">{{ageGender}}</span></div>
    <div class="row"><span class="label">Bill No</span><span class="value">{{billNo}}</span></div>
    <div class="row"><span class="label">Referred By</span><span class="value">{{refBy}}</span></div>
    <div class="row"><span class="label">Sample Type</span><span class="value">{{sampleType}}</span></div>
    <div class="row"><span class="label">Collected</span><span class="value">{{collectionDate}}</span></div>
    <div class="row"><span class="label">Reported</span><span class="value">{{reportingDate}}</span></div>
  </div>

  {{results}}

  <div class="interpretation">{{interpretation}}</div>
  <div class="end-mark">{{endMark}}</div>

  <div class="report-foot">
    {{signatures}}
    {{verification}}
    <p class="disclaimer">{{disclaimer}}</p>
    <p class="powered">{{poweredBy}}</p>
  </div>
  <div class="page-count">Page {{pageNumber}} of {{pageCount}}</div>
</div>`;
}

/** Full standalone document, used for print windows and PDF export. */
export function renderReportDocument(report, branding, settings = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(report.patientName || "Report")} - ${esc(branding.labName)}</title>
<style>${reportStyles(branding)}</style>
</head>
<body>${renderReport(report, branding, settings)}</body>
</html>`;
}

/**
 * Print / save as PDF. The browser's own print-to-PDF is used deliberately:
 * it needs no library, produces selectable text, and prints identically to
 * what the laboratory sees on screen.
 */
export function printReport(report, branding, settings = {}) {
  const win = window.open("", "_blank", "width=900,height=1000");
  if (!win) throw new Error("Please allow pop-ups to print the report.");
  win.document.write(renderReportDocument(report, branding, settings));
  win.document.close();
  win.focus();
  const go = () => { win.print(); };
  if (win.document.readyState === "complete") setTimeout(go, 350);
  else win.onload = () => setTimeout(go, 350);
  return win;
}


/**
 * Scale every rendered A4 sheet to exactly fit its container.
 *
 * The stylesheet steps --rp-scale by breakpoint so a page still fits with no
 * scripting, but a step is never exact. This measures the real width and sets
 * the precise ratio, then keeps it right as the window or orientation changes.
 *
 * @param {Element} container element holding the .report-page sheets
 * @returns {Function} call to stop listening
 */
export function fitReportsToWidth(container = document.body) {
  const A4_WIDTH_PX = 210 * (96 / 25.4);   // 210mm at CSS 96dpi

  const apply = () => {
    const available = container.clientWidth;
    if (!available) return;
    // Never enlarge: a report is a fixed-size document, not a fluid layout.
    const scale = Math.min(available / A4_WIDTH_PX, 1);
    container.querySelectorAll(".report-page").forEach((page) => {
      page.style.setProperty("--rp-scale", scale.toFixed(4));
    });
  };

  apply();
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(apply) : null;
  observer?.observe(container);
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);

  return () => {
    observer?.disconnect();
    window.removeEventListener("orientationchange", apply);
    window.removeEventListener("resize", apply);
  };
}
