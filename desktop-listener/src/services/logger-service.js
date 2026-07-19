"use strict";

const fs = require("fs");
const path = require("path");

class LoggerService {
  constructor(userDataPath) {
    this.logDir = path.join(userDataPath, "logs");
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
      details: meta.details || ""
    };
    this.lines.unshift(row);
    this.lines = this.lines.slice(0, 250);
    const file = path.join(this.logDir, `${row.date.slice(0, 10)}.log`);
    fs.appendFileSync(file, JSON.stringify(row) + "\n", "utf8");
  }

  recent() {
    return this.lines.slice(0, 100);
  }

  exportLogs() {
    const target = path.join(this.logDir, `khuntest-listener-export-${Date.now()}.csv`);
    const header = "Date,Level,Scope,Analyzer,Patient,Sample,Message,Details\n";
    const rows = this.lines.map((line) => [
      line.date,
      line.level,
      line.scope,
      line.analyzer,
      line.patient,
      line.sample,
      line.message,
      line.details
    ].map(csv).join(",")).join("\n");
    fs.writeFileSync(target, header + rows, "utf8");
    return { ok: true, path: target };
  }
}

function csv(value) {
  return `"${String(value || "").replace(/"/g, '""')}"`;
}

module.exports = { LoggerService };
