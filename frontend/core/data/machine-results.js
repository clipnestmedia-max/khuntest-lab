// Analyser results inbox.
//
// The KhunTest desktop listener and the LIS/HL7 bridge parse an analyser's
// output and write one document per sample to the flat /machineResults
// collection. Nothing here is a report yet: a technician attaches the result
// to its booking and opens it in Report Entry, where every value is verified
// before release. firestore.rules already gates /machineResults to isAdmin().
import {
  getDocs, updateDoc, query, orderBy, limit, onSnapshot, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { col, docRef } from "../tenant.js";
import { logAudit } from "../audit.js";

/** One analyser document, with the fields the screen relies on always present. */
export function normalizeMachineResult(id, data = {}) {
  const parsed = Array.isArray(data.parsedResults) ? data.parsedResults
    : Array.isArray(data.results) ? data.results : [];
  return {
    id,
    sampleId: data.sampleId || data.sampleID || data.barcode || "",
    billNo: data.billNo || data.billNumber || "",
    bookingId: data.bookingId || "",
    patientName: data.patientName || data.patient || "",
    source: data.source || data.analyser || data.instrument || "Analyser",
    status: data.status || (data.bookingId ? "matched" : "unmatched"),
    receivedAt: data.receivedAt || data.createdAt || null,
    parsedResults: parsed.map((r) => ({
      code: r.code || r.testCode || "",
      name: r.name || r.parameter || r.label || "",
      value: r.value ?? r.result ?? r.resultValue ?? r.finding ?? "",
      unit: r.unit || "",
      normalRange: r.normalRange || r.referenceRange || r.range || "",
      abnormalFlag: r.abnormalFlag || r.flag || ""
    })),
    raw: data
  };
}

/** Newest analyser documents first. */
export async function listMachineResults({ max = 300 } = {}) {
  let snap;
  try {
    snap = await getDocs(query(col("machineResults"), orderBy("receivedAt", "desc"), limit(max)));
  } catch {
    snap = await getDocs(query(col("machineResults"), limit(max)));
  }
  return snap.docs.map((d) => normalizeMachineResult(d.id, d.data() || {}));
}

/** Live subscription used by the screen while the tab is open. */
export function listenMachineResults(callback, onError) {
  return onSnapshot(
    query(col("machineResults"), orderBy("receivedAt", "desc"), limit(300)),
    (snap) => callback(snap.docs.map((d) => normalizeMachineResult(d.id, d.data() || {}))),
    (err) => { if (onError) onError(err); }
  );
}

/** Point an analyser document at the booking a technician identified. */
export async function attachToBooking(id, { bookingId, billNo }) {
  await updateDoc(docRef("machineResults", id), {
    bookingId: bookingId || "",
    billNo: billNo || "",
    status: "matched",
    updatedAt: serverTimestamp()
  });
  await logAudit("machineresult.attached", {
    entityType: "machineResult", entityId: id,
    summary: `Analyser result ${id} attached to booking ${billNo || bookingId}`
  });
}

/** Record where the technician took the result next (e.g. draft-created). */
export async function setMachineResultStatus(id, status, patch = {}) {
  await updateDoc(docRef("machineResults", id), { status, ...patch, updatedAt: serverTimestamp() });
}
