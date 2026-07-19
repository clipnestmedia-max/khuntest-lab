"use strict";

const { CBC_CODE_MAP } = require("./mindray-bc5000-hl7");

function cleanFrame(message = "") {
  return String(message).replace(/[\x02\x03\x04\x05\x06\x15\x17]/g, "").replace(/\r\n/g, "\r").trim();
}

function parseASTM(rawMessage, analyzer = {}) {
  const raw = cleanFrame(rawMessage);
  const records = raw.split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
  const parsed = {
    protocol: "ASTM",
    analyzer: analyzer.name || "Mindray BC-5000",
    source: analyzer.name || "Mindray BC-5000",
    analyzerModel: analyzer.model || "BC-5000",
    sampleId: "",
    billNo: "",
    patientName: "",
    patientId: "",
    testDate: "",
    analyzerName: analyzer.name || "Mindray BC-5000",
    results: [],
    rawMessage: raw,
    records
  };

  for (const record of records) {
    const fields = record.split("|");
    const type = fields[0];
    if (type === "H") parsed.analyzerName = fields[4] || parsed.analyzerName;
    if (type === "P") {
      parsed.patientId = fields[2] || "";
      parsed.patientName = String(fields[5] || "").replace(/\^/g, " ").trim();
    }
    if (type === "O") {
      parsed.sampleId = fields[2] || fields[3] || parsed.sampleId;
      parsed.billNo = parsed.sampleId;
      parsed.testDate = fields[6] || parsed.testDate;
    }
    if (type === "R") {
      const codeRaw = fields[2] || "";
      const code = codeRaw.split("^").filter(Boolean).pop() || codeRaw;
      parsed.results.push({
        code,
        name: code,
        khunTestName: CBC_CODE_MAP[code] || code,
        value: fields[3] || "",
        unit: fields[4] || "",
        normalRange: fields[5] || "",
        abnormalFlag: fields[6] || ""
      });
    }
  }

  return parsed;
}

module.exports = { parseASTM };
