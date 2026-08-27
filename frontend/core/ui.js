// Small shared UI primitives so every screen behaves the same way.
// No framework: the KhunTest original is plain ES modules on static hosting,
// and keeping that means the product deploys to Firebase Hosting with no
// build step, which matters when a reseller has to redeploy it themselves.

export function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

export function html(strings, ...values) {
  return strings.reduce((out, s, i) => out + s + (i < values.length ? esc(values[i]) : ""), "");
}

// ---------- toast ----------

function toastStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

export function toast(message, kind = "", ms = 4000) {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  el.setAttribute("role", kind === "danger" ? "alert" : "status");
  toastStack().appendChild(el);
  setTimeout(() => el.remove(), ms);
  return el;
}

export const toastOk = (m) => toast(m, "ok");
export const toastError = (m) => toast(m, "danger", 6000);
export const toastWarn = (m) => toast(m, "warn", 5000);

/** Report a caught error to the user without swallowing the detail. */
export function reportError(error, fallback = "Something went wrong.") {
  console.error(error);
  const message = error?.code === "permission-denied"
    ? "You do not have permission for this action."
    : (error?.message || fallback);
  toastError(message);
}

// ---------- modal ----------

export function openModal({ title, body, footer = "", wide = false, onClose = null }) {
  closeModal();
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.id = "app-modal";
  modal.innerHTML = `
    <div class="modal-box ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head">
        <h3>${esc(title)}</h3>
        <button class="modal-close" type="button" aria-label="Close">&times;</button>
      </div>
      <div class="modal-body"></div>
      ${footer ? `<div class="modal-foot"></div>` : ""}
    </div>`;
  const bodyEl = modal.querySelector(".modal-body");
  if (typeof body === "string") bodyEl.innerHTML = body; else bodyEl.appendChild(body);
  if (footer) {
    const footEl = modal.querySelector(".modal-foot");
    if (typeof footer === "string") footEl.innerHTML = footer; else footEl.appendChild(footer);
  }
  const close = () => { modal.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  modal.querySelector(".modal-close").addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(modal);
  modal.querySelector("input, select, textarea, button:not(.modal-close)")?.focus();
  return { element: modal, close };
}

export function closeModal() { document.getElementById("app-modal")?.remove(); }

export function confirmAction(message, { title = "Please confirm", danger = false, confirmLabel = "Confirm" } = {}) {
  return new Promise((resolve) => {
    const { element, close } = openModal({
      title,
      body: `<p>${esc(message)}</p>`,
      footer: `
        <button class="btn btn-outline" data-act="no" type="button">Cancel</button>
        <button class="btn ${danger ? "btn-danger" : ""}" data-act="yes" type="button">${esc(confirmLabel)}</button>`,
      onClose: () => resolve(false)
    });
    element.querySelector('[data-act="no"]').addEventListener("click", () => { close(); resolve(false); });
    element.querySelector('[data-act="yes"]').addEventListener("click", () => { element.remove(); resolve(true); });
  });
}

// ---------- rendering ----------

export function emptyRow(colspan, message = "Nothing to show yet.") {
  return `<tr class="empty-row"><td colspan="${colspan}">${esc(message)}</td></tr>`;
}

export function renderRows(tbody, rows, rowHtml, { colspan = 6, empty = "Nothing to show yet." } = {}) {
  const el = typeof tbody === "string" ? document.getElementById(tbody) : tbody;
  if (!el) return;
  el.innerHTML = rows.length ? rows.map(rowHtml).join("") : emptyRow(colspan, empty);
}

export function setBusy(element, busy, busyText = "Working...") {
  const el = typeof element === "string" ? document.getElementById(element) : element;
  if (!el) return;
  if (busy) {
    el.dataset.originalText = el.textContent;
    el.disabled = true;
    el.textContent = busyText;
  } else {
    el.disabled = false;
    if (el.dataset.originalText) el.textContent = el.dataset.originalText;
  }
}

export function statusPill(status) {
  const s = String(status || "").toLowerCase();
  if (["final", "paid", "active", "completed", "delivered", "report ready"].includes(s)) return "ok";
  if (["pending", "draft", "new", "trial", "partial", "in process", "processing"].includes(s)) return "warn";
  if (["cancelled", "expired", "suspended", "disabled", "failed"].includes(s)) return "danger";
  return "info";
}

export function pill(text, kind = null) {
  return `<span class="pill ${kind ?? statusPill(text)}">${esc(text || "-")}</span>`;
}

export function progressBar(entered, total) {
  const pct = total ? Math.round((entered / total) * 100) : 0;
  return `<span class="progress-bar"><i style="width:${pct}%"></i></span>`;
}

// ---------- forms ----------

export function readForm(form) {
  const data = {};
  new FormData(form).forEach((value, key) => {
    if (data[key] === undefined) data[key] = value;
    else data[key] = [].concat(data[key], value);
  });
  form.querySelectorAll('input[type="checkbox"]').forEach((cb) => { data[cb.name] = cb.checked; });
  return data;
}

export function fillForm(form, data) {
  Object.entries(data || {}).forEach(([key, value]) => {
    const field = form.elements[key];
    if (!field) return;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  });
}

/** Debounce for search-as-you-type. */
export function debounce(fn, ms = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ---------- navigation ----------

/** Simple hash router used by the admin panels. */
export function setupTabs({ onChange, defaultTab }) {
  const buttons = $$("[data-tab]");
  const panels = $$("[data-panel]");
  const show = (tab) => {
    buttons.forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    panels.forEach((p) => p.classList.toggle("hidden", p.dataset.panel !== tab));
    if (location.hash.slice(1) !== tab) history.replaceState(null, "", `#${tab}`);
    document.querySelector(".app")?.classList.remove("nav-open");
    onChange?.(tab);
  };
  buttons.forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
  window.addEventListener("hashchange", () => {
    const tab = location.hash.slice(1);
    if (tab && buttons.some((b) => b.dataset.tab === tab)) show(tab);
  });
  show(location.hash.slice(1) || defaultTab || buttons[0]?.dataset.tab);
  return { show };
}

export function setupMobileNav() {
  const app = document.querySelector(".app");
  document.querySelector(".menu-toggle")?.addEventListener("click", () => app?.classList.toggle("nav-open"));
  app?.addEventListener("click", (e) => {
    if (e.target === app) app.classList.remove("nav-open");
  });
}
