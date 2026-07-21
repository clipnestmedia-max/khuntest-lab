"use strict";

const net = require("net");
const os = require("os");
const { parseHL7, buildAck, stripMllp } = require("../parsers/mindray-bc5000-hl7");
const { parseASTM } = require("../parsers/mindray-bc5000-astm");

const MLLP_START = 0x0b;
const MLLP_END = 0x1c;
const ASTM_CONTROL_BYTES = new Set([0x02, 0x03, 0x04, 0x05, 0x06, 0x15, 0x17]);
const MAX_RECONNECT_DELAY_MS = 30000;
const SERVER_BIND_HOST = "0.0.0.0";

function indexOfMllpEnd(buffer) {
  for (let index = 0; index < buffer.length - 1; index += 1) {
    if (buffer[index] === MLLP_END && (buffer[index + 1] === 0x0d || buffer[index + 1] === 0x0a)) return index;
  }
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === MLLP_END) return index;
  }
  return -1;
}

function extractCompleteMessages(buffer) {
  const messages = [];
  let remainder = Buffer.from(buffer || Buffer.alloc(0));

  while (remainder.length) {
    const mllpStart = remainder.indexOf(MLLP_START);
    if (mllpStart >= 0) {
      if (mllpStart > 0) remainder = remainder.slice(mllpStart);
      const mllpEnd = indexOfMllpEnd(remainder);
      if (mllpEnd < 0) break;
      const hasTrailerCr = remainder[mllpEnd + 1] === 0x0d || remainder[mllpEnd + 1] === 0x0a;
      const messageEnd = mllpEnd + (hasTrailerCr ? 2 : 1);
      messages.push(remainder.slice(0, messageEnd));
      remainder = remainder.slice(messageEnd);
      continue;
    }

    const text = remainder.toString("utf8");
    const astmTerminator = text.match(/(?:\r|\n)\d?L\|[^\r\n]*(?:\r|\n|$)/);
    const hl7LooksComplete = /(?:^|\r|\n)MSH\|/.test(text) && /(?:\r|\n)OBX\|/.test(text) && /(?:\r|\n)$/.test(text);
    if (astmTerminator || hl7LooksComplete) {
      messages.push(remainder);
      remainder = Buffer.alloc(0);
      continue;
    }
    break;
  }

  return { messages, remainder };
}

function framingType(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(String(buffer || ""), "utf8");
  if (bytes[0] === MLLP_START && bytes.includes(MLLP_END)) return "MLLP";
  if ([...bytes].some((byte) => ASTM_CONTROL_BYTES.has(byte))) return "ASTM control";
  const text = bytes.toString("utf8");
  if (/(^|\r|\n)MSH\|/.test(text)) return "Plain HL7";
  return "Unknown";
}

function localEthernetIp() {
  const interfaces = os.networkInterfaces();
  for (const rows of Object.values(interfaces)) {
    for (const row of rows || []) {
      if (row.family === "IPv4" && !row.internal) return row.address;
    }
  }
  return "Not detected";
}

