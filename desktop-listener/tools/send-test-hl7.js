"use strict";

const net = require("net");

const host = process.argv[2] || "127.0.0.1";
const port = Number(process.argv[3] || 5001);

const segments = [
  "MSH|^~\\&|MINDRAY|BC5000|KHUNTEST-LIS|KHUNTEST|20260721120000||ORU^R01|TEST-BC5000-001|P|2.3.1",
  "PID|1||TEST-PID-001||PATIENT^TEST||19900101|U",
  "OBR|1|TEST-BC5000-001|TEST-BC5000-001|CBC^Complete Blood Count|||20260721115900|||||||||||||||||||||TEST",
  "OBX|1|NM|WBC^WBC Count||7.2|10^9/L|4.0-10.0|N",
  "OBX|2|NM|RBC^RBC Count||4.81|10^12/L|4.00-5.50|N",
  "OBX|3|NM|HGB^Haemoglobin||13.8|g/dL|12.0-16.0|N",
  "OBX|4|NM|HCT^Hematocrit||41.4|%|36-46|N",
  "OBX|5|NM|MCV^MCV||86.1|fL|80-100|N",
  "OBX|6|NM|MCH^MCH||28.7|pg|27-33|N",
  "OBX|7|NM|MCHC^MCHC||33.3|g/dL|32-36|N",
  "OBX|8|NM|PLT^Platelet Count||245|10^9/L|150-450|N",
  "OBX|9|NM|Neu#^Neutrophils Absolute||4.2|10^9/L|2.0-7.0|N",
  "OBX|10|NM|Lym#^Lymphocytes Absolute||2.1|10^9/L|1.0-3.0|N",
  "OBX|11|NM|Neu%^Neutrophils||58.3|%|40-75|N",
  "OBX|12|NM|Lym%^Lymphocytes||29.2|%|20-45|N"
];

const payload = Buffer.from(`\x0b${segments.join("\r")}\x1c\r`, "utf8");
const socket = net.createConnection({ host, port });
let ack = Buffer.alloc(0);

socket.setTimeout(5000);
socket.on("connect", () => {
  socket.write(payload);
  console.log(`Sent dummy Mindray-like CBC HL7 MLLP message to ${host}:${port}`);
});
socket.on("data", (chunk) => {
  ack = Buffer.concat([ack, chunk]);
  console.log(`Received ACK bytes: ${chunk.length}`);
  console.log(chunk.toString("utf8").replace(/\x0b/g, "\\x0b").replace(/\x1c/g, "\\x1c").replace(/\r/g, "\\r"));
  socket.end();
});
socket.on("timeout", () => {
  console.error("Timed out waiting for connection or ACK.");
  socket.destroy();
  process.exitCode = 1;
});
socket.on("error", (err) => {
  console.error(err.message);
  process.exitCode = 1;
});
socket.on("close", () => {
  if (!ack.length) console.log("Connection closed without ACK.");
});
