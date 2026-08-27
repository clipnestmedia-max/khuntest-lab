// Report entry, approval and result flagging.
//
// A report stores one row per parameter, each carrying the reference range
// that was in force when the result was entered. Reprinting a two-year-old
// report must reproduce exactly what the patient was originally handed, even
// if the laboratory has since revised its ranges.
import {
  getDocs, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, onSnapshot,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef, withLabId } from "../tenant.js";
import { getTest } from "./tests.js";
import { rangeForPatient, flagResult } from "../flags.js";
import { getBooking } from "./bookings.js";
import { clean, toNumber, buildSearchTokens, dateKey, sortByDateDesc, sortByBestTime, pick } from "./helpers.js";
import { logAudit, AUDIT } from "../audit.js";

export const REPORT_STATUS = Object.freeze({
  DRAFT: "Draft",
  PENDING_APPROVAL: "Pending Approval",
  FINAL: "Final",
  AMENDED: "Amended"
});

// Reference-range parsing and abnormal-value flagging live in core/flags.js,
// which has no Firebase dependency so the logic can be unit-tested and
// previewed on its own.
//
// These are IMPORTED and then re-exported, not forwarded with a bare
// `export ... from`: that forwards the name to importers without binding it
// here, so applyFlags() calling flagResult() threw "flagResult is not defined"
// at runtime while the module still exported it perfectly.
import { FLAGS, parseRange, isAbnormal, isCritical } from "../flags.js";
export { FLAGS, parseRange, flagResult, isAbnormal, isCritical };

/**
 * Build the blank result grid for a booking: one group per booked test, one
 * row per parameter. This is what powers the card-based report entry screen
 * ("CBC [Open Parameters]") the spec asks for in section 9 - a design the
 * KhunTest admin panel already proved out and which is carried over here.
 */
export async function buildResultGrid(booking) {
  const groups = [];
  for (const bookedTest of booking.tests || []) {
    const test = await getTest(bookedTest.testId || bookedTest.testCode).catch(() => null);
    const parameters = test?.parameters?.length
      ? test.parameters
      : [{ parameterId: "P1", name: bookedTest.name, unit: "", normalRange: "", sortOrder: 1 }];

    groups.push({
      testId: bookedTest.testId || bookedTest.testCode || bookedTest.name,
      testCode: bookedTest.testCode || test?.testCode || "",
      testName: bookedTest.name || test?.name || "",
      category: test?.category || bookedTest.category || "",
      sample: test?.sample || bookedTest.sample || "",
      method: test?.method || "",
      notes: test?.notes || "",
      rows: parameters
        .slice()
        .sort((a, b) => toNumber(a.sortOrder) - toNumber(b.sortOrder))
        .map((p) => ({
          parameterId: p.parameterId,
          code: p.code || "",
          name: p.name,
          unit: p.unit || "",
          // Frozen at entry time so a later catalogue edit cannot rewrite history.
          referenceRange: rangeForPatient(p, { gender: booking.gender, age: booking.age }),
          rangeMale: p.rangeMale || "",
          rangeFemale: p.rangeFemale || "",
          rangeChild: p.rangeChild || "",
          lowValue: p.lowValue ?? null,
          highValue: p.highValue ?? null,
          criticalLow: p.criticalLow ?? null,
          criticalHigh: p.criticalHigh ?? null,
          method: p.method || "",
          isHeading: p.isHeading === true,
          value: "",
          flag: ""
        }))
    });
  }
  return groups;
}

/**
 * Merge saved values back onto a freshly built grid (re-opening a draft).
 *
 * The saved `value` and `flag` are carried, and so is the calculation
 * metadata — `origin` above all. Without it a value this engine computed last
 * time reloads as an anonymous string, the engine reads it as a measurement
 * (`collectValues` defaults a missing origin to MEASURED) and then REFUSES to
 * recompute it, because "a measured value is never overwritten". The result is
 * a stale calculated number that never refreshes and loses its "Calculated"
 * marker. Carrying `origin` lets the engine recognise its own output and
 * recalculate it on every open; a genuine manual override (MANUALLY_VERIFIED)
 * is likewise recognised and left alone.
 *
 * Rows are matched by parameterId first, then by a normalised name, so a
 * catalogue that has since renumbered its parameterIds does not silently drop
 * every previously entered value.
 */
