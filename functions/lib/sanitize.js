// Only fields report.html actually needs to render a report are returned to
// the public shared-report endpoint. Internal IDs, auth identifiers and
// private contact data are deliberately left out - see functions/README.md.
const REPORT_FIELDS = [
  "billNo",
  "patientName",
  "age",
  "gender",
  "refBy",
  "doctor",
  "collectionDate",
  "registeredDate",
  "reportingDate",
  "reportStatus",
  "status",
  "tests",
  "selectedTests",
  "reportItems",
  "results",
  "reportResults",
  "esrFirstHour",
  "esrSecondHour"
];

const DATE_FIELDS = ["collectionDate", "registeredDate", "reportingDate", "releasedAt", "createdAt"];

function toIsoOrValue(value) {
  if (value && typeof value.toDate === "function") return value.toDate().toISOString();
  return value ?? "";
}

function sanitizeReport(report) {
  if (!report) return null;
  const sanitized = {};
  REPORT_FIELDS.forEach((field) => {
    if (report[field] !== undefined) sanitized[field] = report[field];
  });
  DATE_FIELDS.forEach((field) => {
    if (sanitized[field] !== undefined) sanitized[field] = toIsoOrValue(sanitized[field]);
  });
  // releasedAt/createdAt aren't in REPORT_FIELDS but report.html reads them as
  // fallbacks for registeredDate/reportedDate - include them read-only.
  if (report.releasedAt !== undefined) sanitized.releasedAt = toIsoOrValue(report.releasedAt);
  if (report.createdAt !== undefined) sanitized.createdAt = toIsoOrValue(report.createdAt);
  return sanitized;
}

module.exports = { sanitizeReport, REPORT_FIELDS };
