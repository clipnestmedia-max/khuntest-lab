// Role and permission matrix.
//
// Permissions are checked in the UI (to hide what a user may not do) AND
// mirrored in database/firestore.rules (to enforce it). The UI check is
// convenience; the rules check is the security boundary. Keep the two in
// sync - roles.js is the readable source of truth that the rules mirror.

export const ROLES = Object.freeze({
  SUPER_ADMIN:        "super_admin",        // Swati Softtech Solution staff
  OWNER:              "owner",              // Laboratory owner
  ADMIN:              "admin",              // Laboratory administrator
  RECEPTIONIST:       "receptionist",
  TECHNICIAN:         "technician",
  PATHOLOGIST:        "pathologist",
  COLLECTION_EXEC:    "collection_executive",
  ACCOUNTANT:         "accountant",
  PATIENT:            "patient"
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.SUPER_ADMIN]:     "Super Admin (Swati Softtech)",
  [ROLES.OWNER]:           "Laboratory Owner",
  [ROLES.ADMIN]:           "Admin",
  [ROLES.RECEPTIONIST]:    "Receptionist",
  [ROLES.TECHNICIAN]:      "Lab Technician",
  [ROLES.PATHOLOGIST]:     "Pathologist",
  [ROLES.COLLECTION_EXEC]: "Collection Executive",
  [ROLES.ACCOUNTANT]:      "Accountant",
  [ROLES.PATIENT]:         "Patient"
});

export const PERMISSIONS = Object.freeze({
  PATIENT_VIEW: "patient.view",
  PATIENT_EDIT: "patient.edit",
  PATIENT_DELETE: "patient.delete",
  BOOKING_VIEW: "booking.view",
  BOOKING_CREATE: "booking.create",
  BOOKING_EDIT: "booking.edit",
  BOOKING_DELETE: "booking.delete",
  REPORT_VIEW: "report.view",
  REPORT_ENTER: "report.enter",
  REPORT_APPROVE: "report.approve",
  REPORT_DELETE: "report.delete",
  REPORT_SHARE: "report.share",
  PAYMENT_VIEW: "payment.view",
  PAYMENT_RECEIVE: "payment.receive",
  PAYMENT_EDIT: "payment.edit",
  TEST_VIEW: "test.view",
  TEST_EDIT: "test.edit",
  HOMECOLLECTION_VIEW: "homecollection.view",
  HOMECOLLECTION_ASSIGN: "homecollection.assign",
  HOMECOLLECTION_UPDATE: "homecollection.update",
  STAFF_VIEW: "staff.view",
  STAFF_MANAGE: "staff.manage",
  FINANCE_VIEW: "finance.view",
  FINANCE_EXPORT: "finance.export",
  EXPENSE_MANAGE: "expense.manage",
  ANALYTICS_VIEW: "analytics.view",
  SETTINGS_VIEW: "settings.view",
  SETTINGS_EDIT: "settings.edit",
  BRANDING_EDIT: "branding.edit",
  BRANCH_MANAGE: "branch.manage",
  AUDIT_VIEW: "audit.view"
});

const P = PERMISSIONS;
const ALL = Object.values(P);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.OWNER]: ALL,
  [ROLES.ADMIN]: ALL.filter((p) => p !== P.BRANCH_MANAGE),

  [ROLES.RECEPTIONIST]: [
    P.PATIENT_VIEW, P.PATIENT_EDIT,
    P.BOOKING_VIEW, P.BOOKING_CREATE, P.BOOKING_EDIT,
    P.REPORT_VIEW,
    P.PAYMENT_VIEW, P.PAYMENT_RECEIVE,
    P.TEST_VIEW,
    P.HOMECOLLECTION_VIEW
  ],

  [ROLES.TECHNICIAN]: [
    P.PATIENT_VIEW,
    P.BOOKING_VIEW,
    P.REPORT_VIEW, P.REPORT_ENTER,
    P.TEST_VIEW,
    P.HOMECOLLECTION_VIEW, P.HOMECOLLECTION_UPDATE
  ],

  [ROLES.PATHOLOGIST]: [
    P.PATIENT_VIEW,
    P.BOOKING_VIEW,
    P.REPORT_VIEW, P.REPORT_ENTER, P.REPORT_APPROVE, P.REPORT_SHARE,
    P.TEST_VIEW, P.TEST_EDIT,
    P.ANALYTICS_VIEW
  ],

  [ROLES.COLLECTION_EXEC]: [
    P.PATIENT_VIEW,
    P.BOOKING_VIEW,
    P.HOMECOLLECTION_VIEW, P.HOMECOLLECTION_UPDATE,
    P.PAYMENT_RECEIVE
  ],

  [ROLES.ACCOUNTANT]: [
    P.PATIENT_VIEW,
    P.BOOKING_VIEW,
    P.PAYMENT_VIEW, P.PAYMENT_RECEIVE, P.PAYMENT_EDIT,
    P.FINANCE_VIEW, P.FINANCE_EXPORT,
    P.EXPENSE_MANAGE,
    P.ANALYTICS_VIEW
  ],

  [ROLES.PATIENT]: []
});

/** Roles that may sign in to the laboratory admin panel. */
export const STAFF_ROLES = Object.freeze([
  ROLES.OWNER, ROLES.ADMIN, ROLES.RECEPTIONIST, ROLES.TECHNICIAN,
  ROLES.PATHOLOGIST, ROLES.COLLECTION_EXEC, ROLES.ACCOUNTANT
]);

export function isStaffRole(role) {
  return STAFF_ROLES.includes(String(role || "").trim());
}

export function permissionsFor(role) {
  return ROLE_PERMISSIONS[String(role || "").trim()] || [];
}

export function can(role, permission) {
  if (role === ROLES.SUPER_ADMIN) return true;
  return permissionsFor(role).includes(permission);
}

export function roleLabel(role) {
  return ROLE_LABELS[String(role || "").trim()] || "Unknown Role";
}
