"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("khunTest", {
  login: (credentials) => ipcRenderer.invoke("auth:login", credentials),
  logout: () => ipcRenderer.invoke("auth:logout"),
  getState: () => ipcRenderer.invoke("settings:get"),
  saveSettings: (patch) => ipcRenderer.invoke("settings:save", patch),
  startListener: () => ipcRenderer.invoke("listener:start"),
  stopListener: () => ipcRenderer.invoke("listener:stop"),
  testConnection: (analyzer) => ipcRenderer.invoke("listener:test", analyzer),
  exportLogs: () => ipcRenderer.invoke("logs:export"),
  openLogsFolder: () => ipcRenderer.invoke("logs:openFolder"),
  flushQueue: () => ipcRenderer.invoke("queue:flush"),
  defaults: () => ipcRenderer.invoke("app:defaults"),
  onStatus: (callback) => ipcRenderer.on("status:update", (_event, payload) => callback(payload)),
  onTab: (callback) => ipcRenderer.on("ui:tab", (_event, tab) => callback(tab))
});
