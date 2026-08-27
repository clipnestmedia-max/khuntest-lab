// Single Firebase entry point for the ported admin panel.
//
// This is the KhunTest deployment: the app is single-tenant and pinned to one
// Firebase project, so instead of the platform's env-config.js indirection we
// simply re-export the app / auth / db instances the rest of the KhunTest
// frontend already created in ../firebase-config.js. One Firebase app, shared.
export { app, auth, db } from "../firebase-config.js";

// The platform kernel read window.SWATI_ENV for multi-tenant host mapping and
// a public base URL. Neither applies here; expose a minimal object so any
// `globalThis.SWATI_ENV?.x` lookup stays defined.
export const SWATI_ENV = (globalThis.SWATI_ENV = globalThis.SWATI_ENV || {
  defaultLabId: "khuntest",
  hostLabMap: {},
  publicBaseUrl: ""
});
