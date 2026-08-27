// Code 128-B barcode -> inline SVG.
//
// Printed beside the patient block so a bill number can be scanned at the
// bench. Generated locally for the same reasons as the QR (core/qrcode.js):
// no third party sees the identifier, and an old report reprints offline.
//
// Code 128-B is deliberately the only subset implemented. It covers every
// character a bill or patient id uses here (ASCII 32-126), and supporting A/C
// as well would add switching logic with no benefit.

// Bar/space widths for values 0-106, from the Code 128 specification.
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
  "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
  "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
  "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
  "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
  "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
  "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
  "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
  "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
  "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
  "114131","311141","411131","211412","211214","211232","2331112"
];

const START_B = 104;
const STOP = 106;

/** Encode `text` into the bar/space width sequence. */
function encode(text) {
  const value = String(text ?? "").trim();
  if (!value) throw new Error("Nothing to encode in the barcode.");
  const codes = [START_B];
  let checksum = START_B;

  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) {
      throw new Error(`"${value[i]}" cannot be encoded in Code 128-B.`);
    }
    const symbol = code - 32;
    codes.push(symbol);
    checksum += symbol * (i + 1);
  }

  codes.push(checksum % 103);
  codes.push(STOP);
  return codes.map((c) => PATTERNS[c]).join("");
}

/**
 * Render `text` as an inline SVG barcode.
 * Widths in the pattern alternate bar, space, bar, space… starting with a bar.
 */
export function barcodeSvg(text, {
  height = 42, moduleWidth = 1.4, margin = 6, color = "#000000", showText = false
} = {}) {
  const widths = encode(text);
  let x = margin;
  let bars = "";

  widths.split("").forEach((w, i) => {
    const units = Number(w);
    const width = units * moduleWidth;
    if (i % 2 === 0) bars += `<rect x="${x.toFixed(2)}" y="0" width="${width.toFixed(2)}" height="${height}"/>`;
    x += width;
  });

  const totalWidth = x + margin;
  const labelHeight = showText ? 13 : 0;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalWidth.toFixed(2)} ${height + labelHeight}" ` +
    `width="${totalWidth.toFixed(0)}" height="${height + labelHeight}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="Barcode ${String(text)}">` +
    `<g fill="${color}">${bars}</g>` +
    (showText
      ? `<text x="${(totalWidth / 2).toFixed(2)}" y="${height + 11}" text-anchor="middle" ` +
        `font-family="monospace" font-size="10" fill="${color}">${String(text)}</text>`
      : "") +
    `</svg>`;
}

/**
 * Vertical variant, which is how a report prints it beside the patient block.
 *
 * Drawn vertically rather than CSS-rotated: a rotated element keeps its
 * original width for layout purposes, so a rotated barcode blew the patient
 * block apart. Here the bars are simply laid out down the Y axis.
 */
export function barcodeSvgVertical(text, {
  length = 42, moduleWidth = 1.4, margin = 6, color = "#000000"
} = {}) {
  const widths = encode(text);
  let y = margin;
  let bars = "";

  widths.split("").forEach((w, i) => {
    const height = Number(w) * moduleWidth;
    if (i % 2 === 0) bars += `<rect x="0" y="${y.toFixed(2)}" width="${length}" height="${height.toFixed(2)}"/>`;
    y += height;
  });

  const totalHeight = y + margin;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${length} ${totalHeight.toFixed(2)}" ` +
    `width="${length}" height="${totalHeight.toFixed(0)}" shape-rendering="crispEdges" ` +
    `role="img" aria-label="Barcode ${String(text)}"><g fill="${color}">${bars}</g></svg>`;
}

export { encode as encodeBarcode };
