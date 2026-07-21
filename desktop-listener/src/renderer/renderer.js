"use strict";

let state = {};

const $ = (id) => document.getElementById(id);

document.addEventListener("DOMContentLoaded", async () => {
  bindEvents();
  state = await window.khunTest.getState();
  render(state);
  window.khunTest.onStatus((next) => {
    state = next;
    render(state);
  });
  window.khunTest.onTab((tab) => showTab(tab));
});

function bindEvents() {
  $("loginForm").addEventListener("submit", login);
  $("logoutBtn").addEventListener("click", logout);
  $("startBtn").addEventListener("click", () => window.khunTest.startListener());
  $("stopBtn").addEventListener("click", () => window.khunTest.stopListener());
  $("addAnalyzerBtn").addEventListener("click", addAnalyzer);
  $("saveAnalyzersBtn").addEventListener("click", saveAnalyzers);
  $("saveSettingsBtn").addEventListener("click", saveSettings);
  $("exportLogsBtn").addEventListener("click", exportLogs);
  $("openLogsBtn").addEventListener("click", () => window.khunTest.openLogsFolder());
  $("copyDiagnosticsBtn").addEventListener("click", copyNetworkDiagnostic);
  document.querySelectorAll(".nav").forEach((button) => button.addEventListener("click", () => showTab(button.dataset.tab)));
}

async function login(event) {
  event.preventDefault();
  $("loginMessage").textContent = "Signing in...";
  try {
    await window.khunTest.login({
      email: $("loginEmail").value.trim(),
      password: $("loginPassword").value,
      remember: $("rememberMe").checked
    });
    state = await window.khunTest.getState();
    $("loginMessage").textContent = "";
    render(state);
  } catch (err) {
    $("loginMessage").textContent = err.message || "Login failed.";
  }
}

async function logout() {
  await window.khunTest.logout();
  state = await window.khunTest.getState();
  render(state);
}

function render(next) {
  const loggedIn = Boolean(next?.firebase?.user);
  $("loginView").classList.toggle("hidden", loggedIn);
  $("appView").classList.toggle("hidden", !loggedIn);
  document.body.classList.toggle("dark", Boolean(next?.settings?.listener?.darkMode));
  if (!loggedIn) return;

  $("userEmail").textContent = next.firebase.user.email || "";
  $("firebaseStatus").textContent = next.firebase.connected ? "Yes" : "No";
  $("internetStatus").textContent = navigator.onLine ? "Yes" : "No";
  $("analyzerStatus").textContent = next.status.socketState || (next.status.analyzerConnected ? "Connected" : "Waiting");
  $("listenerStatus").textContent = next.status.running ? "Running" : "Paused";
  $("todayCount").textContent = String(next.status.todayImportedReports || 0);
  $("lastSync").textContent = formatDate(next.firebase.lastSyncTime || next.status.lastMessageAt);
  $("queueCount").textContent = `${next.queue.pending || 0} pending`;
  renderDiagnostics(next.status || {});
  renderSettings(next.settings);
  renderAnalyzers(next.settings.analyzers || []);
  renderLogs(next.logs || []);
}

function renderDiagnostics(status) {
  $("diagLocalIp").textContent = status.localPcIp || "Not detected";
  $("diagAnalyzerIp").textContent = status.analyzerIp || "10.0.0.2";
  $("diagAnalyzerPort").textContent = String(status.analyzerPort || 5001);
  $("diagTcpMode").textContent = status.tcpMode || "TCP Client";
  $("diagSocketState").textContent = status.socketState || "Disconnected";
  $("diagListening").textContent = status.listening ? "Yes" : "No";
  $("diagListeningPid").textContent = status.listeningPid ? String(status.listeningPid) : "-";
  $("diagBindAddress").textContent = status.bindAddress || "-";
  $("diagRemoteConnections").textContent = String(status.remoteConnections || 0);
  $("diagLastByte").textContent = formatDate(status.lastReceivedByteTime);
  $("diagFramingType").textContent = status.framingType || "Unknown";
  $("diagParserSelected").textContent = status.parserSelected || "Unknown";
  $("diagFirewallGuidance").textContent = status.firewallGuidance || "Allow inbound TCP 5001 if no remote traffic arrives.";
  $("diagLastRaw").textContent = truncateRaw(formatRawForDisplay(status.lastRawMessage || "None"));
  $("diagLastParserError").textContent = status.lastParserError || "None";
}

function renderSettings(settings) {
  $("projectId").value = settings.firebase.projectId || "";
  $("apiKey").value = settings.firebase.apiKey || "";
  $("labId").value = settings.lab.labId || "";
  $("autoUpdate").checked = Boolean(settings.listener.autoUpdate);
  $("darkMode").checked = Boolean(settings.listener.darkMode);
  $("autoStart").checked = Boolean(settings.listener.autoStart);
}