export function mergeSavedResults(groups, savedGroups = []) {
  const byId = new Map();
  const byName = new Map();
  const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  savedGroups.forEach((g) => {
    (g.rows || []).forEach((r) => {
      byId.set(`${g.testId}::${r.parameterId}`, r);
      if (r.name) byName.set(`${g.testId}::${nameKey(r.name)}`, r);
    });
  });
  const carry = ["origin", "calculated", "ruleId", "ruleVersion", "formulaText",
    "calculationNote", "validationStatus", "overrideReason", "overriddenBy"];
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      const hit = byId.get(`${g.testId}::${r.parameterId}`)
        || byName.get(`${g.testId}::${nameKey(r.name)}`);
      if (!hit) return r;
      const merged = { ...r, value: hit.value ?? "", flag: hit.flag ?? "", note: hit.note ?? "" };
      carry.forEach((k) => { if (hit[k] !== undefined) merged[k] = hit[k]; });
      return merged;
    })
  }));
}

/** Re-flag every row against the patient it belongs to. */
/**
 * Flag every row that has not already been flagged by the medical engine.
 *
 * A row carrying `flagCode` was decided by the engine, against the interval
 * this laboratory actually reports that parameter with - which may be its own
 * verified interval rather than the catalogue's inherited one. Re-flagging it
 * here would quietly overwrite that with a different answer, and the saved
 * report would then disagree with the screen the technician approved it on.
 * One report, one decision.
 */
export function applyFlags(groups, patient = {}) {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      if (r.isHeading || r.flagCode) return r;
      return { ...r, flag: flagResult(r.value, r, patient) };
    })
  }));
}

/** A row the technician fills in by hand (not one the engine computes). */
function isCalculatedRow(r) {
  return r.calculated === true || r.origin === "CALCULATED";
}

/**
 * KhunTest compatibility layer.
 *
 * report.html (the patient-facing page) and the KhunTest patient portal read a
 * report as a FLAT `results[]` array with a top-level `status` string. This
 * app's admin panel entry screen is swatisofttechsolution's, which stores
 * `groups[]` with `rows[]`. This deployment keeps report.html untouched, so
 * every report we save carries BOTH shapes: `groups` for re-opening in the
 * entry screen, `results` + `status` for rendering to the patient.
 */
export function flatResultsFromGroups(groups = []) {
  const out = [];
  groups.forEach((g) => {
    (g.rows || []).forEach((r) => {
      out.push({
        category: g.category || "",
        testName: g.testName || "",
        parameterName: r.name || "",
        parameterId: r.parameterId || "",
        code: r.code || "",
        resultValue: r.value ?? "",
        normalRange: r.referenceRange || r.normalRange || "",
        unit: r.unit || "",
        method: r.method || "",
        sample: g.sample || "",
        comment: r.note || r.comment || "",
        flag: r.flag || "",
        isHeading: r.isHeading === true,
        calculated: isCalculatedRow(r)
      });
    });
  });
  return out;
}

/** The status string report.html and the patient portal filter on. */
export function khuntestStatus(reportStatus) {
  return reportStatus === REPORT_STATUS.FINAL || reportStatus === REPORT_STATUS.AMENDED
    ? "Final" : "Draft";
}
const hasValue = (r) => String(r.value ?? "").trim() !== "";

/**
 * Progress across the whole grid.
 *
 * §31: a calculated parameter is NOT a field the technician enters, so it does
 * not sit in the "still to type" denominator. It is reported separately:
 * `measured*` is what the person must enter, `calculated*` is what the engine
 * produced. `complete` means every measured field is in AND every calculated
 * field that can resolve has resolved. `entered`/`total` stay populated for
 * callers that only want a single ratio, and count a resolved calculation as
 * done.
 */
