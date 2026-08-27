// Admin → Machine Results.
//
// The inbox for a laboratory analyser. The KhunTest on-premise listener writes
// one document per sample; this screen is where a technician matches it to a
// booking and moves it into Report Entry, where the values are verified before
// anything is released.
import { sessionCanWrite } from "../core/session.js";
import { PERMISSIONS as P } from "../core/roles.js";
import * as MachineResults from "../core/data/machine-results.js";
import * as Bookings from "../core/data/bookings.js";
import { formatDateTime } from "../core/data/helpers.js";
import {
  $, esc, toastOk, toastError, reportError, renderRows, openModal, debounce, pill
} from "../core/ui.js";

let ctx = { session: null, branding: null };
let rows = [];
let unsub = null;
let filterText = "";
let releaseMeta = null;
let releaseLoaded = false;

export function initMachineResultsScreen(context) {
  ctx = context;
  const search = $("#machineResultSearch");
  if (search) {
    search.addEventListener("input", debounce(() => {
      filterText = search.value.trim().toLowerCase();
      paint();
    }, 200));
  }

  const panel = $('[data-panel="machineResults"]');
  if (panel) {
    panel.addEventListener("click", (event) => {
      const view = event.target.closest("[data-mr-view]");
      if (view) return openResult(view.dataset.mrView);
      const attach = event.target.closest("[data-mr-attach]");
      if (attach) return attachResult(attach.dataset.mrAttach);
    });
  }
}

/** Called by admin.js when the Machine Results tab is opened. */
export async function renderMachineResults() {
  try {
    if (!unsub) {
      unsub = MachineResults.listenMachineResults(
        (next) => { rows = next; paint(); updateBadge(); },
        (err) => reportError(err, "Lost the live connection to machine results.")
      );
    }
    rows = await MachineResults.listMachineResults({ max: 300 });
    paint();
    updateBadge();
    loadListenerRelease();
  } catch (error) {
    reportError(error, "Could not load machine results.");
  }
}

function visibleRows() {
  if (!filterText) return rows;
  return rows.filter((r) =>
    [r.sampleId, r.billNo, r.patientName, r.status, r.source]
      .some((v) => String(v || "").toLowerCase().includes(filterText)));
}

function paint() {
  renderRows("machineResultsBody", visibleRows(), (r) => {
    const matched = Boolean(r.bookingId) || r.status === "matched" || r.status === "draft-created";
    return `<tr>
      <td class="small nowrap">${esc(formatDateTime(r.receivedAt))}</td>
      <td><b>${esc(r.sampleId || "—")}</b><br><span class="small muted">${esc(r.source)}</span></td>
      <td class="mono">${esc(r.billNo || "—")}</td>
      <td>${esc(r.patientName || "—")}</td>
      <td>${matched ? pill(r.status || "matched", "ok") : pill("unmatched", "warn")}</td>
      <td class="actions">
        <button class="btn btn-sm btn-outline" data-mr-view="${esc(r.id)}" type="button">View</button>
        ${sessionCanWrite(P.REPORT_ENTER, ctx.session)
          ? `<button class="btn btn-sm btn-ghost" data-mr-attach="${esc(r.id)}" type="button">Attach</button>`
          : ""}
        ${r.bookingId
          ? `<button class="btn btn-sm btn-green" data-open-report="${esc(r.bookingId)}" type="button">Report Entry</button>`
          : ""}
      </td>
    </tr>`;
  }, { colspan: 6, empty: "No machine results yet. They appear here as the analyser sends them." });
}

function updateBadge() {
  const badge = $("#mrBadge");
  if (!badge) return;
  const pending = rows.filter((r) => !r.bookingId && r.status !== "draft-created").length;
  badge.textContent = pending;
  badge.classList.toggle("hidden", pending === 0);
}

function rowById(id) { return rows.find((r) => r.id === id); }

