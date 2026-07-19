"use strict";

const fs = require("fs");
const path = require("path");
const { parseHL7 } = require("../src/parsers/mindray-bc5000-hl7");
const { parseASTM } = require("../src/parsers/mindray-bc5000-astm");

const root = path.resolve(__dirname, "../..");
const hl7 = fs.readFileSync(path.join(root, "lis-bridge/sample-messages/sample-hl7.txt"), "utf8");
const astm = fs.readFileSync(path.join(root, "lis-bridge/sample-messages/sample-astm.txt"), "utf8");

const hl7Parsed = parseHL7(hl7);
const astmParsed = parseASTM(astm);

if (!hl7Parsed.results.length) throw new Error("HL7 parser returned no results.");
if (!astmParsed.results.length) throw new Error("ASTM parser returned no results.");

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
  }
}, null, 2));