export function gridProgress(groups) {
  let measuredEntered = 0, measuredTotal = 0, calculatedTotal = 0, calculatedOk = 0;
  groups.forEach((g) => g.rows.forEach((r) => {
    if (r.isHeading) return;
    if (isCalculatedRow(r)) {
      calculatedTotal += 1;
      if (hasValue(r)) calculatedOk += 1;
    } else {
      measuredTotal += 1;
      if (hasValue(r)) measuredEntered += 1;
    }
  }));
  const total = measuredTotal + calculatedTotal;
  const entered = measuredEntered + calculatedOk;
  return {
    entered, total,
    measuredEntered, measuredTotal,
    calculatedTotal, calculatedOk,
    complete: measuredTotal > 0 && measuredEntered === measuredTotal && calculatedOk === calculatedTotal
  };
}

export function groupProgress(group) {
  const rows = group.rows.filter((r) => !r.isHeading);
  const measured = rows.filter((r) => !isCalculatedRow(r));
  const calculated = rows.filter(isCalculatedRow);
  const measuredEntered = measured.filter(hasValue).length;
  const calculatedOk = calculated.filter(hasValue).length;
  const entered = measuredEntered + calculatedOk;
  const total = rows.length;
  return {
    entered, total,
    measuredEntered, measuredTotal: measured.length,
    calculatedTotal: calculated.length, calculatedOk,
    label: measuredEntered === 0 ? "Not Started"
      : (measuredEntered >= measured.length && calculatedOk >= calculated.length) ? "Completed"
      : "In Progress"
  };
}

// --- legacy KhunTest report compatibility ---------------------------------
//
// Pre-port reports were stored as a flat `results[]` array (no `groups[]`) with
// a lowercase `status`/`reportStatus` like "released"/"final". Rebuild the
// group/row structure the entry screen and templates expect so old reports
// open with their values intact.
const legacyNameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

function legacyStatus(data) {
  const raw = String(pick(data, ["reportStatus", "status", "report_status"], "")).toLowerCase();
  if (["released", "release", "final", "completed", "complete", "approved", "done"].includes(raw)) {
    return REPORT_STATUS.FINAL;
  }
  if (raw === "amended") return REPORT_STATUS.AMENDED;
  if (data.reportReleased === true || data.released === true) return REPORT_STATUS.FINAL;
  return REPORT_STATUS.DRAFT;
}

function groupsFromLegacy(data) {
  const rows = pick(data, ["results", "reportResults", "reportItems", "resultRows"], null);
  if (!Array.isArray(rows) || !rows.length) return [];
  const byTest = new Map();
  rows.forEach((r, i) => {
    const testName = pick(r, ["testName", "test_name", "test", "groupName", "group"], "")
      || pick(r, ["category", "department", "section"], "") || "Result";
    const key = legacyNameKey(testName);
    if (!byTest.has(key)) {
      byTest.set(key, {
        testId: testName, testCode: r.testCode || r.code || "",
        testName, category: pick(r, ["category", "department", "section"], ""),
        sample: pick(r, ["sample", "sampleType", "sample_type"], ""),
        method: pick(r, ["method", "methodName"], ""), notes: "", rows: []
      });
    }
    const name = pick(r, ["parameterName", "parameter_name", "parameter", "name"], testName);
    byTest.get(key).rows.push({
      parameterId: r.parameterId || legacyNameKey(name) || `P${i + 1}`,
      code: r.code || r.parameterCode || "",
      name,
      unit: pick(r, ["unit", "units"], ""),
      referenceRange: pick(r, ["normalRange", "normalValue", "normal_value", "referenceRange", "reference_range", "range", "normal"], ""),
      rangeMale: "", rangeFemale: "", rangeChild: "",
      method: pick(r, ["method", "methodName"], ""),
      isHeading: Boolean(r.isHeading || r.heading || r.type === "heading"),
      value: String(pick(r, ["value", "resultValue", "result", "finding"], "")),
      flag: pick(r, ["flag", "abnormalFlag", "abnormal_flag", "resultFlag"], ""),
      note: pick(r, ["comment", "remarks", "note"], "")
    });
  });
  return Array.from(byTest.values());
}
// -----------------------------------------------------------------------------

