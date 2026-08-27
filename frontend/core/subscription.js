// Subscription plans and expiry gating.
//
// Rule 23 of the product spec: an expired subscription must NEVER delete or
// hide data - it only blocks write actions and shows a renewal notice, so a
// laboratory that renews finds everything exactly as it left it.

export const PLANS = Object.freeze({
  starter: {
    id: "starter",
    name: "Starter",
    priceMonthly: 999,
    features: ["admin_panel", "patients", "billing", "reports", "test_catalogue"],
    summary: "Laboratory admin, patient management, billing and report generation."
  },
  professional: {
    id: "professional",
    name: "Professional",
    priceMonthly: 1999,
    features: [
      "admin_panel", "patients", "billing", "reports", "test_catalogue",
      "online_booking", "home_collection", "whatsapp", "patient_portal", "analytics"
    ],
    summary: "Everything in Starter plus online booking, home collection, WhatsApp, patient portal and analytics."
  },
  business: {
    id: "business",
    name: "Business",
    priceMonthly: 3999,
    features: [
      "admin_panel", "patients", "billing", "reports", "test_catalogue",
      "online_booking", "home_collection", "whatsapp", "patient_portal", "analytics",
      "public_website", "custom_domain", "multi_branch", "advanced_analytics", "priority_support"
    ],
    summary: "Everything in Professional plus a public website, custom domain, multiple branches and advanced analytics."
  }
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  TRIAL: "trial",
  ACTIVE: "active",
  EXPIRED: "expired",
  SUSPENDED: "suspended",
  DISABLED: "disabled"
});

export const EXPIRED_MESSAGE =
  "Your Swati Softtech Solution subscription has expired. Please renew to continue.";

export const SUSPENDED_MESSAGE =
  "This laboratory account has been suspended. Please contact Swati Softtech Solution.";

function toDate(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function daysRemaining(lab, now = new Date()) {
  const end = toDate(lab?.subscriptionEnd);
  if (!end) return null;
  return Math.ceil((end.getTime() - now.getTime()) / 86400000);
}

/**
 * Effective state of a laboratory account. `readOnly` is the important flag:
 * an expired or suspended lab can still read everything it ever created.
 */
export function evaluateSubscription(lab, now = new Date()) {
  const status = String(lab?.subscriptionStatus || "").toLowerCase();
  const remaining = daysRemaining(lab, now);
  const end = toDate(lab?.subscriptionEnd);

  if (status === SUBSCRIPTION_STATUS.DISABLED) {
    return { state: "disabled", readOnly: true, blocked: true, message: SUSPENDED_MESSAGE, daysRemaining: remaining };
  }
  if (status === SUBSCRIPTION_STATUS.SUSPENDED) {
    return { state: "suspended", readOnly: true, blocked: true, message: SUSPENDED_MESSAGE, daysRemaining: remaining };
  }
  if (status === SUBSCRIPTION_STATUS.EXPIRED || (end && end.getTime() < now.getTime())) {
    return { state: "expired", readOnly: true, blocked: false, message: EXPIRED_MESSAGE, daysRemaining: remaining };
  }
  if (status === SUBSCRIPTION_STATUS.TRIAL) {
    return {
      state: "trial", readOnly: false, blocked: false, daysRemaining: remaining,
      message: remaining != null && remaining <= 7
        ? `Trial ends in ${remaining} day${remaining === 1 ? "" : "s"}. Contact Swati Softtech Solution to activate your plan.`
        : ""
    };
  }
  return {
    state: "active", readOnly: false, blocked: false, daysRemaining: remaining,
    message: remaining != null && remaining <= 7
      ? `Your subscription renews in ${remaining} day${remaining === 1 ? "" : "s"}.`
      : ""
  };
}

export function planFeatures(planId) {
  return PLANS[String(planId || "").toLowerCase()]?.features || PLANS.starter.features;
}

/** Feature gate: does this lab's plan include `feature`? */
export function hasFeature(lab, feature) {
  return planFeatures(lab?.plan).includes(feature);
}

export function planLabel(planId) {
  return PLANS[String(planId || "").toLowerCase()]?.name || "Starter";
}
