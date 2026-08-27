# Vendored third-party code

Copied here rather than pulled from a CDN so a report can be printed with no
network call, and so nothing about a patient's report URL is sent anywhere.

## qrcode-generator 2.0.4 — MIT

Kazuhiko Arase, <http://www.d-project.com/>
<http://www.opensource.org/licenses/mit-license.php>

`qrcode-generator.mjs` and `qrcode-generator-utf8.mjs` are the unmodified ESM
builds from the npm package.

**Why vendored rather than written.** A hand-rolled QR encoder was tried first
and produced well-formed codes that no scanner could read — the format
information was placed most-significant-bit first, and alignment patterns
sitting on the timing lines were skipped. QR encoding is a solved problem with
subtle spec details, and a code that fails to scan on a printed medical report
is worse than no code at all, so a production-proven implementation is used.
Verified against it in `tests/unit/qrcode.test.js`.

"QR Code" is a registered trademark of DENSO WAVE INCORPORATED.
