"use strict";

const fs = require("fs");
const path = require("path");
const { parseHL7 } = require("../src/parsers/mindray-bc5000-hl7");
const { parseASTM } = require("../src/parsers/mindray-bc5000-astm");
const { extractCompleteMessages } = require("../src/services/listener-service");
const { deterministicMachineResultId } = require("../src/services/firebase-service");

const root = path.resolve(__dirname, "../..");
const hl7 = fs.readFileSync(path.join(root, "lis-bridge/sample-messages/sample-hl7.txt"), "utf8");
const astm = fs.readFileSync(path.join(root, "lis-bridge/sample-messages/sample-astm.txt"), "utf8");

const hl7Parsed = parseHL7(hl7);
const astmParsed = parseASTM(astm);
const framedHl7 = Buffer.from(`\x0b${hl7.trim()}\x1c\r`, "utf8");
const firstFragment = framedHl7.slice(0, 18);
const secondFragment = framedHl7.slice(18);
const firstExtraction = extractCompleteMessages(firstFragment);
const secondExtraction = extractCompleteMessages(Buffer.concat([firstExtraction.remainder, secondFragment]));
const multipleExtraction = extractCompleteMessages(Buffer.concat([framedHl7, framedHl7]));
const unknownParsed = parseHL7("MSH|^~\\&|BC5000||||20260721120000||ORU^R01|U1|P|2.3.1\rOBR|1||UNK-001\rOBX|1|NM|XYZ-NEW^New Unknown Parameter||123|u|1-9|H\r");
const dedupeA = deterministicMachineResultId({ analyzerId: "mindray-bc5000", sampleId: "982", resultTimestamp: "2026-07-21T12:00:00", rawMessage: hl7 });
const dedupeB = deterministicMachineResultId({ analyzerId: "mindray-bc5000", sampleId: "982", resultTimestamp: "2026-07-21T12:00:00", rawMessage: hl7 });

if (!hl7Parsed.results.length) throw new Error("HL7 parser returned no results.");
if (!astmParsed.results.length) throw new Error("ASTM parser returned no results.");
if (firstExtraction.messages.length) throw new Error("Fragmented MLLP packet was parsed before the end block arrived.");
if (secondExtraction.messages.length !== 1) throw new Error("Complete fragmented MLLP packet was not extracted.");
if (secondExtraction.remainder.length) throw new Error("Complete MLLP packet left unexpected buffered bytes.");
if (!parseHL7(secondExtraction.messages[0]).results.length) throw new Error("Extracted MLLP HL7 message did not parse.");
if (multipleExtraction.messages.length !== 2) throw new Error("Multiple MLLP messages were not extracted independently.");
if (unknownParsed.results[0]?.code !== "XYZ-NEW") throw new Error("Unknown OBX code was not preserved.");
if (dedupeA !== dedupeB) throw new Error("Machine result de-duplication key is not deterministic.");

console.log(JSON.stringify({
  hl7: {
    protocol: hl7Parsed.protocol,
    sampleId: hl7Parsed.sampleId,
    results: hl7Parsed.results.length
  },
  astm: {
    protocol: astmParsed.protocol,
    sampleId: astmParsed.sampleId,
    results: astmParsed.results.length
  },
  mllp: {
    fragmentedMessages: secondExtraction.messages.length,
    multipleMessages: multipleExtraction.messages.length
  },
  unknownObx: unknownParsed.results[0].code,
  dedupeStable: dedupeA === dedupeB
}, null, 2));
