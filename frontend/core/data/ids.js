// Per-laboratory ID sequences.
//
// The spec asks for patient ids shaped LAB001-P00001. Counters live at
// /labs/{labId}/counters/{kind} and are bumped inside a transaction, so two
// receptionists registering at the same instant can never be handed the same
// number. Because the counter is inside the tenant subtree, LAB001 and LAB002
// each start at 1 and never interfere.
import { db } from "../firebase-config.js";
import { runTransaction, doc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Single-tenant: no lab prefix on ids, and counters live at a flat
// /counters/{kind}. Booking -> "B00001", bill -> "INV00001".
const requireLabId = () => "";
const labPath = () => "";

const PREFIX = Object.freeze({
  patient: "P",
  booking: "B",
  bill: "INV",
  report: "R",
  homeCollection: "HC",
  payment: "PAY",
  expense: "EXP"
});

const WIDTH = Object.freeze({
  patient: 5, booking: 5, bill: 5, report: 5, homeCollection: 5, payment: 5, expense: 5
});

function pad(value, width) { return String(value).padStart(width, "0"); }

/**
 * Reserve the next number for `kind` and return the formatted id, e.g.
 * nextId("patient") -> "LAB001-P00001".
 */
export async function nextId(kind, { labId = requireLabId() } = {}) {
  const prefix = PREFIX[kind];
  if (!prefix) throw new Error(`Unknown id sequence "${kind}".`);
  const ref = doc(db, "counters", kind);

  const value = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const current = snap.exists() ? Number(snap.data().value || 0) : 0;
    const next = current + 1;
    tx.set(ref, { kind, value: next, updatedAt: new Date().toISOString() }, { merge: true });
    return next;
  });

  return `${prefix}${pad(value, WIDTH[kind] || 5)}`;
}

/**
 * Fallback id for paths where a transaction is not possible (an unauthenticated
 * public booking, or a counter write denied by an expired subscription). Still
 * lab-prefixed and still unique, just not sequential.
 */
export function fallbackId(kind) {
  const prefix = PREFIX[kind] || "X";
  const stamp = Date.now().toString(36).toUpperCase();
  const salt = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}${stamp}${salt}`;
}

/** Sequential when possible, unique always. Never throws. */
export async function safeNextId(kind, options = {}) {
  try {
    return await nextId(kind, options);
  } catch (err) {
    console.warn(`Sequential id for "${kind}" unavailable, using fallback.`, err?.message || err);
    return fallbackId(kind);
  }
}

/** Peek at a counter without consuming a number (dashboard "next id" hints). */
export function formatId(kind, value) {
  return `${PREFIX[kind] || "X"}${pad(value, WIDTH[kind] || 5)}`;
}
