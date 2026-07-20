"use strict";

const net = require("net");
const { parseHL7, buildAck, stripMllp } = require("../parsers/mindray-bc5000-hl7");
const { parseASTM } = require("../parsers/mindray-bc5000-astm");

class ListenerService {
  constructor(appStore, firebase, queue, logger) {
    this.appStore = appStore;
    this.firebase = firebase;
    this.queue = queue;
    this.logger = logger;
    this.servers = new Map();
    this.running = false;
    this.analyzerConnected = false;
    this.todayCount = 0;
    this.lastMessageAt = "";
    this.errors = [];
  }

  async start() {
    await this.stop();
    const analyzers = this.appStore.get("analyzers", []).filter((row) => row.enabled !== false);
    for (const analyzer of analyzers) {
      if (String(analyzer.connectionType || "LAN").toUpperCase() !== "LAN") {
        this.logger.warn("listener", `${analyzer.connectionType} is configured as a future adapter`, { analyzer: analyzer.name });
        continue;
      }
      await this.startTcp(analyzer);
    }
    this.running = this.servers.size > 0;
    return this.status();
  }

  async stop() {
    const closing = [];
    for (const server of this.servers.values()) {
      closing.push(new Promise((resolve) => server.close(resolve)));
    }
    await Promise.allSettled(closing);
    this.servers.clear();
    this.running = false;
    this.analyzerConnected = false;
  }

  startTcp(analyzer) {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.handleSocket(socket, analyzer));
      server.on("error", (err) => {
        this.errors.unshift(err.message);
        this.logger.error("tcp", err.message, { analyzer: analyzer.name });
        reject(err);
      });
      server.listen(Number(analyzer.port || 5001), analyzer.host || "0.0.0.0", () => {
        this.logger.info("tcp", `Listening on ${analyzer.host || "0.0.0.0"}:${analyzer.port || 5001}`, { analyzer: analyzer.name });
        this.servers.set(analyzer.id || analyzer.name, server);
        resolve();
      });
    });
  }

  handleSocket(socket, analyzer) {
    this.analyzerConnected = true;
    this.logger.info("tcp", "Analyzer connected", { analyzer: analyzer.name, details: `${socket.remoteAddress}:${socket.remotePort}` });
    let buffer = Buffer.alloc(0);
    let handling = false;

    socket.on("data", async (chunk) => {
      this.logger.rawPacket(chunk, {
        analyzer: analyzer.name,
        remote: `${socket.remoteAddress}:${socket.remotePort}`
      });
      buffer = Buffer.concat([buffer, chunk]);
      if (!this.messageLooksComplete(buffer)) return;
      const rawMessage = buffer;
      buffer = Buffer.alloc(0);
      handling = true;
      const result = await this.handleMessage(rawMessage, analyzer);
      handling = false;
      if (this.detectProtocol(rawMessage, analyzer) === "HL7") socket.write(buildAck(rawMessage, result.ok ? "AA" : "AE"));
    });

    socket.on("close", async () => {
      this.analyzerConnected = false;
      if (buffer.length && !handling) {
        const rawMessage = buffer;
        buffer = Buffer.alloc(0);
        this.logger.warn("tcp", "Analyzer disconnected with buffered data; parsing remaining bytes", {
          analyzer: analyzer.name,
          details: `${rawMessage.length} bytes`,
          rawMessage: rawMessage.toString("utf8")
        });
        await this.handleMessage(rawMessage, analyzer);
      }
      this.logger.info("tcp", "Analyzer disconnected", { analyzer: analyzer.name });
    });
    socket.on("error", (err) => this.logger.error("tcp", err.message, { analyzer: analyzer.name }));
  }

  messageLooksComplete(buffer) {
    const text = buffer.toString("utf8");
    return text.includes("\x1c\r")
      || text.includes("\x1c\n")
      || (!text.startsWith("\x0b") && (/\rOBX\|/.test(text) || /\r\d?L\|/.test(text) || /\n\d?L\|/.test(text)));
  }

  async handleMessage(rawMessage, analyzer) {
    const rawText = this.rawText(rawMessage);
    const protocol = this.detectProtocol(rawMessage);
    try {
      this.logger.info("message", `Detected ${protocol} analyzer message`, {
        analyzer: analyzer.name,
        details: `${Buffer.byteLength(rawText, "utf8")} bytes`,
        rawMessage: rawText
      });
      const parsed = this.parseMessage(rawMessage, analyzer);
      const payload = { rawMessage: rawText, parsed, analyzer, receivedAt: new Date().toISOString() };
      try {
        await this.firebase.uploadMachineResult(payload);
      } catch (err) {
        await this.queue.enqueue(payload, err.message);
      }
      this.bumpTodayCount();
      this.lastMessageAt = new Date().toISOString();
      this.logger.info("message", "Imported analyzer result", {
        analyzer: analyzer.name,
        patient: parsed.patientName,
        sample: parsed.sampleId,
        details: `${parsed.results.length} results`
      });
      return { ok: true, parsed };
    } catch (err) {
      this.errors.unshift(err.message);
      this.logger.rawParserError(rawText, err.message, {
        analyzer: analyzer.name,
        protocol
      });
      this.logger.error("message", "Unable to parse analyzer message", {
        analyzer: analyzer.name,
        details: `protocol=${protocol}; error=${err.message}`,
        rawMessage: rawText
      });
      return { ok: false, error: err.message };
    }
  }

  detectProtocol(message) {
    const clean = stripMllp(this.rawText(message)).replace(/[\x02\x03\x04\x05\x06\x15\x17]/g, "").trim();
    if (/(^|\r|\n)MSH\|/.test(clean)) return "HL7";
    if (/(^|\r|\n)\d?[HPOCRL]\|/.test(clean)) return "ASTM";
    return "UNKNOWN";
  }

  parseMessage(rawMessage, analyzer = {}) {
    const protocol = this.detectProtocol(rawMessage);
    if (protocol === "HL7") return parseHL7(rawMessage, analyzer);
    if (protocol === "ASTM") return parseASTM(rawMessage, analyzer);
    throw new Error("Unsupported analyzer message format. Raw data is neither HL7 nor ASTM.");
  }

  rawText(rawMessage) {
    return Buffer.isBuffer(rawMessage) ? rawMessage.toString("utf8") : String(rawMessage || "");
  }

  async testConnection(analyzer) {
    if (String(analyzer.connectionType || "LAN").toUpperCase() !== "LAN") {
      return { ok: false, message: `${analyzer.connectionType} support is prepared but requires a serial driver adapter.` };
    }
    return new Promise((resolve) => {
      const socket = net.createConnection({ host: analyzer.analyzerIp || analyzer.host || "127.0.0.1", port: Number(analyzer.port || 5001), timeout: 3500 });
      socket.on("connect", () => {
        socket.end();
        resolve({ ok: true, message: "Analyzer TCP port is reachable." });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ ok: false, message: "Connection timed out." });
      });
      socket.on("error", (err) => resolve({ ok: false, message: err.message }));
    });
  }

  bumpTodayCount() {
    const today = new Date().toISOString().slice(0, 10);
    if (this.today !== today) {
      this.today = today;
      this.todayCount = 0;
    }
    this.todayCount += 1;
  }

  status() {
    return {
      running: this.running,
      analyzerConnected: this.analyzerConnected,
      internetConnected: true,
      todayImportedReports: this.todayCount,
      lastMessageAt: this.lastMessageAt,
      errors: this.errors.slice(0, 10)
    };
  }
}

module.exports = { ListenerService };
