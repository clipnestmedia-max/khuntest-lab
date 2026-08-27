// Pathologist review workflow (§30, and product decision 5).
// NO Firebase imports.
//
// THE RULE THIS ENFORCES: software cannot validate itself. A generated comment
// is a DRAFT until a named, authorised pathologist approves it. Nothing here
// will record an approval against the demo placeholder, and nothing will mark
// a report releasable on the strength of the software having produced it.
import { REVIEW_STATUS, COMMENT_LEVEL, DEMO_PATHOLOGIST, isRealPathologist } from "./schema.js";

/**
 * The record attached to a report. Both the generated text and the final text
 * are kept, so it is always visible what the software proposed and what the
 * pathologist actually released.
 */
export function newInterpretationRecord(draft, { labId = "", reportId = "" } = {}) {
  return {
    labId,
    reportId,
    generatedText: draft.text || "",
    generatedLevel: draft.level ?? COMMENT_LEVEL.NONE,
    generatedAt: new Date().toISOString(),
    generatedBy: "swati-medical-engine",
    sourceRules: draft.sourceRules || [],

    finalText: "",
    status: draft.reviewStatus || REVIEW_STATUS.DRAFT,
    holdsRelease: Boolean(draft.holdsRelease),

    editedBy: "", editedAt: "",
    approvedBy: "", approvedAt: "",
    // Set only when a real pathologist approves. A report can never claim
    // clinical validation because the engine produced the text.
    clinicallyValidated: false
  };
}

/** A pathologist edits the draft. Does not approve it. */
export function applyEdit(record, newText, editor) {
  const name = String(editor?.name || "").trim();
  if (!name) throw new Error("An edit must record who made it.");
  return {
    ...record,
    finalText: String(newText ?? ""),
    status: REVIEW_STATUS.EDITED,
    editedBy: name,
    editedAt: new Date().toISOString()
  };
}

/**
 * Approve for release.
 *
 * Refuses the demo placeholder, and refuses anyone the laboratory has not
 * authorised to sign reports. This is the gate the whole engine exists behind.
 */
export function approve(record, approver, { authorisedSignatories = [] } = {}) {
  const name = String(approver?.name || "").trim();

  if (!isRealPathologist(name)) {
    throw new Error(
      "Approval requires a named authorised pathologist. "
      + `"${name || "(blank)"}" cannot approve a clinical report.`
    );
  }

  // The laboratory decides who may sign. An empty list means none configured,
  // which must block rather than wave everything through.
  const authorised = authorisedSignatories
    .map((s) => String(s?.name || s || "").trim().toUpperCase())
    .filter(Boolean);
  if (!authorised.length) {
    throw new Error(
      "No authorised signatories are configured for this laboratory. "
      + "Add a pathologist under Branding → Report signatories before approving reports."
    );
  }
  if (!authorised.includes(name.toUpperCase())) {
    throw new Error(`${name} is not an authorised signatory for this laboratory.`);
  }

  return {
    ...record,
    finalText: record.finalText || record.generatedText,
    status: REVIEW_STATUS.APPROVED,
    approvedBy: name,
    approvedAt: new Date().toISOString(),
    holdsRelease: false,
    clinicallyValidated: true
  };
}

/** What the patient's report should show. Never the draft on its own. */
export function releasableText(record) {
  if (!record) return "";
  if (record.status !== REVIEW_STATUS.APPROVED) return "";
  return record.finalText || record.generatedText || "";
}

/**
 * May this report be released?
 * @returns {{ok: boolean, reason: string}}
 */
export function canRelease(record, { requireApproval = true } = {}) {
  if (!record) return { ok: true, reason: "" };
  if (record.holdsRelease && record.status !== REVIEW_STATUS.APPROVED) {
    return { ok: false, reason: "Pathologist review is required before this report can be released." };
  }
  if (requireApproval && record.status !== REVIEW_STATUS.APPROVED) {
    return { ok: false, reason: "The interpretation has not been approved by a pathologist." };
  }
  return { ok: true, reason: "" };
}

/** Demo/development record — clearly marked, never releasable as clinical. */
export function demoRecord(draft) {
  return {
    ...newInterpretationRecord(draft),
    status: REVIEW_STATUS.REVIEW_REQUIRED,
    holdsRelease: true,
    approvedBy: DEMO_PATHOLOGIST,
    clinicallyValidated: false,
    isDemo: true
  };
}

export { REVIEW_STATUS, DEMO_PATHOLOGIST, isRealPathologist };
