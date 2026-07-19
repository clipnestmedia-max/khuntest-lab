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
  $("analyzerStatus").textContent = next.status.analyzerConnected ? "Yes" : "Waiting";
  $("listenerStatus").textContent = next.status.running ? "Running" : "Paused";
  $("todayCount").textContent = String(next.status.todayImportedReports || 0);
  $("lastSync").textContent = formatDate(next.firebase.lastSyncTime || next.status.lastMessageAt);
  $("queueCount").textContent = `${next.queue.pending || 0} pending`;
  renderSettings(next.settings);
  renderAnalyzers(next.settings.analyzers || []);
  renderLogs(next.logs || []);
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
  document.querySelectorAll("[data-test-analyzer]").forEach((button) => {
    button.addEventListener("click", async () => {
      const analyzer = collectAnalyzers()[Number(button.dataset.testAnalyzer)];
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
    <label>Analyzer Port<input data-field="port" type="number" value="${Number(analyzer.port || 5001)}"></label>
    <label>Listener Host<input data-field="host" value="${escapeAttr(analyzer.host || "0.0.0.0")}"></label>
    <label>Analyzer IP<input data-field="analyzerIp" value="${escapeAttr(analyzer.analyzerIp || "")}"></label>
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
    host: "0.0.0.0",
    analyzerIp: "",
    port: 5001,
    reconnectAutomatically: true,
    enabled: true
  });
  state.settings.analyzers = analyzers;
  renderAnalyzers(analyzers);
}

async function saveAnalyzers() {
  await window.khunTest.saveSettings({ analyzers: collectAnalyzers() });
  state = await window.khunTest.getState();
  render(state);
}

function collectAnalyzers() {
  return [...document.querySelectorAll(".analyzer-card")].map((card, index) => {
    const get = (field) => card.querySelector(`[data-field="${field}"]`);
    return {
      id: state.settings.analyzers?.[index]?.id || `analyzer-${index}`,
      model: state.settings.analyzers?.[index]?.model || "",
      name: get("name").value.trim(),
      protocol: get("protocol").value,
      connectionType: get("connectionType").value,
      host: get("host").value.trim() || "0.0.0.0",
      analyzerIp: get("analyzerIp").value.trim(),
      port: Number(get("port").value || 5001),
      reconnectAutomatically: get("reconnectAutomatically").checked,
      enabled: get("enabled").checked
    };
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
  </tr>`).join("") || `<tr><td colspan="5">No logs yet.</td></tr>`;
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

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}
