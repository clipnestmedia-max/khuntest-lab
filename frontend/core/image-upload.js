// Logo, stamp and signature upload.
//
// Images are resized in the browser and stored as data URIs on the
// laboratory's own branding document, rather than in Cloud Storage. That is a
// deliberate trade: a reseller deploying this to a new Firebase project gets
// working uploads with no bucket to create, no storage rules to write and no
// CORS to configure - and a laboratory logo is a few kilobytes once resized.
//
// The guard rails that make it safe: images are re-encoded through a canvas
// (so an uploaded file cannot smuggle markup or EXIF payloads through), capped
// by dimension AND by encoded size, and rejected outright if the result would
// not comfortably fit a Firestore document.

// Firestore's hard limit is 1 MiB per document. Branding also holds text and
// signatories, so images get a much smaller budget than that.
export const LIMITS = Object.freeze({
  logo:      { maxW: 480, maxH: 240, maxBytes: 120_000, label: "Logo" },
  stamp:     { maxW: 420, maxH: 420, maxBytes: 120_000, label: "Stamp" },
  signature: { maxW: 400, maxH: 160, maxBytes:  80_000, label: "Signature" },
  favicon:   { maxW: 128, maxH: 128, maxBytes:  30_000, label: "Favicon" }
});

const ACCEPTED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];

export function acceptAttribute() { return ACCEPTED.join(","); }

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read that file."));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a readable image."));
    img.src = dataUrl;
  });
}

/** Scale to fit inside the box without distorting or upscaling. */
function fit(width, height, maxW, maxH) {
  const scale = Math.min(maxW / width, maxH / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/**
 * Re-encode through a canvas, stepping quality down until the result fits the
 * byte budget. PNG is kept for images with transparency (a logo on a report
 * letterhead usually needs it); everything else becomes JPEG, which is far
 * smaller for photographic stamps and scanned signatures.
 */
async function encode(img, { maxW, maxH, maxBytes }, preferPng) {
  const { width, height } = fit(img.naturalWidth || img.width, img.naturalHeight || img.height, maxW, maxH);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  if (!preferPng) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, width, height); }
  ctx.drawImage(img, 0, 0, width, height);

  if (preferPng) {
    const png = canvas.toDataURL("image/png");
    if (png.length <= maxBytes) return { dataUrl: png, width, height, type: "image/png" };
  }
  for (const quality of [0.92, 0.85, 0.75, 0.65, 0.5]) {
    const jpeg = canvas.toDataURL("image/jpeg", quality);
    if (jpeg.length <= maxBytes) return { dataUrl: jpeg, width, height, type: "image/jpeg", quality };
  }
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.5), width, height, type: "image/jpeg", quality: 0.5, oversize: true };
}

/** True when any pixel is not fully opaque, so transparency must be preserved. */
function hasTransparency(img) {
  try {
    const canvas = document.createElement("canvas");
    const w = canvas.width = Math.min(img.naturalWidth || img.width, 100);
    const h = canvas.height = Math.min(img.naturalHeight || img.height, 100);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
    return false;
  } catch {
    return true;   // tainted or unreadable: keep PNG, which is the safe choice
  }
}

/**
 * Turn a picked File into a storable data URI.
 * @returns {{dataUrl, width, height, bytes, type, note}}
 */
export async function prepareImage(file, kind = "logo") {
  const limit = LIMITS[kind] || LIMITS.logo;
  if (!file) throw new Error("No file selected.");
  if (!ACCEPTED.includes(file.type)) {
    throw new Error(`${limit.label} must be a PNG, JPEG, WebP or SVG file.`);
  }
  // Refuse an absurd source file before decoding it into memory.
  if (file.size > 8 * 1024 * 1024) {
    throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. Please use an image under 8 MB.`);
  }

  const raw = await readAsDataUrl(file);

  // SVG is already small and resolution independent, but it is also markup, so
  // it is only accepted when it carries nothing executable.
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    if (/<\s*script|\son\w+\s*=|javascript\s*:|<\s*foreignObject/i.test(text)) {
      throw new Error("That SVG contains scripting and cannot be used. Please upload a PNG or JPEG instead.");
    }
    if (raw.length > limit.maxBytes) {
      throw new Error(`That SVG is too large (${Math.round(raw.length / 1024)} KB). The limit is ${Math.round(limit.maxBytes / 1024)} KB.`);
    }
    return { dataUrl: raw, width: 0, height: 0, bytes: raw.length, type: file.type, note: "SVG used as supplied." };
  }

  const img = await loadImage(raw);
  const result = await encode(img, limit, hasTransparency(img));

  if (result.oversize) {
    throw new Error(
      `${limit.label} is still ${Math.round(result.dataUrl.length / 1024)} KB after compression ` +
      `(limit ${Math.round(limit.maxBytes / 1024)} KB). Please crop it or use a simpler image.`
    );
  }

  const originalKb = Math.round(file.size / 1024);
  const finalKb = Math.round(result.dataUrl.length / 1024);
  return {
    dataUrl: result.dataUrl,
    width: result.width,
    height: result.height,
    bytes: result.dataUrl.length,
    type: result.type,
    note: `Resized to ${result.width}×${result.height}, ${originalKb} KB → ${finalKb} KB.`
  };
}

/**
 * Wire a "choose a file" button to a preview and a callback.
 * Returns a teardown function.
 */
export function attachImagePicker({ button, preview, kind = "logo", onReady, onError }) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = acceptAttribute();
  input.hidden = true;
  document.body.appendChild(input);

  const open = () => input.click();
  const change = async () => {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      const result = await prepareImage(file, kind);
      if (preview) { preview.src = result.dataUrl; preview.hidden = false; }
      onReady?.(result);
    } catch (error) {
      onError?.(error);
    }
  };

  button.addEventListener("click", open);
  input.addEventListener("change", change);
  return () => { button.removeEventListener("click", open); input.remove(); };
}
