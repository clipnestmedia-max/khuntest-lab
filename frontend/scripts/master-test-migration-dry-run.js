#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  migrateLegacyTestToMaster,
  validateReferenceRange
} = require("../shared/interpretation-engine.js");

const root = path.resolve(__dirname, "..");
const testsPath = path.join(root, "data", "tests.json");
const outputPath = path.join(root, "data", "master-test-migration-summary.json");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function sourceTests() {
  const data = readJson(testsPath);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.tests)) return data.tests;
  return [];
}

function runDryMigration() {
  const tests = sourceTests();
  const seenCodes = new Map();
  const summary = {
    mode: "dry-run",
    generatedAt: new Date().toISOString(),
    totalTests: tests.length,
    migrated: 0,
    duplicateCodes: [],
    rangeValidationErrors: [],
    requiresLabApproval: 0,
    examples: []
  };

  tests.forEach((test) => {
    const migrated = migrateLegacyTestToMaster(test);
    summary.migrated += 1;
    const codeKey = String(migrated.code || "").toLowerCase();
    if (codeKey) {
      if (seenCodes.has(codeKey)) summary.duplicateCodes.push({ code: migrated.code, first: seenCodes.get(codeKey), duplicate: migrated.name });
      else seenCodes.set(codeKey, migrated.name);
    }
    migrated.referenceRanges.forEach((range) => {
      const errors = validateReferenceRange(range);
      if (errors.length) summary.rangeValidationErrors.push({ code: migrated.code, test: migrated.name, rangeId: range.id, errors });
    });
    if (migrated.migrationStatus === "requires_lab_approval") summary.requiresLabApproval += 1;
    if (["serumige", "esr", "bloodsugarfasting", "hba1c"].some((needle) => String(migrated.name || "").toLowerCase().replace(/[^a-z0-9]/g, "").includes(needle))) {
      summary.examples.push({
        code: migrated.code,
        name: migrated.name,
        displayName: migrated.displayName,
        resultType: migrated.resultType,
        defaultUnit: migrated.defaultUnit,
        referenceRangeCount: migrated.referenceRanges.length,
        approvalNote: migrated.approvalNote
      });
    }
  });

  fs.writeFileSync(outputPath, JSON.stringify(summary, null, 2) + "\n");
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

if (require.main === module) {
  runDryMigration();
}

module.exports = { runDryMigration };