function normalizeConnectionMode(value) {
  const text = String(value || "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  return text === "tcp-server" ? "tcp-server" : "tcp-client";
}

function displayConnectionMode(value) {
  return normalizeConnectionMode(value) === "tcp-server" ? "TCP Server" : "TCP Client";
}

function validAnalyzerHost(host) {
  const text = String(host || "").trim();
  return Boolean(text) && text !== SERVER_BIND_HOST;
}

class ListenerService {
  constructor(appStore, firebase, queue, logger) {
    this.appStore = appStore;
    this.firebase = firebase;
    this.queue = queue;
    this.logger = logger;
    this.servers = new Map();
    this.sockets = new Map();
    this.serverSockets = new Map();
    this.reconnectTimers = new Map();
    this.running = false;
    this.analyzerConnected = false;
    this.todayCount = 0;
    this.lastMessageAt = "";
    this.errors = [];
    this.diagnostics = {
      localPcIp: localEthernetIp(),
      analyzerIp: "10.0.0.2",
      analyzerPort: 5001,
      tcpMode: "TCP Client",
      socketState: "Listener Ready",
      lastReceivedByteTime: "",
      lastRawMessage: "",
      lastParserError: "",
      connectionInfo: "",
      listening: false,
      listeningPid: process.pid,
      bindAddress: "",
      remoteConnections: 0,
      framingType: "",
      parserSelected: "",
      parserError: "",
      firewallGuidance: "If remote connections stay at 0, allow inbound TCP 5001 in Windows Firewall."
    };
  }

  async start() {
    await this.stop();
    const analyzers = this.appStore.get("analyzers", []).filter((row) => row.enabled !== false);
    for (const analyzer of analyzers) {
      if (String(analyzer.connectionType || "LAN").toUpperCase() !== "LAN") {
        this.logger.warn("listener", `${analyzer.connectionType} is configured as a future adapter`, { analyzer: analyzer.name });
        continue;
      }
      if (this.connectionMode(analyzer) === "tcp-client") {
        await this.startTcpClient(analyzer, 0);
      } else {
        await this.startTcpServer(analyzer);
      }
    }
    this.running = this.servers.size > 0 || this.sockets.size > 0 || analyzers.length > 0;
    return this.status();
  }

  async stop() {
    const keys = new Set([...this.reconnectTimers.keys(), ...this.sockets.keys(), ...this.servers.keys(), ...this.serverSockets.keys()]);
    await Promise.allSettled([...keys].map((key) => this.stopCurrentTransport(key)));
    this.servers.clear();
    this.sockets.clear();
    this.serverSockets.clear();
    this.reconnectTimers.clear();
    this.running = false;
    this.analyzerConnected = false;
    this.updateDiagnostics({ socketState: "Listener Ready", connectionInfo: "", listening: false, bindAddress: "", remoteConnections: 0 });
  }

  async stopCurrentTransport(key) {
    const timer = this.reconnectTimers.get(key);
    if (timer) clearTimeout(timer);
    this.reconnectTimers.delete(key);

    const clientSocket = this.sockets.get(key);
    if (clientSocket) {
      clientSocket.removeAllListeners();
      clientSocket.destroy();
    }
    this.sockets.delete(key);

    const accepted = this.serverSockets.get(key);
    for (const socket of accepted || []) {
      socket.removeAllListeners();
      socket.destroy();
    }
    this.serverSockets.delete(key);

    const server = this.servers.get(key);
    if (server) {
      server.removeAllListeners("connection");
      await new Promise((resolve) => server.close(() => resolve()));
    }
    this.servers.delete(key);
  }

  async startTcpClient(analyzer, attempt) {
    const key = this.analyzerKey(analyzer);
    if (attempt === 0) await this.stopCurrentTransport(key);
    const host = this.analyzerHost(analyzer);
    const port = this.analyzerPort(analyzer);
    if (!validAnalyzerHost(host)) {
      const message = "TCP Client mode requires a valid analyzer IP. 0.0.0.0 is only allowed as a TCP Server bind host.";
      this.errors.unshift(message);
      this.updateDiagnostics({
        analyzerIp: host || "",
        analyzerPort: port,
        tcpMode: "TCP Client",
        socketState: "Disconnected",
        lastParserError: message,
        connectionInfo: ""
      });
      this.logger.error("tcp", message, { analyzer: analyzer.name, details: `${host}:${port}` });
      return;
    }
    this.updateDiagnostics({
      analyzerIp: host,
      analyzerPort: port,
      tcpMode: "TCP Client",
      socketState: attempt > 0 ? "Reconnecting" : "Connecting",
      connectionInfo: `${host}:${port}`
    });
    this.logger.info("tcp", `Connecting to ${host}:${port}`, { analyzer: analyzer.name });

    const socket = net.createConnection(port, host);
    this.sockets.set(key, socket);

    socket.on("connect", () => {
      this.analyzerConnected = true;
      this.updateDiagnostics({ socketState: "Connected", connectionInfo: `${host}:${port}` });
      this.logger.info("tcp", "TCP connection established", { analyzer: analyzer.name, details: `${host}:${port}` });
      this.handleSocket(socket, analyzer, { mode: "TCP Client", remote: `${host}:${port}` });
      this.updateDiagnostics({ socketState: "Waiting for Analyzer" });
    });

    socket.on("error", (err) => {
      this.errors.unshift(err.message);
      this.updateDiagnostics({ lastParserError: "", socketState: "Disconnected" });
      this.logger.error("tcp", err.message, { analyzer: analyzer.name, details: `${host}:${port}` });
    });

    socket.on("close", () => {
      this.sockets.delete(key);
      this.analyzerConnected = false;
      this.updateDiagnostics({ socketState: "Disconnected" });
      this.logger.info("tcp", "Analyzer disconnected", { analyzer: analyzer.name, details: `${host}:${port}` });
      if (this.running && analyzer.reconnectAutomatically !== false) this.scheduleReconnect(analyzer, attempt + 1);
    });
  }

  scheduleReconnect(analyzer, attempt) {
    const key = this.analyzerKey(analyzer);
    if (this.reconnectTimers.has(key)) return;
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 1000 * Math.pow(2, Math.max(0, attempt - 1)));
    this.updateDiagnostics({ socketState: "Reconnecting" });
    this.logger.warn("tcp", `Reconnecting in ${Math.round(delay / 1000)}s`, {
      analyzer: analyzer.name,
      details: `${this.analyzerHost(analyzer)}:${this.analyzerPort(analyzer)}`
    });
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(key);
      if (this.running) this.startTcpClient(analyzer, attempt).catch((err) => {
        this.errors.unshift(err.message);
        this.logger.error("tcp", err.message, { analyzer: analyzer.name });
      });
    }, delay);
    this.reconnectTimers.set(key, timer);
  }

  startTcpServer(analyzer) {
    return new Promise((resolve, reject) => {
      const key = this.analyzerKey(analyzer);
      this.stopCurrentTransport(key).then(() => {
      const host = SERVER_BIND_HOST;
      const port = this.localListenerPort(analyzer);
      this.logger.info("tcp", "TCP server created", { analyzer: analyzer.name, details: `${host}:${port}` });
      const server = net.createServer((socket) => {
        this.analyzerConnected = true;
        if (!this.serverSockets.has(key)) this.serverSockets.set(key, new Set());
        this.serverSockets.get(key).add(socket);
        this.updateDiagnostics({
          analyzerIp: socket.remoteAddress || this.analyzerHost(analyzer),
          analyzerPort: socket.remotePort || this.analyzerPort(analyzer),
          tcpMode: "TCP Server",
          socketState: "Analyzer Connected",
          connectionInfo: `${socket.remoteAddress}:${socket.remotePort}`,
          remoteConnections: this.remoteConnectionCount()
        });
        this.logger.info("tcp", `Analyzer connected from ${socket.remoteAddress}:${socket.remotePort}`, {
          analyzer: analyzer.name,
          details: `${socket.remoteAddress}:${socket.remotePort}`
        });
        socket.on("close", () => {
          this.serverSockets.get(key)?.delete(socket);
          this.analyzerConnected = this.remoteConnectionCount() > 0;
          this.updateDiagnostics({
            socketState: this.analyzerConnected ? "Analyzer Connected" : "Waiting for Analyzer",
            remoteConnections: this.remoteConnectionCount()
          });
          this.logger.info("tcp", "Socket closed", { analyzer: analyzer.name, details: `${socket.remoteAddress}:${socket.remotePort}` });
        });
        socket.on("error", (err) => {
          this.errors.unshift(err.message);
          this.updateDiagnostics({ socketState: "Error", lastParserError: err.message, parserError: err.message });
          this.logger.error("tcp", "Socket error", { analyzer: analyzer.name, details: `${socket.remoteAddress}:${socket.remotePort}; ${err.message}` });
        });
        this.handleSocket(socket, analyzer, { mode: "TCP Server", remote: `${socket.remoteAddress}:${socket.remotePort}` });
      });
      server.on("error", (err) => {
        this.errors.unshift(err.message);
        this.updateDiagnostics({ socketState: "Error", listening: false });
        this.logger.error("tcp", err.message, { analyzer: analyzer.name });
        reject(err);
      });
      server.listen(port, host, () => {
        this.updateDiagnostics({
          analyzerIp: this.analyzerHost(analyzer),
          analyzerPort: this.analyzerPort(analyzer),
          tcpMode: "TCP Server",
          socketState: "Waiting for Analyzer",
          connectionInfo: `${host}:${port}`,
          listening: true,
          listeningPid: process.pid,
          bindAddress: `${host}:${port}`,
          remoteConnections: this.remoteConnectionCount()
        });
        this.logger.info("tcp", `Listening on ${host}:${port}`, { analyzer: analyzer.name });
        this.servers.set(key, server);
        resolve();
      });
      }).catch(reject);
    });
  }

  handleSocket(socket, analyzer, context = {}) {
    let buffer = Buffer.alloc(0);
    let handling = false;

    socket.on("data", async (chunk) => {
      const remote = context.remote || `${socket.remoteAddress}:${socket.remotePort}`;
      const firstByte = new Date().toISOString();
      const detectedProtocol = this.detectProtocol(chunk);
      const framing = framingType(chunk);
      this.updateDiagnostics({
        socketState: "Receiving Data",
        lastReceivedByteTime: firstByte,
        lastRawMessage: this.rawText(chunk),
        connectionInfo: remote,
        tcpMode: context.mode || displayConnectionMode(this.connectionMode(analyzer)),
        framingType: framing,
        parserSelected: detectedProtocol,
        remoteConnections: this.remoteConnectionCount()
      });
      this.logger.info("tcp", "First byte received", { analyzer: analyzer.name, details: firstByte });
      this.logger.rawPacket(chunk, {
        analyzer: analyzer.name,
        remote,
        mode: context.mode || displayConnectionMode(this.connectionMode(analyzer)),
        analyzerIp: this.analyzerHost(analyzer),
        analyzerPort: this.analyzerPort(analyzer),
        framing,
        protocol: detectedProtocol
      });
      this.logger.info("tcp", "Raw bytes received", {
        analyzer: analyzer.name,
        details: `${chunk.length} bytes from ${remote}`,
        rawMessage: this.rawText(chunk)
      });
      buffer = Buffer.concat([buffer, chunk]);
      const extracted = extractCompleteMessages(buffer);
      buffer = extracted.remainder;
      if (!extracted.messages.length) return;
      handling = true;
      for (const rawMessage of extracted.messages) {
        const protocol = this.detectProtocol(rawMessage);
        this.updateDiagnostics({ socketState: "Parsing", framingType: framingType(rawMessage), parserSelected: protocol });
        this.logger.info("message", "Message framing detected", { analyzer: analyzer.name, details: framingType(rawMessage) });
        this.logger.info("message", `Detected protocol: ${protocol}`, { analyzer: analyzer.name, details: protocol });
        if (protocol === "HL7" && analyzer.sendAck !== false && analyzer.ackMode === "immediate") {
          socket.write(buildAck(rawMessage, "AA"));
          this.logger.info("tcp", "ACK sent", { analyzer: analyzer.name, details: "AA immediate" });
        }
        const result = await this.handleMessage(rawMessage, analyzer, { remote, mode: context.mode });
        if (protocol === "HL7" && analyzer.sendAck !== false && analyzer.ackMode !== "immediate") {
          socket.write(buildAck(rawMessage, result.ok ? "AA" : "AE"));
          this.logger.info("tcp", "ACK sent", { analyzer: analyzer.name, details: result.ok ? "AA" : "AE" });
        }
      }
      handling = false;
      if (!socket.destroyed) this.updateDiagnostics({ socketState: "Waiting for Analyzer" });
    });

    socket.on("close", async () => {
      this.analyzerConnected = false;
      if (buffer.length && !handling) {
        const rawMessage = buffer;
        buffer = Buffer.alloc(0);
        this.logger.warn("tcp", "Socket closed with buffered data; parsing remaining bytes", {
          analyzer: analyzer.name,
          details: `${rawMessage.length} bytes`,
          rawMessage: rawMessage.toString("utf8")
        });
        await this.handleMessage(rawMessage, analyzer, { mode: context.mode, remote: context.remote });
      }
    });
  }

  async handleMessage(rawMessage, analyzer, context = {}) {
    const rawText = this.rawText(rawMessage);
    const protocol = this.detectProtocol(rawMessage);
    this.updateDiagnostics({ lastRawMessage: rawText });
    try {
      this.logger.info("message", `Detected ${protocol} analyzer message`, {
        analyzer: analyzer.name,
        details: `${Buffer.byteLength(rawText, "utf8")} bytes`,
        rawMessage: rawText
      });
      const parsed = this.parseMessage(rawMessage, analyzer);
      this.logger.info("message", `${protocol} parsed`, {
        analyzer: analyzer.name,
        patient: parsed.patientName,
        sample: parsed.sampleId,
        details: `${parsed.results.length} results`
      });
      const payload = { rawMessage: rawText, parsed, analyzer, receivedAt: new Date().toISOString() };
      try {
        await this.firebase.uploadMachineResult(payload);
        this.logger.info("firebase", "Firestore upload success", {
          analyzer: analyzer.name,
          sample: parsed.sampleId,
          details: context.remote || ""
        });
      } catch (err) {
        await this.queue.enqueue(payload, err.message);
        this.logger.error("firebase", "Firestore upload failure", {
          analyzer: analyzer.name,
          sample: parsed.sampleId,
          details: err.message,
          rawMessage: rawText
        });
      }
      this.bumpTodayCount();
      this.lastMessageAt = new Date().toISOString();
      this.updateDiagnostics({ lastParserError: "", parserError: "", socketState: "Uploaded" });
      this.logger.info("message", "Imported analyzer result", {
        analyzer: analyzer.name,
        patient: parsed.patientName,
        sample: parsed.sampleId,
        details: `${parsed.results.length} results`
      });
      return { ok: true, parsed };
    } catch (err) {
      this.errors.unshift(err.message);
      this.updateDiagnostics({ lastParserError: err.message, parserError: err.message, socketState: "Error" });
      this.logger.rawParserError(rawText, err.message, {
        analyzer: analyzer.name,
        protocol,
        remote: context.remote || ""
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
    const bytes = Buffer.isBuffer(message) ? message : Buffer.from(String(message || ""), "utf8");
    if ([...bytes].some((byte) => ASTM_CONTROL_BYTES.has(byte)) && !/(^|\r|\n)MSH\|/.test(this.rawText(message))) return "ASTM";
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
    if (this.connectionMode(analyzer) === "tcp-server") return this.testServerBind(analyzer);
    const host = this.analyzerHost(analyzer);
    const port = this.analyzerPort(analyzer);
    if (!validAnalyzerHost(host)) {
      return { ok: false, message: "TCP Client mode requires a valid analyzer IP. 0.0.0.0 is only allowed for TCP Server bind." };
    }
    return new Promise((resolve) => {
      const socket = net.createConnection(port, host);
      socket.setTimeout(3500);
      socket.on("connect", () => {
        socket.end();
        resolve({ ok: true, message: `TCP client can reach ${host}:${port}. Start Listener keeps the persistent socket open.` });
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve({ ok: false, message: `Connection to ${host}:${port} timed out.` });
      });
      socket.on("error", (err) => resolve({ ok: false, message: err.message }));
    });
  }

  testServerBind(analyzer) {
    const port = this.localListenerPort(analyzer);
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once("error", (err) => resolve({ ok: false, message: `Cannot bind TCP Server on ${SERVER_BIND_HOST}:${port}: ${err.message}` }));
      server.listen(port, SERVER_BIND_HOST, () => {
        server.close(() => resolve({ ok: true, message: `TCP Server can listen on ${SERVER_BIND_HOST}:${port}. Start Listener will wait for the analyzer to connect inbound.` }));
      });
    });
  }

  connectionMode(analyzer = {}) {
    return normalizeConnectionMode(analyzer.connectionMode || (analyzer.id === "mindray-bc5000" ? "tcp-client" : "tcp-server"));
  }

  analyzerHost(analyzer = {}) {
    return String(analyzer.analyzerIp || "").trim();
  }

  analyzerPort(analyzer = {}) {
    return Number(analyzer.analyzerPort ?? analyzer.port ?? 5001);
  }

  localListenerPort(analyzer = {}) {
    return Number(analyzer.localListenerPort ?? analyzer.localPort ?? analyzer.port ?? 5001);
  }

  remoteConnectionCount() {
    return [...this.serverSockets.values()].reduce((total, sockets) => total + sockets.size, 0);
  }

  analyzerKey(analyzer = {}) {
    return analyzer.id || analyzer.name || "analyzer";
  }

  updateDiagnostics(next) {
    this.diagnostics = { ...this.diagnostics, localPcIp: localEthernetIp(), ...next };
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
      errors: this.errors.slice(0, 10),
      ...this.diagnostics
    };
  }
}

module.exports = { ListenerService, extractCompleteMessages, normalizeConnectionMode };
