"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const net = require("net");
const express = require("express");
const admin = require("firebase-admin");
const { parseHL7, buildAck, stripMllp } = require("./parsers/mindray-bc5000-hl7");
const { parseASTM } = require("./parsers/mindray-bc5000-astm");

const PORT = Number(process.env.PORT || 5001);
const HTTP_PORT = Number(process.env.HTTP_PORT || 5050);
const ENABLE_TCP = process.env.ENABLE_TCP !== "false";
const ENABLE_HTTP_TEST_PAGE = process.env.ENABLE_HTTP_TEST_PAGE !== "false";
const CONFIGURED_PROTOCOL = String(process.env.PROTOCOL || "HL7").toUpperCase();
const RAW_DIR = path.join(__dirname, "raw-messages");

function ensureRawDir() {
  fs.mkdirSync(RAW_DIR, { recursive: true });
}

function initFirebase() {
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
  const absolutePath = path.resolve(__dirname, serviceAccountPath);
  if (!fs.existsSync(absolutePath)) {
    console.warn(`[firebase] Service account not found at ${absolutePath}. Running parse-only mode.`);
    return null;
  }
  const serviceAccount = require(absolutePath);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id
  });
  console.log("[firebase] Connected to project", process.env.FIREBASE_PROJECT_ID || serviceAccount.project_id);
  return admin.firestore();
}

const db = initFirebase();

function detectProtocol(message) {
  const clean = stripMllp(message).trim();
  if (clean.startsWith("MSH|")) return "HL7";
  if (/^H\|/m.test(clean) || /^P\|/m.test(clean) || /^O\|/m.test(clean)) return "ASTM";
  return "UNKNOWN";
}

function parseMessage(rawMessage) {
  const protocol = detectProtocol(rawMessage);
  if (protocol === "HL7") return parseHL7(rawMessage);
  if (protocol === "ASTM") return parseASTM(rawMessage);
  throw new Error("Unsupported or unrecognized analyzer message format.");
}

function mapMachineResultsToReport(parsed) {
  return (parsed.results || []).map((row) => ({
    category: "HAEMATOLOGY",
    testName: "COMPLETE BLOOD COUNT(CBC)",
    parameterName: row.khunTestName || row.name || row.code || "Result",
    resultValue: row.value || "",
    normalRange: row.normalRange || "",
    unit: row.unit || "",
    method: "Machine: Mindray BC-5000",
    sample: "W.B. EDTA",
    abnormalFlag: row.abnormalFlag || "",
    code: row.code || "",
    source: "machine"
  }));
}

async function findBooking(parsed) {
  if (!db) return null;
  const candidates = [parsed.billNo, parsed.sampleId].filter(Boolean).map(String);
  for (const value of candidates) {
    const byBill = await db.collection("bookings").where("billNo", "==", value).limit(1).get();
    if (!byBill.empty) return { id: byBill.docs[0].id, ...byBill.docs[0].data() };
  }
  return null;
}

async function saveRawMessage(rawMessage, reason = "received") {
  ensureRawDir();
  const filename = `${Date.now()}-${reason}.txt`;
  const filePath = path.join(RAW_DIR, filename);
  fs.writeFileSync(filePath, rawMessage, "utf8");
  return filePath;
}

