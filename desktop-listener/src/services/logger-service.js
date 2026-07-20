"use strict";

const fs = require("fs");
const path = require("path");

class LoggerService {
  constructor(userDataPath) {
    this.logDir = path.join(userDataPath, "logs");
    this.rawMessagesFile = path.join(this.logDir, "raw-messages.log");
    this.lines = [];
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  info(scope, message, meta = {}) {
    this.write("INFO", scope, message, meta);
  }

  warn(scope, message, meta = {}) {
    this.write("WARN", scope, message, meta);
  }

  error(scope, message, meta = {}) {
    this.write("ERROR", scope, message, meta);
  }

  write(level, scope, message, meta = {}) {
    const row = {
      date: new Date().toISOString(),
      level,
      scope,
      message: String(message || ""),
      analyzer: meta.analyzer || "",
      patient: meta.patient || "",
      sample: meta.sample || "",
      details: meta.details || "",
      rawMessage: meta.rawMessage || ""
    };
    this.lines.unshift(row);
    this.lines = this.lines.slice(0, 250);
    const file = path.join(this.logDir, `${row.date.slice(0, 10)}.log`);
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  }

  rawPacket(buffer, meta = {}) {
    const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ""), "utf8");
    const rawText = bytes.toString("utf8");
    const row = {
      date: new Date().toISOString(),
      analyzer: meta.analyzer || "",
      remote: meta.remote || "",
      mode: meta.mode || "",
      analyzerIp: meta.analyzerIp || "",
      analyzerPort: meta.analyzerPort || "",
      byteLength: bytes.length,
      hex: bytes.toString("hex"),
      rawMessage: rawText
    };
    fs.appendFileSync(this.rawMessagesFile, JSON.stringify(row) + "\n", "utf8");
    this.write("RAW", "tcp", `Received ${bytes.length} raw bytes`, {
      analyzer: row.analyzer,
      details: row.remote,
      rawMessage: rawText
    });
  }

  rawParserError(rawMessage, error, meta = {}) {
    const text = String(rawMessage || "");
    const row = {
      date: new Date().toISOString(),
      analyzer: meta.analyzer || "",
      protocol: meta.protocol || "UNKNOWN",
      parserError: String(error || ""),
      byteLength: Buffer.byteLength(text, "utf8"),
      hex: Buffer.from(text, "utf8").toString("hex"),
      rawMessage: text
    };
    fs.appendFileSync(this.rawMessagesFile, JSON.stringify(row) + "\n", "utf8");
  }

  recent() {
    return this.lines.slice(0, 100);
  }

  exportLogs() {
    const target = path.join(this.logDir, `khuntest-listener-export-${Date.now()}.csv`);
    const header = "Date,Level,Scope,Analyzer,Patient,Sample,Message,Details,RawMessage\n";
    const rows = this.lines.map((line) => [
      line.date,
      line.level,
      line.scope,
      line.analyzer,
      line.patient,
      line.sample,
      line.message,
      line.details,
      line.rawMessage
    ].map(csv).join(",")).join("\n");
    fs.writeFileSync(target, header + rows, "utf8");
    return { ok: true, path: target };
  }
}

function csv(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

module.exports = { LoggerService };
