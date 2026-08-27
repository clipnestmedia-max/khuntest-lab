// QR generation for reports and bills.
//
// WHY LOCAL, NOT A QR SERVICE. The earlier template built its QR with
// api.qrserver.com, which sends the encoded URL to a third party. On a report
// that URL is an unguessable share token that opens a patient's medical
// results — handing it to an external service is a leak, and it makes printing
// a report depend on someone else's uptime years after it was issued.
//
// WHY VENDORED, NOT WRITTEN. A hand-rolled encoder was tried and produced
// well-formed codes that no scanner could read: the format information went in
// most-significant-bit first, and alignment patterns on the timing lines were
// skipped. QR is a solved problem with subtle spec details, and an unscannable
// code printed on a medical report is worse than none — so core/vendor holds
// Kazuhiko Arase's MIT implementation and this file is a thin renderer.
import qrcode from "./vendor/qrcode-generator.mjs";
import { stringToBytes } from "./vendor/qrcode-generator-utf8.mjs";

// UTF-8 so a laboratory name or address with non-ASCII characters encodes.
qrcode.stringToBytes = stringToBytes;

/** Error-correction level. M recovers ~15%, which survives a photocopy. */
const DEFAULT_ECC = "M";

function build(text, ecc = DEFAULT_ECC) {
  const value = String(text ?? "").trim();
  if (!value) throw new Error("Nothing to encode in the QR code.");
  const qr = qrcode(0, ecc);          // 0 = choose the smallest version that fits
  qr.addData(value);
  qr.make();
  return qr;
}

/** Boolean matrix, exposed for tests. */
export function encodeQr(text, ecc = DEFAULT_ECC) {
  const qr = build(text, ecc);
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, r) =>
    Array.from({ length: count }, (_, c) => (qr.isDark(r, c) ? 1 : 0)));
}

/**
 * Render `text` as an inline SVG QR code.
 *
 * SVG rather than a raster: it prints crisply at any size, costs a few hundred
 * bytes, and needs no network.
 */
export function qrSvg(text, {
  size = 110, margin = 2, dark = "#000000", light = "#ffffff", label = "", ecc = DEFAULT_ECC
} = {}) {
  const matrix = encodeQr(text, ecc);
  const count = matrix.length;
  const total = count + margin * 2;

  let path = "";
  matrix.forEach((row, r) => row.forEach((v, c) => {
    if (v) path += `M${c + margin} ${r + margin}h1v1h-1z`;
  }));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" ` +
    `width="${size}" height="${size}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="${label || "QR code"}">` +
    `<rect width="${total}" height="${total}" fill="${light}"/>` +
    `<path d="${path}" fill="${dark}"/></svg>`;
}

/** Data URI form, for an <img src> or a CSS background. */
export function qrDataUri(text, options = {}) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(qrSvg(text, options))}`;
}
