// White-label branding engine.
//
// This module is the reason no laboratory name, logo, colour, address or
// phone number appears anywhere in this source tree. A page declares intent
// with data attributes and applyBranding() fills them in from Firestore:
//
//   <img data-brand="logo">                     -> src = lab logo
//   <span data-brand="labName"></span>          -> textContent
//   <a   data-brand-href="whatsappLink">        -> href
//   <title data-brand-title="Reports"></title>  -> "Reports | ABC Diagnostic Centre"
//
// Colours become CSS custom properties on :root, so an entire lab's theme is
// a settings change, never a code change.
import { getLabId } from "./tenant.js";
import { DEFAULT_BRANDING } from "./branding-defaults.js";

export { DEFAULT_BRANDING };

let cache = { labId: "", branding: null };

function digitsOnly(value) { return String(value || "").replace(/\D/g, ""); }

/** Merge Firestore data over the defaults, one level deep for nested objects. */
function mergeBranding(base, patch = {}) {
  const out = { ...base };
  Object.entries(patch).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (key === "social" && typeof value === "object") out.social = { ...base.social, ...value };
    else out[key] = value;
  });
  return out;
}

/**
 * Load branding for a laboratory. The registry document /labs/{labId} holds
 * identity fields that Super Admin owns (name, plan, domain); the settings
 * document /labs/{labId}/settings/branding holds what the laboratory itself
 * may edit. Settings win where both define a field.
 */
export async function loadBranding(labId = getLabId(), { force = false } = {}) {
  if (!force && cache.labId === labId && cache.branding) return cache.branding;

  // Single-tenant: branding is the compiled-in KhunTest identity, no
  // per-laboratory Firestore read. mergeBranding is still used so a future
  // settings screen could overlay edits here.
  let branding = mergeBranding({ ...DEFAULT_BRANDING }, {});

  branding.labId = labId;
  branding.fullAddress = [branding.address, branding.city, branding.state, branding.pincode]
    .filter(Boolean).join(", ");
  branding.whatsappDigits = digitsOnly(branding.whatsapp || branding.phone);
  branding.whatsappLink = branding.whatsappDigits
    ? `https://wa.me/${branding.whatsappDigits.length === 10 ? "91" + branding.whatsappDigits : branding.whatsappDigits}`
    : "";
  branding.phoneLink = branding.phone ? `tel:${digitsOnly(branding.phone)}` : "";
  branding.emailLink = branding.email ? `mailto:${branding.email}` : "";

  cache = { labId, branding };
  return branding;
}

/** Push the palette into CSS custom properties. */
export function applyTheme(branding, root = document.documentElement) {
  root.style.setProperty("--brand-primary", branding.primaryColor);
  root.style.setProperty("--brand-secondary", branding.secondaryColor);
  root.style.setProperty("--brand-accent", branding.accentColor);
  root.style.setProperty("--brand-primary-soft", `${branding.primaryColor}1a`);
  root.style.setProperty("--brand-primary-line", `${branding.primaryColor}33`);
}

function setText(el, value) { el.textContent = value ?? ""; }

/** Fill every [data-brand*] element on the page. */
export function applyBranding(branding, scope = document) {
  applyTheme(branding);

  scope.querySelectorAll("[data-brand]").forEach((el) => {
    const key = el.getAttribute("data-brand");
    const value = branding[key] ?? "";
    if (el.tagName === "IMG") {
      if (value) { el.src = value; el.alt = el.alt || branding.labName; el.hidden = false; }
      else el.hidden = true;
    } else if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
      el.value = value;
    } else {
      setText(el, value);
    }
  });

  scope.querySelectorAll("[data-brand-href]").forEach((el) => {
    const value = branding[el.getAttribute("data-brand-href")] || "";
    if (value) { el.href = value; el.hidden = false; } else { el.hidden = true; }
  });

  scope.querySelectorAll("[data-brand-show]").forEach((el) => {
    el.hidden = !branding[el.getAttribute("data-brand-show")];
  });

  scope.querySelectorAll("[data-brand-attr]").forEach((el) => {
    // data-brand-attr="placeholder:labName"
    const [attr, key] = el.getAttribute("data-brand-attr").split(":");
    if (attr && key) el.setAttribute(attr, branding[key] ?? "");
  });

  const titleEl = scope.querySelector("title[data-brand-title]");
  if (titleEl) {
    const page = titleEl.getAttribute("data-brand-title");
    titleEl.textContent = page ? `${page} | ${branding.labName}` : branding.labName;
  }

  if (branding.faviconUrl) {
    let link = document.querySelector("link[rel='icon']");
    if (!link) { link = document.createElement("link"); link.rel = "icon"; document.head.appendChild(link); }
    link.href = branding.faviconUrl;
  }

  renderPoweredBy(branding, scope);
  return branding;
}

/** Optional "Powered by Swati Softtech Solution" footer (Super Admin toggle). */
export function renderPoweredBy(branding, scope = document) {
  scope.querySelectorAll("[data-powered-by]").forEach((el) => {
    if (branding.showPoweredBy === false) { el.hidden = true; el.innerHTML = ""; return; }
    el.hidden = false;
    el.innerHTML = `<span class="powered-by">Powered by <strong>Swati Softtech Solution</strong></span>`;
  });
}

/** Convenience: resolve + apply in one call, used by every page's bootstrap. */
export async function bootBranding(labId = getLabId(), scope = document) {
  const branding = await loadBranding(labId);
  applyBranding(branding, scope);
  return branding;
}

export function clearBrandingCache() { cache = { labId: "", branding: null }; }
