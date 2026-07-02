"use strict";

const fs = require("fs");
const path = require("path");
const { parseHL7 } = require("./parsers/mindray-bc5000-hl7");
const { parseASTM } = require("./parsers/mindray-bc5000-astm");

function readSample(name) {
  return fs.readFileSync(path.join(__dirname, "sample-messages", name), "utf8");
}

const hl7 = parseHL7(readSample("sample-hl7.txt"));
const astm = parseASTM(readSample("sample-astm.txt"));

async function main() {
  const output = { hl7, astm };
  if (process.argv.includes("--upload")) {
    const { uploadParsedResult } = require("./server");
    output.upload = await uploadParsedResult(readSample("sample-hl7.txt"), hl7);
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
