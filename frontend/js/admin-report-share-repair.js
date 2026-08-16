// Admin-only diagnostic/repair tool for reportShares records whose `reportId`
// field has drifted from the actual reports/{id} document (see
// whatsapp-report-share.js's resolveReportDoc() for why that happens - a
// report keeps its original doc id forever, but its billNo field can later
// change). This never touches the reportShares document id itself (that
// must stay the token hash - see frontend/firestore.rules) or any medical
// content; it only corrects the stored `reportId` field so admin-side
// "existing share" lookups (status display, Regenerate, Revoke) find the
// right record. Patient-facing shared links are unaffected either way,
// since they resolve purely by tokenHash and read the already-denormalized
// reportShareResults content.
//
// Usage from the browser console while signed in as admin:
//   const { auditReportShares } = await import("./js/admin-report-share-repair.js");
//   await auditReportShares();                       // dry run, logs findings only
//   await auditReportShares({ billNo: "502226" });    // dry run, scoped to one bill
//   await auditReportShares({ apply: true });         // apply the fixes found above
import { db } from "../firebase-config.js";
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { resolveReportDoc } from "./whatsapp-report-share.js";

export async function auditReportShares({ apply = false, billNo = null } = {}) {
  const snap = await getDocs(collection(db, "reportShares"));
  const findings = [];

  for (const shareDoc of snap.docs) {
    const share = shareDoc.data();
    if (billNo && String(share.billNo || "") !== String(billNo)) continue;

    if (!share.reportId) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", issue: "missing-reportId" });
      continue;
    }

    let canonical;
    try {
      canonical = await resolveReportDoc(share.reportId, share.billNo);
    } catch (err) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", storedReportId: share.reportId, issue: "resolve-failed", message: err.message });
      continue;
    }

    if (!canonical.exists()) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", storedReportId: share.reportId, issue: "report-not-found" });
      continue;
    }

    // Per the "permanent link" model (see whatsapp-report-share.js), an
    // active share must stay enabled/not-revoked/non-expiring - this
    // repairs old records left in a broken state (e.g. a stray manual edit,
    // or a revoke that was never meant to be permanent) without touching
    // any medical/payment data. Only runs when explicitly invoked with
    // apply: true from the admin console - never automatically.
    const patch = {};
    if (canonical.id !== share.reportId) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", storedReportId: share.reportId, canonicalReportId: canonical.id, issue: "reportId-mismatch" });
      patch.reportId = canonical.id;
    }
    if (share.enabled === false) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", issue: "disabled" });
      patch.enabled = true;
    }
    if (share.revoked === true) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", issue: "revoked" });
      patch.revoked = false;
    }
    if (share.expiresAt) {
      findings.push({ shareId: shareDoc.id, billNo: share.billNo || "", issue: "has-expiry" });
      patch.expiresAt = null;
    }

    if (Object.keys(patch).length && apply) {
      await updateDoc(doc(db, "reportShares", shareDoc.id), { ...patch, updatedAt: serverTimestamp() });
    }
  }

  if (typeof console.table === "function") console.table(findings); else console.log(findings);
  console.info(`[repairReportShares] ${apply ? "Applied fixes for" : "Dry run -"} ${findings.length} issue(s) found across ${snap.size} share record(s).`);
  return findings;
}