function renderAnalyzers(analyzers) {
  $("analyzerList").innerHTML = analyzers.map((analyzer, index) => analyzerCard(analyzer, index)).join("");
  document.querySelectorAll(".analyzer-card").forEach((card) => {
    const mode = card.querySelector('[data-field="connectionMode"]');
    mode.addEventListener("change", () => updateAnalyzerModeFields(card));
    updateAnalyzerModeFields(card);
  });
  document.querySelectorAll("[data-test-analyzer]").forEach((button) => {
    button.addEventListener("click", async () => {
      let analyzer;
      try {
        analyzer = collectAnalyzers()[Number(button.dataset.testAnalyzer)];
      } catch (err) {
        alert(err.message);
        return;
      }
      const result = await window.khunTest.testConnection(analyzer);
      alert(result.message);
    });
  });
}

function analyzerCard(analyzer, index) {
  return `<div class="analyzer-card" data-index="${index}">
    <label>Analyzer Name<input data-field="name" value="${escapeAttr(analyzer.name || "")}"></label>
    <label>Protocol<select data-field="protocol"><option ${selected(analyzer.protocol, "HL7")}>HL7</option><option ${selected(analyzer.protocol, "ASTM")}>ASTM</option></select></label>
    <label>Connection Type<select data-field="connectionType"><option ${selected(analyzer.connectionType, "LAN")}>LAN</option><option ${selected(analyzer.connectionType, "RS232")}>RS232</option><option ${selected(analyzer.connectionType, "USB Serial")}>USB Serial</option></select></label>
    <label>Connection Mode<select data-field="connectionMode"><option value="tcp-client" ${selected(normalizeMode(analyzer.connectionMode || "tcp-client"), "tcp-client")}>TCP Client</option><option value="tcp-server" ${selected(normalizeMode(analyzer.connectionMode), "tcp-server")}>TCP Server</option></select></label>
    <label data-mode-field="client">Analyzer IP<input data-field="analyzerIp" value="${escapeAttr(analyzer.analyzerIp || "10.0.0.2")}"></label>
    <label data-mode-field="client">Analyzer Port<input data-field="analyzerPort" type="number" value="${Number(analyzer.analyzerPort || analyzer.port || 5001)}"></label>
    <label data-mode-field="server">Local Listener Port<input data-field="localListenerPort" type="number" value="${Number(analyzer.localListenerPort || analyzer.localPort || analyzer.port || 5001)}"></label>
    <label class="check-row"><input data-field="sendAck" type="checkbox" ${analyzer.sendAck !== false ? "checked" : ""}>Send ACK</label>
    <label>ACK Mode<select data-field="ackMode"><option value="after-parse" ${selected(analyzer.ackMode || "after-parse", "after-parse")}>After Parse</option><option value="immediate" ${selected(analyzer.ackMode, "immediate")}>Immediate</option></select></label>
    <label class="check-row"><input data-field="reconnectAutomatically" type="checkbox" ${analyzer.reconnectAutomatically ? "checked" : ""}>Reconnect Automatically</label>
    <label class="check-row"><input data-field="enabled" type="checkbox" ${analyzer.enabled !== false ? "checked" : ""}>Enabled</label>
    <div class="full"><button class="ghost" data-test-analyzer="${index}" type="button">Test Connection</button></div>
  </div>`;
}

function addAnalyzer() {
  const analyzers = state.settings.analyzers || [];
  analyzers.push({
    id: `analyzer-${Date.now()}`,
    name: "New Analyzer",
    model: "",
    protocol: "HL7",
    connectionType: "LAN",
    connectionMode: "tcp-client",
    host: "0.0.0.0",
    analyzerIp: "10.0.0.2",
    analyzerPort: 5001,
    localListenerPort: 5001,
    localPort: 5001,
    port: 5001,
    reconnectAutomatically: true,
    enabled: true
  });
  state.settings.analyzers = analyzers;
  renderAnalyzers(analyzers);
}

async function saveAnalyzers() {
  try {
    await window.khunTest.saveSettings({ analyzers: collectAnalyzers() });
    state = await window.khunTest.getState();
    render(state);
  } catch (err) {
    alert(err.message);
  }
}

