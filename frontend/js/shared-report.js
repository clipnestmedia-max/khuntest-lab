// Public, unauthenticated report-sharing client used by report.html when a
// `?share=<token>` link is opened. This module never touches Firebase Auth
// or Firestore directly - it only talks to the trusted getSharedReport
// Cloud Function (via the same-origin /api/shared-report/:token Hosting
// rewrite), which is what actually enforces release + payment gating.
const SHARED_REPORT_ENDPOINT = "/api/shared-report/";

const REQUEST_TIMEOUT_MS = 15000;

export async function fetchSharedReport(token) {
  const url = SHARED_REPORT_ENDPOINT + encodeURIComponent(token);
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller?.signal
    });
    let body = null;
    try { body = await response.json(); } catch (_err) { body = null; }
    if (!body) {
      return { success: false, state: "error", message: "Unable to load report right now. Please try again shortly." };
    }
    return body;
  } catch (err) {
    const timedOut = err?.name === "AbortError";
    console.error("[shared-report] network error fetching share token", timedOut ? "request timed out" : err.message);
    return {
      success: false,
      state: "error",
      message: timedOut ? "The request took too long. Please try again." : "Could not reach the server. Check your connection and try again."
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const PAYMENT_PENDING_COPY = {
  title: "Payment Pending",
  body: "Your report is ready, but payment has not been cleared yet. Please clear your pending payment to view and download your report."
};

export const LAB_CONTACT = {
  phone: "+91 9234277007",
  whatsapp: "919234277007"
};
