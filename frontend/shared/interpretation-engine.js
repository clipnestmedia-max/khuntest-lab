(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.KhunTestInterpretationEngine = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ENGINE_VERSION = "1.0.0";
  const RESULT_TYPES = [
    "numeric",
    "decimal",
    "integer",
    "positive_negative",
    "reactive_non_reactive",
    "detected_not_detected",
    "text",
    "titre",
    "ratio",
    "percentage",
    "time",
    "calculated",
    "multi_parameter",
    "first_second_hour",
    "custom_select"
  ];
  const FLAG_LABELS = {
    LL: "Critical Low",
    L: "Low",
    N: "Normal",
    H: "High",
    HH: "Critical High",
    A: "Abnormal",
    C: "Critical",
    R: "Reactive",
    NR: "Non-reactive",
    B: "Borderline"
  };

  function cleanText(value) {
    return String(value || "").replace(/[<>]/g, "").trim();
  }

  function key(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  function normalizeGender(value) {
    const gender = String(value || "").toLowerCase();
    if (gender.startsWith("m")) return "male";
    if (gender.startsWith("f")) return "female";
    return gender || "all";
  }

  function ageToDays(patient = {}, reportDate = new Date()) {
    if (patient.ageDays !== undefined && patient.ageDays !== null && patient.ageDays !== "") return Number(patient.ageDays);
    if (patient.dateOfBirth || patient.dob) {
      const dob = new Date(patient.dateOfBirth || patient.dob);
      const at = new Date(reportDate || Date.now());
      if (!Number.isNaN(dob.getTime()) && !Number.isNaN(at.getTime())) {
        return Math.max(0, Math.floor((at.getTime() - dob.getTime()) / 86400000));
      }
    }
    const rawAge = String(patient.age || patient.patientAge || "").trim();
    const numericAge = Number(rawAge.match(/\d+(\.\d+)?/)?.[0] || "");
    if (!Number.isFinite(numericAge)) return null;
    if (/day/i.test(rawAge)) return Math.round(numericAge);
    if (/month/i.test(rawAge)) return Math.round(numericAge * 30.4375);
    return Math.round(numericAge * 365.25);
  }

  function normalizeReferenceRange(range = {}, index = 0) {
    return {
      id: range.id || `range-${index + 1}`,
      label: cleanText(range.label || range.name || ""),
      gender: normalizeGender(range.gender || "all"),
      minimumAgeDays: range.minimumAgeDays ?? range.minAgeDays ?? null,
      maximumAgeDays: range.maximumAgeDays ?? range.maxAgeDays ?? null,
      pregnancyStatus: String(range.pregnancyStatus || "all").toLowerCase(),
      trimester: range.trimester || null,
      method: cleanText(range.method || ""),
      unit: cleanText(range.unit || range.defaultUnit || ""),
      lowerLimit: range.lowerLimit === "" || range.lowerLimit === undefined ? null : Number(range.lowerLimit),
      upperLimit: range.upperLimit === "" || range.upperLimit === undefined ? null : Number(range.upperLimit),
      lowerInclusive: range.lowerInclusive !== false,
      upperInclusive: range.upperInclusive !== false,
      textRange: cleanText(range.textRange || range.normalRange || range.normalValue || ""),
      priority: Number(range.priority || 0),
      enabled: range.enabled !== false
    };
  }

  function normalizeInterpretationRule(rule = {}, index = 0) {
    return {
      id: rule.id || `rule-${index + 1}`,
      name: cleanText(rule.name || ""),
      resultType: rule.resultType || "numeric",
      operator: rule.operator || "between",
      minimumValue: rule.minimumValue === "" || rule.minimumValue === undefined ? null : Number(rule.minimumValue),
      maximumValue: rule.maximumValue === "" || rule.maximumValue === undefined ? null : Number(rule.maximumValue),
      qualitativeValue: cleanText(rule.qualitativeValue || ""),
      gender: normalizeGender(rule.gender || "all"),
      minimumAgeDays: rule.minimumAgeDays ?? null,
      maximumAgeDays: rule.maximumAgeDays ?? null,
      pregnancyStatus: String(rule.pregnancyStatus || "all").toLowerCase(),
      method: cleanText(rule.method || ""),
      unit: cleanText(rule.unit || ""),
      flag: cleanText(rule.flag || ""),
      severity: cleanText(rule.severity || ""),
      interpretation: cleanText(rule.interpretation || ""),
      clinicalNote: cleanText(rule.clinicalNote || rule.clinicalNotes || ""),
      recommendation: cleanText(rule.recommendation || ""),
      priority: Number(rule.priority || 0),
      enabled: rule.enabled !== false
    };
  }

  function legacyRangeFromText(test = {}) {
    const textRange = cleanText(test.normalRange || test.normalValue || test.referenceRange || test.normal || "");
    if (!textRange) return [];
    return [normalizeReferenceRange({
      id: "legacy-range",
      label: "Legacy reference range",
      textRange,
      unit: test.unit || test.defaultUnit || "",
      priority: -100
    })];
  }

  function normalizeMasterTest(test = {}) {
    const name = cleanText(test.name || test.testName || test.test_name || "");
    const code = cleanText(test.testCode || test.test_code || test.code || test.id || key(name).toUpperCase());
    const defaultUnit = cleanText(test.defaultUnit || test.unit || test.units || "");
    const sampleType = cleanText(test.sampleType || test.sample || test.sample_type || "");
    const ranges = Array.isArray(test.referenceRanges) && test.referenceRanges.length
      ? test.referenceRanges.map(normalizeReferenceRange)
      : legacyRangeFromText({ ...test, unit: defaultUnit });
    const rules = Array.isArray(test.interpretationRules)
      ? test.interpretationRules.map(normalizeInterpretationRule)
      : [];
    return {
      id: cleanText(test.id || test.slug || code),
      code,
      testCode: code,
      name,
      displayName: cleanText(test.displayName || test.display_name || name),
      shortName: cleanText(test.shortName || test.short_name || ""),
      department: cleanText(test.department || test.category || ""),
      category: cleanText(test.category || test.department || "Lab Test"),
      sampleType,
      sample: sampleType,
      method: cleanText(test.method || ""),
      analyzer: cleanText(test.analyzer || ""),
      resultType: RESULT_TYPES.includes(test.resultType) ? test.resultType : (test.resultType || "text"),
      decimalPlaces: test.decimalPlaces ?? test.decimal_places ?? "",
      defaultUnit,
      allowedUnits: Array.isArray(test.allowedUnits) ? test.allowedUnits.map(cleanText).filter(Boolean) : (defaultUnit ? [defaultUnit] : []),
      referenceRanges: ranges,
      interpretationRules: rules,
      generalInterpretation: cleanText(test.generalInterpretation || ""),
      clinicalNotes: cleanText(test.clinicalNotes || test.clinicalNote || ""),
      recommendation: cleanText(test.recommendation || ""),
      reportComment: cleanText(test.reportComment || test.comment || ""),
      criticalValueEnabled: Boolean(test.criticalValueEnabled),
      autoFlagEnabled: test.autoFlagEnabled !== false,
      autoInterpretationEnabled: test.autoInterpretationEnabled !== false,
      showMethodOnReport: test.showMethodOnReport !== false,
      showSampleOnReport: test.showSampleOnReport !== false,
      showInterpretationOnReport: test.showInterpretationOnReport !== false,
      showClinicalNotesOnReport: test.showClinicalNotesOnReport !== false,
      displayOrder: Number(test.displayOrder || test.sortOrder || 0),
      status: test.status || (test.isActive === false ? "inactive" : "active"),
      version: Number(test.version || 1)
    };
  }

  function conditionMatchesRange(range, patient, method, unit, reportDate) {
    if (!range.enabled) return false;
    const ageDays = ageToDays(patient, reportDate);
    const gender = normalizeGender(patient.gender || patient.patientGender || "");
    const pregnancy = String(patient.pregnancyStatus || "all").toLowerCase();
    if (range.method && method && key(range.method) !== key(method)) return false;
    if (range.unit && unit && key(range.unit) !== key(unit)) return false;
    if (range.gender !== "all" && gender !== "all" && range.gender !== gender) return false;
    if (range.pregnancyStatus !== "all" && range.pregnancyStatus !== "not_applicable" && pregnancy !== "all" && range.pregnancyStatus !== pregnancy) return false;
    if (ageDays !== null) {
      if (range.minimumAgeDays !== null && ageDays < Number(range.minimumAgeDays)) return false;
      if (range.maximumAgeDays !== null && ageDays > Number(range.maximumAgeDays)) return false;
    }
    return true;
  }

  function rangeScore(range, patient, method, unit, reportDate) {
    const ageDays = ageToDays(patient, reportDate);
    const gender = normalizeGender(patient.gender || patient.patientGender || "");
    let score = Number(range.priority || 0);
    if (range.method && method && key(range.method) === key(method)) score += 1000;
    if (range.unit && unit && key(range.unit) === key(unit)) score += 500;
    if (range.minimumAgeDays !== null || range.maximumAgeDays !== null) score += ageDays === null ? 0 : 100;
    if (range.gender !== "all" && range.gender === gender) score += 50;
    if (range.pregnancyStatus && !["all", "not_applicable"].includes(range.pregnancyStatus)) score += 25;
    return score;
  }

  function resolveReferenceRange({ test, patient = {}, method = "", unit = "", reportDate = new Date() } = {}) {
    const master = normalizeMasterTest(test);
    const ranges = master.referenceRanges.filter((range) => conditionMatchesRange(range, patient, method || master.method, unit || master.defaultUnit, reportDate));
    if (!ranges.length) {
      return {
        selectedReferenceRange: null,
        displayRange: "Reference range not configured",
        warnings: ["No matching reference range is configured."]
      };
    }
    const selected = ranges.sort((a, b) => rangeScore(b, patient, method || master.method, unit || master.defaultUnit, reportDate) - rangeScore(a, patient, method || master.method, unit || master.defaultUnit, reportDate))[0];
    const hasNumeric = selected.lowerLimit !== null || selected.upperLimit !== null;
    const displayRange = selected.textRange || (hasNumeric ? [selected.lowerLimit ?? "", selected.upperLimit ?? ""].join("-") : "Reference range not configured");
    return { selectedReferenceRange: selected, displayRange, warnings: [] };
  }

  function normalizeResultValue(value, resultType) {
    const raw = String(value ?? "").trim();
    if (["numeric", "decimal", "integer", "ratio", "percentage", "time", "calculated", "first_second_hour"].includes(resultType)) {
      if (!raw) return { normalizedResult: null, warnings: ["Result value is missing."] };
      const n = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(n)) return { normalizedResult: null, warnings: ["Numeric result is invalid."] };
      return { normalizedResult: n, warnings: [] };
    }
    return { normalizedResult: raw, warnings: [] };
  }

  function compareNumeric(value, range) {
    if (value === null || value === undefined) return { flag: "", severity: "" };
    if (range.lowerLimit !== null) {
      const lower = Number(range.lowerLimit);
      if (value < lower || (!range.lowerInclusive && value === lower)) return { flag: "L", severity: "low" };
    }
    if (range.upperLimit !== null) {
      const upper = Number(range.upperLimit);
      if (value > upper || (!range.upperInclusive && value === upper)) return { flag: "H", severity: "high" };
    }
    if (range.lowerLimit !== null || range.upperLimit !== null) return { flag: "N", severity: "normal" };
    return { flag: "", severity: "" };
  }

  function ruleMatches(rule, normalizedResult, patient, method, unit) {
    if (!rule.enabled) return false;
    if (rule.method && method && key(rule.method) !== key(method)) return false;
    if (rule.unit && unit && key(rule.unit) !== key(unit)) return false;
    const gender = normalizeGender(patient.gender || patient.patientGender || "");
    if (rule.gender !== "all" && gender !== "all" && rule.gender !== gender) return false;
    const ageDays = ageToDays(patient);
    if (ageDays !== null) {
      if (rule.minimumAgeDays !== null && ageDays < Number(rule.minimumAgeDays)) return false;
      if (rule.maximumAgeDays !== null && ageDays > Number(rule.maximumAgeDays)) return false;
    }
    const value = normalizedResult;
    const op = rule.operator;
    if (op === "less_than") return Number(value) < Number(rule.minimumValue);
    if (op === "less_than_or_equal") return Number(value) <= Number(rule.minimumValue);
    if (op === "equal") return String(value) === String(rule.qualitativeValue || rule.minimumValue);
    if (op === "not_equal") return String(value) !== String(rule.qualitativeValue || rule.minimumValue);
    if (op === "greater_than") return Number(value) > Number(rule.minimumValue);
    if (op === "greater_than_or_equal") return Number(value) >= Number(rule.minimumValue);
    if (op === "between") return Number(value) >= Number(rule.minimumValue) && Number(value) <= Number(rule.maximumValue);
    if (op === "outside_range") return Number(value) < Number(rule.minimumValue) || Number(value) > Number(rule.maximumValue);
    if (op === "contains") return String(value).toLowerCase().includes(String(rule.qualitativeValue).toLowerCase());
    if (op === "starts_with") return String(value).toLowerCase().startsWith(String(rule.qualitativeValue).toLowerCase());
    if (op === "qualitative_equals") return key(value) === key(rule.qualitativeValue);
    return false;
  }

  function generateTestInterpretation({ test, result, patient = {}, selectedRange = null, method = "", unit = "" } = {}) {
    const master = normalizeMasterTest(test);
    const warnings = [];
    const activeMethod = method || master.method;
    const activeUnit = unit || master.defaultUnit;
    const normalized = normalizeResultValue(result, master.resultType);
    warnings.push(...normalized.warnings);
    const rangeResult = selectedRange
      ? { selectedReferenceRange: selectedRange, displayRange: selectedRange.textRange || "", warnings: [] }
      : resolveReferenceRange({ test: master, patient, method: activeMethod, unit: activeUnit });
    warnings.push(...rangeResult.warnings);
    const baseFlag = rangeResult.selectedReferenceRange ? compareNumeric(normalized.normalizedResult, rangeResult.selectedReferenceRange) : { flag: "", severity: "" };
    const matchedRule = master.interpretationRules
      .filter((rule) => ruleMatches(rule, normalized.normalizedResult, patient, activeMethod, activeUnit))
      .sort((a, b) => Number(b.priority || 0) - Number(a.priority || 0))[0] || null;
    const flag = matchedRule?.flag || (master.autoFlagEnabled ? baseFlag.flag : "");
    const severity = matchedRule?.severity || baseFlag.severity || "";
    const interpretation = master.autoInterpretationEnabled
      ? (matchedRule?.interpretation || master.generalInterpretation || "")
      : "";
    return {
      normalizedResult: normalized.normalizedResult,
      selectedReferenceRange: rangeResult.selectedReferenceRange,
      displayRange: rangeResult.displayRange,
      flag,
      flagLabel: FLAG_LABELS[flag] || flag,
      severity,
      interpretation,
      clinicalNote: matchedRule?.clinicalNote || master.clinicalNotes || "",
      recommendation: matchedRule?.recommendation || master.recommendation || "",
      matchedRuleId: matchedRule?.id || "",
      warnings,
      interpretationEngineVersion: ENGINE_VERSION
    };
  }

  function validateReferenceRange(range) {
    const normalized = normalizeReferenceRange(range);
    const errors = [];
    if (normalized.lowerLimit !== null && normalized.upperLimit !== null && normalized.lowerLimit > normalized.upperLimit) errors.push("Lower limit cannot be greater than upper limit.");
    if (normalized.minimumAgeDays !== null && normalized.maximumAgeDays !== null && Number(normalized.minimumAgeDays) > Number(normalized.maximumAgeDays)) errors.push("Minimum age cannot be greater than maximum age.");
    return errors;
  }

  function migrateLegacyTestToMaster(test = {}) {
    const master = normalizeMasterTest(test);
    return {
      ...master,
      migrationStatus: master.referenceRanges.length ? "mapped_legacy_range" : "requires_lab_approval",
      approvalNote: "Requires laboratory approval before production use."
    };
  }

  return {
    ENGINE_VERSION,
    RESULT_TYPES,
    FLAG_LABELS,
    ageToDays,
    cleanText,
    normalizeMasterTest,
    normalizeReferenceRange,
    normalizeInterpretationRule,
    resolveReferenceRange,
    generateTestInterpretation,
    validateReferenceRange,
    migrateLegacyTestToMaster
  };
});
