"use strict";

const path = require("path");
const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } = require("electron");
const log = require("electron-log");
const { autoUpdater } = require("electron-updater");
const { AppStore } = require("../services/app-store");
const { FirebaseService } = require("../services/firebase-service");
const { ListenerService } = require("../services/listener-service");
const { OfflineQueue } = require("../services/offline-queue");
const { LoggerService } = require("../services/logger-service");
const { defaultSettings } = require("../services/default-settings");

let mainWindow;
let tray;
let services;

app.setName("KhunTest Lab Listener");
app.setLoginItemSettings({ openAtLogin: true, path: app.getPath("exe") });

function createServices() {
  const appStore = new AppStore();
  const logger = new LoggerService(app.getPath("userData"));
  const queue = new OfflineQueue(app.getPath("userData"), logger);
  const firebase = new FirebaseService(appStore, logger);
  const listener = new ListenerService(appStore, firebase, queue, logger);
  services = { appStore, logger, queue, firebase, listener };
}

function sendStatus() {
  if (!mainWindow || !services) return;
  mainWindow.webContents.send("status:update", {
    settings: services.appStore.safeSettings(),
    status: services.listener.status(),
    firebase: services.firebase.status(),
    queue: services.queue.status(),
    logs: services.logger.recent()
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 980,
    minHeight: 640,
    title: "KhunTest Lab Listener",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  mainWindow.on("close", (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "../assets/tray.png"));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip("KhunTest Lab Listener");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Dashboard", click: () => mainWindow.show() },
    { type: "separator" },
    { label: "Pause Listener", click: async () => { await services.listener.stop(); sendStatus(); } },
    { label: "Resume Listener", click: async () => { await services.listener.start(); sendStatus(); } },
    { label: "Settings", click: () => { mainWindow.show(); mainWindow.webContents.send("ui:tab", "settings"); } },
    { type: "separator" },
    { label: "Exit", click: () => { app.isQuiting = true; app.quit(); } }
  ]));
  tray.on("double-click", () => mainWindow.show());
}

async function boot() {
  createServices();
  await services.queue.init();
  await services.firebase.restoreSession();
  if (services.appStore.get("listener.autoStart", true)) {
    await services.listener.start().catch((err) => log.error(err));
  }
  createWindow();
  createTray();
  setInterval(sendStatus, 3000);
  setInterval(() => services.queue.flush((item) => services.firebase.uploadMachineResult(item.payload)), 15000);
  autoUpdater.checkForUpdatesAndNotify().catch((err) => services.logger.error("updater", err.message));
}

app.whenReady().then(boot);
app.on("window-all-closed", (event) => event.preventDefault());
app.on("activate", () => {
  if (!mainWindow) createWindow();
  mainWindow.show();
});

ipcMain.handle("auth:login", async (_event, credentials) => {
  const result = await services.firebase.login(credentials);
  sendStatus();
  return result;
});

ipcMain.handle("auth:logout", async () => {
  await services.firebase.logout();
  await services.listener.stop();
  sendStatus();
  return { ok: true };
});

ipcMain.handle("settings:get", async () => ({
  settings: services.appStore.safeSettings(),
  status: services.listener.status(),
  firebase: services.firebase.status(),
  queue: services.queue.status(),
  logs: services.logger.recent()
}));

ipcMain.handle("settings:save", async (_event, patch) => {
  services.appStore.merge(patch);
  sendStatus();
  return { ok: true, settings: services.appStore.safeSettings() };
});

ipcMain.handle("listener:start", async () => {
  await services.listener.start();
  sendStatus();
  return services.listener.status();
});

ipcMain.handle("listener:stop", async () => {
  await services.listener.stop();
  sendStatus();
  return services.listener.status();
});

ipcMain.handle("listener:test", async (_event, analyzer) => services.listener.testConnection(analyzer));
ipcMain.handle("logs:export", async () => services.logger.exportLogs());
ipcMain.handle("logs:openFolder", async () => shell.openPath(services.logger.logDir));
ipcMain.handle("queue:flush", async () => {
  await services.queue.flush((item) => services.firebase.uploadMachineResult(item.payload));
  sendStatus();
  return services.queue.status();
});

ipcMain.handle("app:defaults", async () => defaultSettings());
