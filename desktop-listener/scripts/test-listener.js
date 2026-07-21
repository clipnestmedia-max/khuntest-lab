"use strict";

const fs = require("fs");
const net = require("net");
const path = require("path");
const { ListenerService } = require("../src/services/listener-service");

const root = path.resolve(__dirname, "../..");
const hl7 = fs.readFileSync(path.join(root, "lis-bridge/sample-messages/sample-hl7.txt"), "utf8");

async function run() {
  await testTcpServerMode();
  await testTcpClientValidation();
  console.log(JSON.stringify({
    tcpServer: "listened without outbound createConnection and parsed inbound HL7",
    tcpClient: "blocked 0.0.0.0 destinations"
  }, null, 2));
}

async function testTcpServerMode() {
  const originalCreateConnection = net.createConnection;
  let createConnectionCalls = 0;
  const uploaded = [];
  const rawPackets = [];
  const service = serviceFor([{
    id: "server-test",
    name: "Server Test",
    model: "BC-5000",
    protocol: "HL7",
    connectionType: "LAN",
    connectionMode: "tcp-server",
    localListenerPort: 0,
    analyzerIp: "",
    analyzerPort: 5001,
    enabled: true
  }], uploaded, rawPackets);

  try {
    net.createConnection = function blockedCreateConnection() {
      createConnectionCalls += 1;
      throw new Error("TCP Server mode must not call net.createConnection.");
    };
    await service.start();
    if (createConnectionCalls !== 0) throw new Error("TCP Server mode called net.createConnection during startup.");
    if (!service.servers.size) throw new Error("TCP Server mode did not create a listening server.");
    const server = [...service.servers.values()][0];
    const address = server.address();
    if (!address || !address.port) throw new Error("TCP Server mode did not bind a local port.");
    net.createConnection = originalCreateConnection;

    const socket = net.createConnection(address.port, "127.0.0.1");
    await once(socket, "connect");
    let ack = "";
    socket.on("data", (chunk) => { ack += chunk.toString("utf8"); });
    socket.write(Buffer.from(`\x0b${hl7.trim()}\x1c\r`, "utf8"));
    await waitFor(() => uploaded.length === 1, 2500, "Inbound HL7 message was not parsed and uploaded.");
    await waitFor(() => ack.includes("MSA|AA|"), 2500, "HL7 ACK was not returned to the client.");
    if (!uploaded[0].parsed?.results?.length) throw new Error("Uploaded payload did not include parsed HL7 results.");
    if (!rawPackets.length) throw new Error("Raw message was not saved before parsing.");
    if (!uploaded[0].rawMessagePath) throw new Error("Uploaded payload did not include raw message path.");
    socket.end();
  } finally {
    net.createConnection = originalCreateConnection;
    await service.stop();
  }
}

async function testTcpClientValidation() {
  const originalCreateConnection = net.createConnection;
  let createConnectionCalls = 0;
  const service = serviceFor([{
    id: "client-test",
    name: "Client Test",
    protocol: "HL7",
    connectionType: "LAN",
    connectionMode: "tcp-client",
    analyzerIp: "0.0.0.0",
    analyzerPort: 5001,
    enabled: true
  }], []);

  try {
    net.createConnection = function blockedCreateConnection() {
      createConnectionCalls += 1;
      throw new Error("Invalid TCP Client destination must not call net.createConnection.");
    };
    await service.start();
    if (createConnectionCalls !== 0) throw new Error("TCP Client mode attempted to connect to 0.0.0.0.");
  } finally {
    net.createConnection = originalCreateConnection;
    await service.stop();
  }
}

function serviceFor(analyzers, uploaded, rawPackets = []) {
  return new ListenerService(
    { get: (key, fallback) => (key === "analyzers" ? analyzers : fallback) },
    { uploadMachineResult: async (payload) => uploaded.push(payload) },
    { enqueue: async () => {} },
    fakeLogger(rawPackets)
  );
}

function fakeLogger(rawPackets = []) {
  return {
    info() {},
    warn() {},
    error() {},
    rawPacket(buffer) {
      rawPackets.push(buffer);
      return { ok: true, binaryPath: `/tmp/raw-${rawPackets.length}.bin` };
    },
    rawParserError() {},
    rawParserOutcome() {}
  };
}

function once(emitter, event) {
  return new Promise((resolve, reject) => {
    emitter.once(event, resolve);
    emitter.once("error", reject);
  });
}

function waitFor(predicate, timeoutMs, message) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(message));
      }
    }, 25);
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