function collectAnalyzers() {
  return [...document.querySelectorAll(".analyzer-card")].map((card, index) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`);
    const mode = normalizeMode(get("connectionMode").value);
    const analyzerIp = get("analyzerIp").value.trim();
    const analyzerPort = Number(get("analyzerPort").value || 5001);
    const localListenerPort = Number(get("localListenerPort").value || 5001);
    if (mode === "tcp-client" && (!analyzerIp || analyzerIp === "0.0.0.0")) {
      throw new Error("TCP Client mode requires a valid Analyzer IP. 0.0.0.0 is allowed only as a TCP Server bind host.");
    }
    return {
      id: state.settings.analyzers?.[index]?.id || `analyzer-${index}`,
      model: state.settings.analyzers?.[index]?.model || "",
      name: get("name").value.trim(),
      protocol: get("protocol").value,
      connectionType: get("connectionType").value,
      connectionMode: mode,
      host: "0.0.0.0",
      analyzerIp: mode === "tcp-client" ? analyzerIp : "",
      analyzerPort,
      localListenerPort,
      localPort: localListenerPort,
      port: mode === "tcp-server" ? localListenerPort : analyzerPort,
      reconnectAutomatically: get("reconnectAutomatically").checked,
      sendAck: get("sendAck").checked,
      ackMode: get("ackMode").value === "immediate" ? "immediate" : "after-parse",
      enabled: get("enabled").checked
    };
  });
}

async function copyNetworkDiagnostic() {
  const status = state.status || {};
  const text = [
    `Local IP: ${status.localPcIp || "Not detected"}`,
    `Mode: ${status.tcpMode || "Unknown"}`,
    `Listening: ${status.listening ? "Yes" : "No"}`,
    `Port: ${status.analyzerPort || 5001}`,
    `Bind Address: ${status.bindAddress || "-"}`,
    `Listening PID: ${status.listeningPid || "-"}`,
    `Remote Connections: ${status.remoteConnections || 0}`,
    `Last Received Byte: ${formatDate(status.lastReceivedByteTime)}`,
    `Framing Type: ${status.framingType || "Unknown"}`,
    `Parser Selected: ${status.parserSelected || "Unknown"}`,
    `Firewall Guidance: ${status.firewallGuidance || ""}`
  ].join("\n");
  await navigator.clipboard.writeText(text);
}

function updateAnalyzerModeFields(card) {
  const mode = normalizeMode(card.querySelector('[data-field="connectionMode"]').value);
  card.querySelectorAll('[data-mode-field="client"]').forEach((label) => {
    const disabled = mode === "tcp-server";
    label.classList.toggle("hidden", disabled);
    label.querySelectorAll("input, select").forEach((input) => { input.disabled = disabled; });
  });
  card.querySelectorAll('[data-mode-field="server"]').forEach((label) => {
    const disabled = mode === "tcp-client";
    label.classList.toggle("hidden", disabled);
    label.querySelectorAll("input, select").forEach((input) => { input.disabled = disabled; });
  });
}

async function saveSettings() {
  await window.khunTest.saveSettings({
    firebase: { projectId: $("projectId").value.trim(), apiKey: $("apiKey").value.trim() },
    lab: { labId: $("labId").value.trim() },
    listener: {
      autoUpdate: $("autoUpdate").checked,
      darkMode: $("darkMode").checked,
      autoStart: $("autoStart").checked
    }
  });
  state = await window.khunTest.getState();
  render(state);
}

function renderLogs(logs) {
  $("logsBody").innerHTML = logs.map((line) => `<tr>
    <td>${escapeHtml(formatDate(line.date))}</td>
    <td>${escapeHtml(line.level)}</td>
    <td>${escapeHtml(line.scope)}</td>
    <td>${escapeHtml(line.sample)}</td>
    <td>${escapeHtml(line.message)}</td>
    <td><pre class="raw-cell">${escapeHtml(truncateRaw(formatRawForDisplay(line.rawMessage || "")))}</pre></td>
  </tr>`).join("") || `<tr><td colspan="6">No logs yet.</td></tr>`;
}

async function exportLogs() {
  const result = await window.khunTest.exportLogs();
  alert(result.path ? `Exported to ${result.path}` : "Export failed.");
}

function showTab(tab) {
  document.querySelectorAll(".nav").forEach((button) => button.classList.toggle("active", button.dataset.tab === tab));
  document.querySelectorAll(".tab").forEach((panel) => panel.classList.add("hidden"));
  $(`${tab}Tab`).classList.remove("hidden");
  $("pageTitle").textContent = tab.charAt(0).toUpperCase() + tab.slice(1);
}

function formatDate(value) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function selected(actual, expected) {
  return String(actual || "").toUpperCase() === String(expected).toUpperCase() ? "selected" : "";
}

function normalizeMode(value) {
  const text = String(value || "").trim().toLowerCase().replace(/_/g, "-").replace(/\s+/g, "-");
  return text === "tcp-server" ? "tcp-server" : "tcp-client";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function truncateRaw(value) {
  const text = String(value || "");
  return text.length > 1200 ? `${text.slice(0, 1200)}\n... truncated ${text.length - 1200} chars` : text;
}

function formatRawForDisplay(value) {
  return String(value || "")
    .replace(/\x0b/g, "\\x0b")
    .replace(/\x1c/g, "\\x1c")
    .replace(/\x02/g, "\\x02")
    .replace(/\x03/g, "\\x03")
    .replace(/\x04/g, "\\x04")
    .replace(/\r/g, "\\r\n");
}