export function normalizeReport(id, data = {}) {
  const groups = Array.isArray(data.groups) && data.groups.length
    ? data.groups
    : groupsFromLegacy(data);
  return {
    id,
    reportId: data.reportId || id,
    bookingId: data.bookingId || data.billNo || id,
    billNo: pick(data, ["billNo", "bill_no", "customerBillNo", "bookingId"], id),
    patientId: data.patientId || "",
    patientUid: pick(data, ["patientUid", "authUid", "userId", "uid"], ""),
    patientName: pick(data, ["patientName", "patient_name", "name"], ""),
    phone: pick(data, ["phone", "whatsapp", "contactNo", "mobile"], ""),
    age: pick(data, ["age", "patientAge"], ""),
    gender: data.gender || "",
    refBy: pick(data, ["refBy", "referringDoctor", "doctor", "refDoctor"], ""),
    branchId: data.branchId || "",
    collectionDate: pick(data, ["collectionDate", "collDate", "sampleDate"], ""),
    registeredDate: data.registeredDate || data.createdAt || "",
    reportingDate: pick(data, ["reportingDate", "reportDate", "releasedAt"], ""),
    sampleType: data.sampleType || "",
    groups,
    reportStatus: data.reportStatus && Object.values(REPORT_STATUS).includes(data.reportStatus)
      ? data.reportStatus
      : legacyStatus(data),
    templateId: data.templateId || "",
    enteredByUid: data.enteredByUid || "",
    enteredByName: data.enteredByName || "",
    approvedByUid: data.approvedByUid || "",
    approvedByName: data.approvedByName || "",
    approvedAt: data.approvedAt || null,
    interpretation: data.interpretation || "",
    interpretationRecord: data.interpretationRecord || null,
    medicalNotices: Array.isArray(data.medicalNotices) ? data.medicalNotices : [],
    // The report's own secure verification link (`/report.html?t=<token>`),
    // persisted so the printed QR resolves from EVERY render path - the admin
    // preview, a reopened report, the patient portal - not only the WhatsApp
    // viewer that injects it from the address bar. Written once, at approval;
    // the same token is reused on every later print (see report-share.js).
    verifyUrl: data.verifyUrl || "",
    createdAt: data.createdAt || null,
    updatedAt: data.updatedAt || null,
    labId: data.labId || ""
  };
}

