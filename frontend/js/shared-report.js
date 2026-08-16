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
//     readable only while the share is active AND the linked booking's
//     payment status is live-checked as Paid - so this module never even
//     receives medical results before payment clears, let alone displays
//     them. This deliberately never touches Firebase Auth.
import { db } from "../firebase-config.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { isValidTokenFormat, hashTokenHex, shareState, isReleasedStatusHint, MESSAGES } from "./shared-report-logic.js";

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
  // live report status before allowing the read below, but a
  // permission-denied from that rule reads identically to a payment
  // denial - check the creation-time hint first so the common case (a
  // report shared before it was actually Final) shows "still under
  // review" instead of misleadingly asking the patient to pay.
  if (!isReleasedStatusHint(share.reportStatusHint)) {
    console.log("[shared-report] report not released per hint:", share.reportStatusHint);
    return { success: false, state: "not_released", message: MESSAGES.not_released, billNo: share.billNo || "" };
  }

  console.log("[shared-report] share active, querying reportShareResults", { path: `${RESULTS_COLLECTION}/${tokenHash}` });
  let resultsSnap;
  try {
    resultsSnap = await getDoc(doc(db, RESULTS_COLLECTION, tokenHash));
  } catch (err) {
    // firestore.rules denies this read unless the linked booking's payment
    // is live-confirmed as Paid (and the report is still released, see the
    // hint check above) - a permission-denied here, given the share itself
    // is already confirmed active and released above, means payment is
    // pending.
    console.log("[shared-report] reportShareResults denied (payment not cleared):", err.code);
    return {
      success: false,
      state: "payment_pending",
      message: MESSAGES.payment_pending,
      billNo: share.billNo || "",
      payment: { status: (share.paymentStatusHint || "pending").toLowerCase(), balanceDue: Number(share.balanceDueHint || 0) }
    };
  }

  console.log("[shared-report] reportShareResults document exists:", resultsSnap.exists());
  if (!resultsSnap.exists()) {
    // Payment is cleared (the read succeeded) but the content doc is
    // missing - shouldn't happen since both docs are written together, but
    // fail toward "contact the lab" rather than a silent blank report.
    return { success: false, state: "error", message: "Report could not be loaded. Please try again." };
  }

  return { success: true, state: "available", report: resultsSnap.data() };
}

export const PAYMENT_PENDING_COPY = {
  title: "Payment Pending",
  body: "Your report is ready, but payment has not been cleared yet. Please clear your pending payment to view and download your report."
};

export const LAB_CONTACT = {
  phone: "+91 9234277007",
  whatsapp: "919234277007"
};
