// Public, unauthenticated report-sharing client used by report.html when a
// `?share=<token>` link is opened.
//
// This talks to Firestore directly (no Cloud Function - this project's GCP
// APIs for Cloud Functions/Cloud Build aren't enabled yet, see functions/
// for the dormant server-side version to migrate back to later). Security
// is enforced entirely by frontend/firestore.rules:
//   - reportShares/{tokenHash}: metadata only, world-readable by exact id
//     (the id IS the SHA-256 hash of a 256-bit token - unguessable, and
//     `list` stays admin-only so it can't be enumerated).
//   - reportShareResults/{tokenHash}: the actual sanitized report content,
//     readable only while the share is active AND the report is still
//     released (checked live). Payment status is deliberately not part of
//     the decision - a released report opens whether or not the bill is
//     fully paid. This deliberately never touches Firebase Auth.
import { db } from "../firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { isValidTokenFormat, hashTokenHex, shareState, isExplicitlyNotReleasedHint, MESSAGES } from "./shared-report-logic.js";

const SHARE_COLLECTION = "reportShares";
const RESULTS_COLLECTION = "reportShareResults";

export async function fetchSharedReport(rawToken) {
  // Never log the raw token itself (it's the secret) - length/prefix only.
  console.log("[shared-report] lookup start", { tokenLength: rawToken ? rawToken.length : 0 });

  if (!isValidTokenFormat(rawToken)) {
    console.warn("[shared-report] token failed format validation");
    return { success: false, state: "invalid_link", message: MESSAGES.invalid_link };
  }

  let tokenHash;
  try {
    tokenHash = await hashTokenHex(rawToken.trim());
  } catch (err) {
    console.error("[shared-report] failed to hash token", err.message);
    return { success: false, state: "error", message: "Report could not be loaded. Please try again." };
  }
  console.log("[shared-report] tokenHash computed, querying reportShares", { path: `${SHARE_COLLECTION}/${tokenHash}` });

  let shareSnap;
  try {
    shareSnap = await getDoc(doc(db, SHARE_COLLECTION, tokenHash));
  } catch (err) {
    console.error("[shared-report] permission/error reading reportShares", { code: err.code, message: err.message });
    return { success: false, state: "error", message: "Report could not be loaded. Please try again." };
  }

  console.log("[shared-report] reportShares document exists:", shareSnap.exists());
  if (!shareSnap.exists()) {
    return { success: false, state: "invalid_link", message: MESSAGES.invalid_link };
  }

  const share = shareSnap.data();
  const state = shareState(share);
  console.log("[shared-report] share state:", state);
  if (state !== "active") {
    return { success: false, state, message: MESSAGES[state], billNo: share.billNo || "" };
  }

  // reportShareReportReleased() (firestore.rules) always re-checks the
  // live report status before allowing the read below. Check the
  // creation-time hint first so the common case (a report shared before it
  // was actually Final) is answered without a denied read.
  if (isExplicitlyNotReleasedHint(share.reportStatusHint)) {
    console.log("[shared-report] report not released per hint:", share.reportStatusHint);
    return { success: false, state: "not_released", message: MESSAGES.not_released, billNo: share.billNo || "" };
  }

  console.log("[shared-report] share active, querying reportShareResults", { path: `${RESULTS_COLLECTION}/${tokenHash}` });
  let resultsSnap;
  try {
    resultsSnap = await getDoc(doc(db, RESULTS_COLLECTION, tokenHash));
  } catch (err) {
    // firestore.rules denies this read unless the share is active and the
    // report is still released. The share itself was already confirmed
    // active above, so a permission-denied here means the report has been
    // withdrawn since the link was made (e.g. reverted to Draft for an edit).
    // Any other failure (offline, timeout) is a load error, not a verdict.
    console.log("[shared-report] reportShareResults read failed:", err.code);
    if (err.code === "permission-denied") {
      return { success: false, state: "not_released", message: MESSAGES.not_released, billNo: share.billNo || "" };
    }
    return { success: false, state: "error", message: "Report could not be loaded. Please try again." };
  }

  console.log("[shared-report] reportShareResults document exists:", resultsSnap.exists());
  if (!resultsSnap.exists()) {
    // The read succeeded but the content doc is missing - shouldn't happen
    // since both docs are written together, but fail toward "contact the
    // lab" rather than a silent blank report.
    return { success: false, state: "error", message: "Report could not be loaded. Please try again." };
  }

  return { success: true, state: "available", report: resultsSnap.data() };
}

export const LAB_CONTACT = {
  phone: "+91 9234277007",
  whatsapp: "919234277007"
};