/** Save (or re-save) a report as a draft. Never changes approval state. */
export async function saveReportDraft(input, { actor = {} } = {}) {
  const reportId = input.reportId || input.bookingId;
  if (!reportId) throw new Error("A report needs a booking.");
  const booking = input.booking || await getBooking(input.bookingId);
  const groups = applyFlags(input.groups || [], { gender: booking?.gender, age: booking?.age });

  const payload = withLabId(clean({
    reportId,
    bookingId: input.bookingId || reportId,
    billNo: booking?.billNo || input.bookingId || reportId,
    patientId: booking?.patientId || input.patientId || "",
    patientUid: booking?.patientUid || input.patientUid || "",
    patientName: booking?.patientName || input.patientName || "",
    phone: booking?.phone || input.phone || "",
    age: booking?.age || input.age || "",
    gender: booking?.gender || input.gender || "",
    refBy: booking?.refBy || input.refBy || "",
    branchId: booking?.branchId || "",
    collectionDate: input.collectionDate || booking?.scheduledAt || dateKey(),
    // When the booking was taken - printed as "Registered Date" on the report.
    registeredDate: input.registeredDate || booking?.createdAt || null,
    reportingDate: input.reportingDate || dateKey(),
    sampleType: input.sampleType || "",
    groups,
    // The printed comment. It is whatever the pathologist approved, and an
    // empty string until then - so an unapproved draft cannot reach a report
    // by any path, including a reissue or a shared link.
    interpretation: input.interpretation || "",
    // The full record behind that comment: the software's original draft, the
    // pathologist's edit, who approved it and when.
    interpretationRecord: input.interpretationRecord || null,
    // Printed on the report. A report resting on formulae or intervals this
    // laboratory has not verified says so on its face, not only in a settings
    // screen nobody reading the report can see.
    medicalNotices: Array.isArray(input.medicalNotices) ? input.medicalNotices : [],
    // Keep a verification link that a previous approval already minted, so a
    // re-save or a revert→re-approve cycle does not lose the report's QR.
    // Only written when present, so a merge never clears it.
    ...(input.verifyUrl ? { verifyUrl: input.verifyUrl } : {}),
    templateId: input.templateId || "",
    reportStatus: REPORT_STATUS.DRAFT,
    // KhunTest report.html / patient portal compatibility (see flatResultsFromGroups).
    results: flatResultsFromGroups(groups),
    status: khuntestStatus(REPORT_STATUS.DRAFT),
    whatsapp: booking?.whatsapp || booking?.phone || input.phone || "",
    enteredByUid: actor.uid || "",
    enteredByName: actor.name || "",
    dayKey: dateKey(),
    searchTokens: buildSearchTokens(booking?.patientName, booking?.phone, reportId, booking?.billNo),
    updatedAt: serverTimestamp(),
    createdAt: input.createdAt || serverTimestamp()
  }));

  await setDoc(docRef("reports", reportId), payload, { merge: true });
  logAudit(AUDIT.RESULT_ENTERED, {
    entityType: "report", entityId: reportId,
    summary: `Draft saved for ${payload.patientName} (${gridProgress(groups).entered} values)`
  });
  return normalizeReport(reportId, payload);
}

/**
 * Approve and release. Only a pathologist/owner/admin reaches this (enforced
 * by both roles.js and firestore.rules), and it is what makes the report
 * visible to the patient and shareable on WhatsApp.
 */
export async function approveReport(reportId, { actor = {}, signatory = null } = {}) {
  const before = await getReport(reportId);
  if (!before) throw new Error("Report not found.");
  const progress = gridProgress(before.groups);
  if (progress.total > 0 && progress.entered === 0) {
    throw new Error("Cannot approve a report with no results entered.");
  }

  await updateDoc(docRef("reports", reportId), {
    reportStatus: REPORT_STATUS.FINAL,
    // KhunTest report.html renders only when status === "Final"; refresh the
    // flat results too so the released copy matches what was approved.
    status: khuntestStatus(REPORT_STATUS.FINAL),
    results: flatResultsFromGroups(before.groups),
    approvedByUid: actor.uid || "",
    approvedByName: actor.name || "",
    approvedAt: serverTimestamp(),
    signatory: signatory || null,
    reportingDate: dateKey(),
    updatedAt: serverTimestamp()
  });
  await updateDoc(docRef("bookings", before.bookingId), {
    bookingStatus: "Report Ready", status: "Report Ready", updatedAt: serverTimestamp()
  }).catch(() => {});

  logAudit(AUDIT.REPORT_APPROVED, {
    entityType: "report", entityId: reportId,
    summary: `Approved and released for ${before.patientName}`
  });
  return { ...before, reportStatus: REPORT_STATUS.FINAL };
}

/**
 * Persist the report's secure verification link so the printed QR resolves
 * from every render path, not only the one that has it in memory.
 *
 * The URL carries the unguessable share token. It is written onto the report
 * document, which is already readable only by this laboratory's staff and the
 * patient the report belongs to (tenant path isolation + the patientUid rule),
 * i.e. exactly the people entitled to the link. It is NOT written anywhere a
 * different laboratory or a different patient could reach. Idempotent: called
 * with the same reused token on every later print.
 */
