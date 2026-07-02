"use strict";

const CBC_CODE_MAP = {
  WBC: "WBC Count",
  "NEU#": "Neutrophils Absolute",
  "LYM#": "Lymphocytes Absolute",
  "MON#": "Monocytes Absolute",
  "EOS#": "Eosinophils Absolute",
  "BAS#": "Basophils Absolute",
  "NEU%": "Neutrophils",
  "LYM%": "Lymphocytes",
  "MON%": "Monocytes",
  "EOS%": "Eosinophils",
  "BAS%": "Basophils",
  RBC: "RBC Count",
  HGB: "Haemoglobin",
  HCT: "PCV/HCT",
  MCV: "MCV",
  MCH: "MCH",
  MCHC: "MCHC",
  "RDW-CV": "RDW-CV",
  "RDW-SD": "RDW-SD",
  PLT: "Platelet Count",
  MPV: "MPV",
  PDW: "PDW",
  PCT: "PCT",
  "P-LCR": "P-LCR",
  "P-LCC": "P-LCC"
};

function stripMllp(message = "") {
  return String(message).replace(/^\x0b/, "").replace(/\x1c\r?\s*$/, "").trim();
}

function normalizeCode(value = "") {
  return String(value).split("^").find(Boolean)?.trim() || "";
}

function parsePatientName(field = "") {
  const parts = String(field).split("^").filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return [parts[1], parts[2], parts[0]].filter(Boolean).join(" ").trim();
}

function parseHl7Date(value = "") {
  const text = String(value || "");
  if (!/^\d{8}/.test(text)) return text;
  const y = text.slice(0, 4);
  const m = text.slice(4, 6);
  const d = text.slice(6, 8);
  const hh = text.slice(8, 10) || "00";
  const mm = text.slice(10, 12) || "00";
  const ss = text.slice(12, 14) || "00";
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}`;
}

function parseHL7(rawMessage) {
  const raw = stripMllp(rawMessage);
  const segments = raw.split(/\r\n|\n|\r/).map((line) => line.trim()).filter(Boolean);
  const parsed = {
    protocol: "HL7",
    source: "Mindray BC-5000",
    analyzerModel: "BC-5000",
    sampleId: "",
    billNo: "",
    patientName: "",
    patientId: "",
    testDate: "",
    analyzerName: "",
    results: [],
    segments
  };

  for (const segment of segments) {
    const fields = segment.split("|");
    const type = fields[0];
    if (type === "MSH") {
      parsed.analyzerName = fields[2] || fields[3] || "Mindray BC-5000";
      parsed.testDate = parseHl7Date(fields[6] || "");
    }
    if (type === "PID") {
      parsed.patientId = fields[3] || fields[2] || "";
      parsed.patientName = parsePatientName(fields[5] || "");
    }
    if (type === "OBR") {
      parsed.sampleId = fields[3] || fields[2] || parsed.sampleId;
      parsed.billNo = parsed.sampleId;
      parsed.testDate = parseHl7Date(fields[7] || fields[6] || parsed.testDate);
    }
    if (type === "OBX") {
      const codeField = fields[3] || "";
      const code = normalizeCode(codeField);
      const nameFromMessage = codeField.split("^").filter(Boolean)[1] || code;
      parsed.results.push({
        code,
        name: CBC_CODE_MAP[code] || nameFromMessage || code,
        value: fields[5] || "",
        unit: fields[6] || "",
        normalRange: fields[7] || "",
        abnormalFlag: fields[8] || ""
      });
    }
  }

  return parsed;
}

function buildAck(rawMessage, ackCode = "AA") {
  const raw = stripMllp(rawMessage);
  const msh = raw.split(/\r\n|\n|\r/).find((line) => line.startsWith("MSH|")) || "";
  const fields = msh.split("|");
  const sendingApp = fields[2] || "MINDRAY";
  const sendingFacility = fields[3] || "";
  const receivingApp = fields[4] || "KHUNTEST-LIS";
  const receivingFacility = fields[5] || "";
  const controlId = fields[9] || String(Date.now());
  const now = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const ack = [
    `MSH|^~\\&|${receivingApp}|${receivingFacility}|${sendingApp}|${sendingFacility}|${now}||ACK^R01|ACK${controlId}|P|2.3.1`,
    `MSA|${ackCode}|${controlId}`
  ].join("\r");
  return `\x0b${ack}\x1c\r`;
}

module.exports = {
  CBC_CODE_MAP,
  parseHL7,
  buildAck,
  stripMllp
};