function openResult(id) {
  const row = rowById(id);
  if (!row) return toastError("Machine result not found.");
  const body = `
    <p class="notice warn">Imported as draft. Every value is verified in Report Entry before release.</p>
    <div class="table-wrap"><table class="data">
      <thead><tr><th>Code</th><th>Parameter</th><th>Value</th><th>Unit</th><th>Reference</th><th>Flag</th></tr></thead>
      <tbody>${row.parsedResults.length
        ? row.parsedResults.map((r) => `<tr>
            <td class="mono">${esc(r.code)}</td><td><b>${esc(r.name)}</b></td>
            <td class="mono">${esc(r.value)}</td><td>${esc(r.unit)}</td>
            <td class="small">${esc(r.normalRange)}</td><td>${esc(r.abnormalFlag)}</td></tr>`).join("")
        : `<tr><td colspan="6" class="muted">No parsed parameters on this result.</td></tr>`}
      </tbody>
    </table></div>`;
  openModal({ title: `Machine result — ${esc(row.sampleId || row.billNo || row.id)}`, body, wide: true });
}

async function attachResult(id) {
  const row = rowById(id);
  if (!row) return toastError("Machine result not found.");
  if (!sessionCanWrite(P.REPORT_ENTER, ctx.session)) return toastError("You cannot change machine results.");

  const term = prompt("Bill number of the booking to attach this result to:", row.billNo || row.sampleId || "");
  if (term === null) return;
  const billQuery = term.trim();
  if (!billQuery) return;

  try {
    const matches = await Bookings.searchBookings(billQuery, { max: 10 });
    const booking = matches.find((b) => String(b.billNo).toLowerCase() === billQuery.toLowerCase()) || matches[0];
    if (!booking) return toastError(`No booking found for "${billQuery}".`);

    await MachineResults.attachToBooking(id, { bookingId: booking.bookingId, billNo: booking.billNo });
    await Bookings.updateBooking(booking.bookingId, {
      machineResultReceived: true,
      machineResultId: id,
      bookingStatus: "In Process"
    }, { actor: ctx.session });

    toastOk(`Attached to bill ${booking.billNo}. Open it in Report Entry to verify.`);
  } catch (error) {
    reportError(error, "Could not attach the machine result.");
  }
}

// ---------- on-premise listener installer card ----------

async function loadListenerRelease() {
  const mount = $("#listenerInstallerMount");
  if (!mount) return;
  if (releaseLoaded) return renderListenerCard();

  mount.innerHTML = `<div class="card"><b>Analyser listener</b><p class="small muted">Loading installer information…</p></div>`;
  try {
    const res = await fetch(`/listener-release.json?ts=${Date.now()}`, { cache: "no-store" });
    releaseMeta = res.ok ? await res.json() : null;
  } catch {
    releaseMeta = null;
  }
  releaseLoaded = true;
  renderListenerCard();
}

function renderListenerCard() {
  const mount = $("#listenerInstallerMount");
  if (!mount) return;
  if (!releaseMeta) {
    mount.innerHTML = `<div class="card"><b>Analyser listener</b><p class="small muted">Installer information is unavailable right now.</p></div>`;
    return;
  }
  const rel = releaseMeta;
  const canDownload = Boolean(rel.downloadUrl && rel.fileName);
  mount.innerHTML = `
    <div class="card">
      <div class="card-head"><h2>Analyser listener</h2>
        <span class="pill ${rel.status === "stable" ? "ok" : "warn"}">${esc(rel.status || "stable")}</span></div>
      <p class="small muted">Install on the Windows PC wired to the analyser. It forwards results into this screen.</p>
      <div class="grid grid-3" style="margin:12px 0;">
        <div class="stat"><div class="label">Version</div><div class="value">${esc(rel.version || "—")}</div></div>
        <div class="stat"><div class="label">Windows</div><div class="value">${esc(rel.minimumWindows || "10")} / 11</div></div>
        <div class="stat"><div class="label">Size</div><div class="value">${esc(rel.fileSize || "—")}</div></div>
      </div>
      <div class="row-flex">
        ${canDownload
          ? `<a class="btn btn-sm" href="${esc(rel.downloadUrl)}" rel="noopener">Download installer</a>`
          : `<button class="btn btn-sm" type="button" disabled>Download unavailable</button>`}
        <a class="btn btn-sm btn-outline" href="listener-installation-guide.html" target="_blank" rel="noopener">Installation guide</a>
      </div>
      ${rel.sha256 ? `<p class="small muted" style="margin-top:10px;">SHA-256 <code>${esc(rel.sha256)}</code></p>` : ""}
    </div>`;
}