export async function saveReportVerifyUrl(reportId, verifyUrl) {
  const url = String(verifyUrl || "").trim();
  if (!reportId || !url) return;
  await updateDoc(docRef("reports", reportId), { verifyUrl: url, updatedAt: serverTimestamp() });
}

/** Pull a released report back to draft (correction workflow). Always audited. */
export async function revertReport(reportId, reason, { actor = {} } = {}) {
  const before = await getReport(reportId);
  await updateDoc(docRef("reports", reportId), {
    reportStatus: REPORT_STATUS.DRAFT,
    status: khuntestStatus(REPORT_STATUS.DRAFT),
    revertReason: String(reason || "").trim(),
    revertedByName: actor.name || "",
    updatedAt: serverTimestamp()
  });
  logAudit(AUDIT.REPORT_REVERTED, {
    entityType: "report", entityId: reportId,
    summary: `Reverted to draft: ${reason || "no reason given"}`,
    before: { reportStatus: before?.reportStatus }
  });
}

export async function getReport(reportId) {
  const snap = await getDoc(docRef("reports", reportId));
  return snap.exists() ? normalizeReport(snap.id, snap.data()) : null;
}

export async function getReportByBooking(bookingId) {
  const direct = await getReport(bookingId);
  if (direct) return direct;
  for (const field of ["bookingId", "billNo", "customerBillNo"]) {
    const snap = await getDocs(query(col("reports"), where(field, "==", bookingId), limit(1))).catch(() => null);
    if (snap && !snap.empty) return normalizeReport(snap.docs[0].id, snap.docs[0].data());
  }
  return null;
}

// No orderBy: a legacy report written without `createdAt` would be dropped from
// the result set entirely. Read the collection and sort client-side instead.
export async function listReports({ status = "", max = 300 } = {}) {
  const snap = await getDocs(query(col("reports"), limit(Math.max(max * 4, 1000))));
  let rows = snap.docs.map((d) => normalizeReport(d.id, d.data()));
  if (status) rows = rows.filter((r) => r.reportStatus === status);
  return sortByBestTime(rows).slice(0, max);
}

export async function listPatientReports(patientUid, { max = 100 } = {}) {
  if (!patientUid) return [];
  const snap = await getDocs(query(col("reports"), where("patientUid", "==", patientUid), limit(500))).catch(() => null);
  const rows = (snap ? snap.docs.map((d) => normalizeReport(d.id, d.data())) : [])
    .filter((r) => r.reportStatus === REPORT_STATUS.FINAL || r.reportStatus === REPORT_STATUS.AMENDED);
  return sortByBestTime(rows).slice(0, max);
}

export async function searchReports(text, { max = 50 } = {}) {
  const term = String(text || "").trim().toLowerCase();
  if (!term) return listReports({ max });
  // Token query first (fast when present); fall back to a client-side scan so
  // legacy reports with no searchTokens are still found.
  let rows = [];
  const tokenSnap = await getDocs(query(col("reports"), where("searchTokens", "array-contains", term), limit(max))).catch(() => null);
  if (tokenSnap && !tokenSnap.empty) {
    rows = tokenSnap.docs.map((d) => normalizeReport(d.id, d.data()));
  } else {
    const all = await listReports({ max: 2000 });
    rows = all.filter((r) => [r.billNo, r.patientName, r.phone, r.bookingId]
      .some((v) => String(v || "").toLowerCase().includes(term)));
  }
  return sortByBestTime(rows).slice(0, max);
}

export function listenReports(callback, onError) {
  return onSnapshot(
    query(col("reports"), limit(1000)),
    (snap) => callback(sortByBestTime(snap.docs.map((d) => normalizeReport(d.id, d.data())))),
    onError
  );
}

export async function deleteReport(reportId) {
  await deleteDoc(docRef("reports", reportId));
  logAudit(AUDIT.REPORT_SAVED, { entityType: "report", entityId: reportId, summary: "Report deleted" });
}