async function uploadParsedResult(rawMessage, parsed) {
  if (!db) {
    return { parseOnly: true, parsed };
  }

  const booking = await findBooking(parsed);
  const machineDoc = {
    source: "Mindray BC-5000",
    analyzerModel: "BC-5000",
    protocol: parsed.protocol || detectProtocol(rawMessage),
    sampleId: parsed.sampleId || "",
    billNo: parsed.billNo || parsed.sampleId || "",
    patientName: parsed.patientName || "",
    patientId: parsed.patientId || "",
    testDate: parsed.testDate || "",
    analyzerName: parsed.analyzerName || "Mindray BC-5000",
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
    status: "received",
    matchStatus: booking ? "matched" : "unmatched",
    bookingId: booking?.id || "",
    rawMessage,
    parsedResults: parsed.results || []
  };
  const machineRef = await db.collection("machineResults").add(machineDoc);

  if (booking) {
    const billNo = booking.billNo || parsed.billNo || parsed.sampleId || "";
    const reportDraft = {
      billNo,
      bookingId: booking.id,
      patientName: booking.patientName || parsed.patientName || "",
      patientEmail: booking.patientEmail || booking.email || "",
      phone: booking.phone || "",
      whatsapp: booking.whatsapp || booking.phone || "",
      age: booking.age || "",
      gender: booking.gender || "",
      doctor: booking.doctor || "",
      refBy: booking.refBy || booking.doctor || "",
      collectionDate: booking.collDate || booking.collectionDate || booking.date || "",
      reportingDate: new Date().toISOString(),
      tests: booking.selectedTests || booking.tests || [{
        testCode: "CBC",
        name: "COMPLETE BLOOD COUNT(CBC)",
        category: "HAEMATOLOGY"
      }],
      selectedTests: booking.selectedTests || booking.tests || [],
      results: mapMachineResultsToReport(parsed),
      reportStatus: "Draft",
      status: "Draft",
      source: "machine",
      machineResultId: machineRef.id,
      machineImportedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection("reports").doc(String(billNo)).set(reportDraft, { merge: true });
    await db.collection("bookings").doc(booking.id).set({
      status: "Report Entry",
      machineResultReceived: true,
      machineResultId: machineRef.id,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    await machineRef.set({ reportBillNo: billNo }, { merge: true });
  }

  return { machineResultId: machineRef.id, matched: Boolean(booking), bookingId: booking?.id || "" };
}

async function handleAnalyzerMessage(rawMessage) {
  const rawSavedTo = await saveRawMessage(rawMessage, "received");
  try {
    const parsed = parseMessage(rawMessage);
    const saved = await uploadParsedResult(rawMessage, parsed);
    console.log("[message] parsed", parsed.protocol, "sample", parsed.sampleId, "results", parsed.results.length, "raw", rawSavedTo, saved);
    return { ok: true, parsed, saved, rawSavedTo };
  } catch (err) {
    console.error("[message] parse failed:", err.message, "raw saved:", rawSavedTo);
    return { ok: false, error: err.message, rawSavedTo };
  }
}

function startTcpServer() {
  const server = net.createServer((socket) => {
    console.log("[tcp] analyzer connected", socket.remoteAddress, socket.remotePort);
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      const hasMllpEnd = buffer.includes("\x1c\r") || buffer.includes("\x1c\n");
      const looksComplete = hasMllpEnd || (!buffer.startsWith("\x0b") && /\rOBX\|/.test(buffer));
      if (!looksComplete) return;
      const raw = buffer;
      buffer = "";
      const result = await handleAnalyzerMessage(raw);
      if (detectProtocol(raw) === "HL7") socket.write(buildAck(raw, result.ok ? "AA" : "AE"));
    });

    socket.on("error", (err) => console.error("[tcp] socket error:", err.message));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[tcp] Mindray HL7 receiver listening on 0.0.0.0:${PORT}`);
  });
}

function startHttpTestPage() {
  const app = express();
  app.use(express.urlencoded({ extended: true, limit: "2mb" }));
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.type("html").send(`<!doctype html>
<html><head><title>KHUNTEST LABS LIS Bridge</title><style>body{font-family:Arial;margin:24px;max-width:980px}textarea{width:100%;height:360px}button{padding:10px 16px;font-weight:700}</style></head>
<body><h1>KHUNTEST LABS LIS Bridge Test Parser</h1><p>Paste fake/demo HL7 or ASTM text only. Received raw messages are stored locally under raw-messages/ and ignored by Git.</p>
<form method="post" action="/parse"><textarea name="message" placeholder="Paste HL7 or ASTM message"></textarea><br><br><button>Parse and Upload Draft</button></form></body></html>`);
  });

  app.post("/parse", async (req, res) => {
    const message = req.body.message || "";
    const result = await handleAnalyzerMessage(message);
    res.json(result);
  });

  app.listen(HTTP_PORT, "127.0.0.1", () => {
    console.log(`[http] Manual paste test page at http://127.0.0.1:${HTTP_PORT}`);
  });
}

if (require.main === module) {
  if (ENABLE_TCP) startTcpServer();
  if (ENABLE_HTTP_TEST_PAGE) startHttpTestPage();
  console.log(`[config] Preferred analyzer protocol: ${CONFIGURED_PROTOCOL}`);

  if (process.env.SERIAL_PORT_PATH) {
    console.warn("[serial] SERIAL_PORT_PATH is set, but serial mode is intentionally a future hook. Use LAN/HL7 first; add a vetted serial library only after confirming analyzer configuration.");
  }
}

module.exports = {
  detectProtocol,
  parseMessage,
  uploadParsedResult,
  handleAnalyzerMessage,
  mapMachineResultsToReport
};
