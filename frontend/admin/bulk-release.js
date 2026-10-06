// One-time / on-demand catch-up: release every Draft report whose measured
// parameters are all entered. Before auto-release existed, reports that were
// fully entered stayed "Draft" until someone pressed the separate release
// button; this applies the same release (Final + share link + booking "Report
// Ready") to all of them at once. It never touches:
//  - reports a person deliberately reverted for correction (they carry a
//    revertReason),
//  - Culture & Sensitivity reports (their own review flow),
//  - drafts that are still incomplete.
import * as Reports from "../core/data/reports.js";
import * as Bookings from "../core/data/bookings.js";
import { listSignatories } from "../core/data/staff.js";
import { createShareLink } from "./report-share.js";
import { esc, openModal, toastOk, toastWarn, reportError } from "../core/ui.js";

export function isBulkReleasable(report) {
  return report?.reportStatus === "Draft"
    && !report.revertReason
    && !(report.cultureResults || []).length
    && Reports.gridProgress(report.groups || []).complete;
}

export async function findReleasableDrafts() {
  // listReports reads max*4 documents and Firestore rejects a query limit over
  // 10000, so 2000 is the most that can be asked for here.
  const all = await Reports.listReports({ max: 2000 });
  return all.filter(isBulkReleasable);
}

function chooseSignatory(candidates, signatories, session) {
  return new Promise((resolve) => {
    const multiple = signatories.length > 1;
    const { element, close } = openModal({
      title: "Release all complete drafts",
      body: `
        <p><b>${candidates.length}</b> draft report${candidates.length === 1 ? " has" : "s have"} every parameter entered
        and will be released to the patient as <b>Final</b>.</p>
        <p class="small muted">Not included: drafts still missing values, Culture &amp; Sensitivity reports,
        and reports you reverted on purpose for correction.</p>
        <div class="small" style="max-height:140px;overflow:auto;margin:8px 0;">
          ${candidates.slice(0, 60).map((r) => `<div>${esc(r.billNo)} &mdash; ${esc(r.patientName)}</div>`).join("")}
          ${candidates.length > 60 ? `<div class="muted">…and ${candidates.length - 60} more</div>` : ""}
        </div>
        ${multiple ? `<label class="field"><span>Signatory for all of these reports</span><select id="bulkSig">
          ${signatories.map((s) => `<option value="${esc(s.uid)}" ${s.uid === session.uid ? "selected" : ""}>${esc(s.name)} — ${esc(s.qualification || s.designation || "")}</option>`).join("")}
        </select></label>` : ""}`,
      footer: `<button class="btn btn-outline" data-act="cancel" type="button">Cancel</button>
               <button class="btn" data-act="ok" type="button">Release ${candidates.length}</button>`,
      onClose: () => resolve(undefined)
    });
    element.querySelector('[data-act="cancel"]').addEventListener("click", () => { close(); resolve(undefined); });
    element.querySelector('[data-act="ok"]').addEventListener("click", () => {
      const uid = element.querySelector("#bulkSig")?.value;
      const picked = signatories.find((s) => s.uid === uid)
        || signatories.find((s) => s.uid === session.uid) || signatories[0] || null;
      element.remove();
      resolve(picked);
    });
  });
}

/** Returns the number released (0 when nothing to do or cancelled). */
export async function releaseCompleteDrafts({ session, onProgress = () => {} }) {
  let candidates;
  try { candidates = await findReleasableDrafts(); }
  catch (error) { reportError(error, "Could not read the reports."); return 0; }
  if (!candidates.length) { toastWarn("No complete drafts to release."); return 0; }

  const signatories = await listSignatories().catch(() => []);
  const picked = await chooseSignatory(candidates, signatories, session);
  if (picked === undefined) return 0;                       // cancelled
  const signatory = picked ? {
    name: picked.name, qualification: picked.qualification, designation: picked.designation,
    registrationNumber: picked.registrationNumber, signatureUrl: picked.signatureUrl
  } : null;

  let done = 0;
  const failed = [];
  for (const draft of candidates) {
    onProgress(done, candidates.length);
    try {
      await Reports.approveReport(draft.reportId, { actor: session, signatory });
      const report = await Reports.getReport(draft.reportId);
      const booking = await Bookings.getBooking(report.bookingId).catch(() => null);
      try {
        const { url } = await createShareLink({ report, booking, actor: session });
        await Reports.saveReportVerifyUrl(report.reportId, url);
      } catch (error) {
        console.warn("[BULK RELEASE] share link not created for", draft.billNo, error?.message);
      }
      done += 1;
    } catch (error) {
      console.warn("[BULK RELEASE] failed", draft.billNo, error?.message);
      failed.push(draft.billNo || draft.reportId);
    }
  }
  onProgress(done, candidates.length);
  if (failed.length) toastWarn(`Released ${done}. Could not release: ${failed.join(", ")}.`);
  else toastOk(`Released ${done} report${done === 1 ? "" : "s"}.`);
  return done;
}
