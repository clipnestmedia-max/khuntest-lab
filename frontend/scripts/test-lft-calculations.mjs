import assert from "node:assert/strict";
import {
  INDIRECT_BILIRUBIN_WARNING,
  applyLftCalculatedParameters,
  calculateIndirectBilirubin,
  lftSortIndex
} from "./lft-calculations.mjs";

function lftReport(results, extra = {}) {
  return {
    tests: [{ testCode: "LFT", name: "LIVER FUNCTION TEST" }],
    results,
    ...extra
  };
}

function row(name, value, extra = {}) {
  return { parameterName: name, name, resultValue: value, value, ...extra };
}

function find(results, name) {
  return results.find((result) => String(result.parameterName || result.name || "").toLowerCase() === name.toLowerCase());
}

function indirect(report) {
  return find(report.results, "Bilirubin Indirect");
}

{
  const calc = calculateIndirectBilirubin([row("BILIRUBIN_TOTAL", "1.20"), row("BILIRUBIN_DIRECT", "0.30")]);
  assert.equal(calc.value, "0.90", "calculates when Total and Direct Bilirubin are available");
}

{
  const calc = calculateIndirectBilirubin([row("Direct Bilirubin", "0.30")]);
  assert.equal(calc.value, "Not available", "Total Bilirubin missing shows Not available");
}

{
  const calc = calculateIndirectBilirubin([row("Total Bilirubin", "1.20")]);
  assert.equal(calc.value, "Not available", "Direct Bilirubin missing shows Not available");
}

{
  const calc = calculateIndirectBilirubin([row("Total Bilirubin", "0.20"), row("Direct Bilirubin", "0.30")]);
  assert.equal(calc.value, "Not available", "Direct greater than Total does not produce a negative value");
  assert.equal(calc.warning, INDIRECT_BILIRUBIN_WARNING, "Direct greater than Total returns validation warning");
}

{
  const calc = calculateIndirectBilirubin([row("T. Bilirubin", "2.345"), row("D. Bilirubin", "0.115")]);
  assert.equal(calc.value, "2.23", "decimal calculation uses full precision internally and displays two decimals");
}

{
  const names = ["AST (SGOT)", "ALT (SGPT)", "GGT", "Alkaline Phosphatase (ALP)", "Bilirubin Total", "Bilirubin Direct", "Bilirubin Indirect", "Total Protein", "Albumin", "Globulin", "A/G Ratio"];
  const sorted = names.slice().sort((a, b) => lftSortIndex(row(a, "")) - lftSortIndex(row(b, "")));
  assert.deepEqual(sorted, names, "LFT fallback parameter order is preserved");
}

{
  const applied = applyLftCalculatedParameters(lftReport([
    row("Total Bilirubin", "1.20"),
    row("Direct Bilirubin", "0.30"),
    row("Bilirubin Indirect", "7.77")
  ]));
  assert.equal(indirect(applied).resultValue, "0.90", "existing manual Indirect Bilirubin is replaced in a draft");
  assert.equal(indirect(applied).calculated, true, "replacement is marked calculated");
}

{
  const original = lftReport([row("Total Bilirubin", "1.20"), row("Direct Bilirubin", "0.30"), row("Bilirubin Indirect", "7.77")], { status: "Final" });
  const before = JSON.stringify(original);
  applyLftCalculatedParameters(original);
  assert.equal(JSON.stringify(original), before, "released historical report object is preserved by not mutating input");
}

{
  const applied = applyLftCalculatedParameters(lftReport([
    row("Total Bilirubin", "1.20"),
    row("Direct Bilirubin", "0.30"),
    row("Bilirubin Indirect", "0.00"),
    row("Indirect Bilirubin", "9.99")
  ]));
  assert.equal(applied.results.filter((result) => result.code === "BILIRUBIN_INDIRECT").length, 1, "no duplicate Indirect Bilirubin row");
}

{
  const initial = applyLftCalculatedParameters(lftReport([row("Total Bilirubin", "1.20"), row("Direct Bilirubin", "0.30")]));
  const edited = applyLftCalculatedParameters({ ...initial, results: initial.results.map((result) => result.parameterName === "Total Bilirubin" ? { ...result, resultValue: "1.50", value: "1.50" } : result) });
  assert.equal(indirect(edited).resultValue, "1.20", "recalculates after editing Total Bilirubin");
}

{
  const initial = applyLftCalculatedParameters(lftReport([row("Total Bilirubin", "1.20"), row("Direct Bilirubin", "0.30")]));
  const edited = applyLftCalculatedParameters({ ...initial, results: initial.results.map((result) => result.parameterName === "Direct Bilirubin" ? { ...result, resultValue: "0.50", value: "0.50" } : result) });
  assert.equal(indirect(edited).resultValue, "0.70", "recalculates after editing Direct Bilirubin");
}

{
  const legacyRatioName = ["AST", "ALT"].join("/") + " Ratio";
  const applied = applyLftCalculatedParameters(lftReport([
    row("AST (SGOT)", "16.00"),
    row("ALT (SGPT)", "100.50"),
    row(legacyRatioName, "0.50"),
    row("Total Bilirubin", "1.20"),
    row("Direct Bilirubin", "0.30")
  ]));
  assert.equal(find(applied.results, "AST (SGOT)").resultValue, "16.00", "AST remains unchanged");
  assert.equal(find(applied.results, "ALT (SGPT)").resultValue, "100.50", "ALT remains unchanged");
  assert.equal(applied.results.some((result) => /ast.*alt|sgot.*sgpt/i.test(result.parameterName || result.name || "")), false, "no legacy ratio row appears");
}

{
  const applied = applyLftCalculatedParameters(lftReport([
    row("Total Protein", "6.39"),
    row("Albumin", "2.00"),
    row("Globulin", ""),
    row("A/G Ratio", ""),
    row("Total Bilirubin", "1.20"),
    row("Direct Bilirubin", "0.30")
  ]));
  assert.equal(find(applied.results, "Globulin").resultValue, "4.39", "keeps Globulin calculation");
  assert.equal(find(applied.results, "A/G Ratio").resultValue, "0.46", "keeps A/G Ratio calculation");
}

console.log("LFT calculation tests passed");
