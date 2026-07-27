#!/usr/bin/env node
"use strict";

const assert = require("assert");
const {
  ageToDays,
  generateTestInterpretation,
  resolveReferenceRange
} = require("../shared/interpretation-engine.js");

function run() {
  const glucose = {
    code: "GLUCOSE",
    name: "Glucose",
    resultType: "numeric",
    defaultUnit: "mg/dL",
    referenceRanges: [
      { id: "adult-all", gender: "all", minimumAgeDays: 6575, unit: "mg/dL", lowerLimit: 70, upperLimit: 110, priority: 10 },
      { id: "child-all", gender: "all", maximumAgeDays: 6574, unit: "mg/dL", textRange: "Requires laboratory approval before production use.", priority: 1 }
    ],
    interpretationRules: [
      { id: "critical-high", operator: "greater_than", minimumValue: 400, flag: "HH", severity: "critical_high", interpretation: "Critical value. Clinical correlation is recommended.", priority: 100 }
    ]
  };

  assert.strictEqual(ageToDays({ age: "18 years" }), 6575);
  assert.strictEqual(resolveReferenceRange({ test: glucose, patient: { age: "30 years", gender: "Female" }, unit: "mg/dL" }).selectedReferenceRange.id, "adult-all");
  assert.strictEqual(generateTestInterpretation({ test: glucose, result: "65", patient: { age: "30 years" }, unit: "mg/dL" }).flag, "L");
  assert.strictEqual(generateTestInterpretation({ test: glucose, result: "90", patient: { age: "30 years" }, unit: "mg/dL" }).flag, "N");
  assert.strictEqual(generateTestInterpretation({ test: glucose, result: "130", patient: { age: "30 years" }, unit: "mg/dL" }).flag, "H");
  assert.strictEqual(generateTestInterpretation({ test: glucose, result: "500", patient: { age: "30 years" }, unit: "mg/dL" }).flag, "HH");

  const qualitative = {
    code: "HBSAG",
    name: "HBsAg",
    resultType: "reactive_non_reactive",
    interpretationRules: [
      { id: "reactive", operator: "qualitative_equals", qualitativeValue: "Reactive", flag: "R", severity: "abnormal", interpretation: "Reactive result. Clinical correlation is recommended.", priority: 10 },
      { id: "non-reactive", operator: "qualitative_equals", qualitativeValue: "Non-reactive", flag: "NR", severity: "normal", interpretation: "", priority: 1 }
    ]
  };
  assert.strictEqual(generateTestInterpretation({ test: qualitative, result: "Reactive" }).flag, "R");
  assert.strictEqual(generateTestInterpretation({ test: qualitative, result: "Non-reactive" }).flag, "NR");

  const esr = {
    code: "ESR",
    name: "ESR (1st Hour)",
    resultType: "first_second_hour",
    defaultUnit: "mm/hr",
    referenceRanges: [
      { id: "esr-adult-male-1h", gender: "male", minimumAgeDays: 6575, unit: "mm/hr", lowerLimit: 0, upperLimit: 15, priority: 10 }
    ]
  };
  assert.strictEqual(generateTestInterpretation({ test: esr, result: "16", patient: { age: "40 years", gender: "Male" }, unit: "mm/hr" }).flag, "H");
  assert.ok(generateTestInterpretation({ test: esr, result: "abc", patient: { age: "40 years" }, unit: "mm/hr" }).warnings.includes("Numeric result is invalid."));

  const missing = resolveReferenceRange({ test: { code: "NEW", name: "New Test" }, patient: {} });
  assert.strictEqual(missing.displayRange, "Reference range not configured");
  assert.ok(missing.warnings.length);
}

run();
console.log("interpretation-engine tests passed");
