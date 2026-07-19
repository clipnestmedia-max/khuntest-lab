"use strict";

const fs = require("fs");
const path = require("path");
const { app, safeStorage } = require("electron");
const { defaultSettings } = require("./default-settings");

class AppStore {
  constructor() {
    this.filePath = path.join(app.getPath("userData"), "khuntest-listener-settings.json");
    this.data = this.load();
    if (!this.data.settings) this.data.settings = defaultSettings();
    this.save();
  }

  get(dottedPath, fallback) {
    const value = getPath(this.data.settings, dottedPath);
    return value === undefined ? fallback : value;
  }

  all() {
    return this.data.settings || defaultSettings();
  }

  merge(patch) {
    const next = deepMerge(this.all(), patch || {});
    this.data.settings = next;
    this.save();
    return next;
  }

  setAuth(auth) {
    if (!auth) {
      delete this.data.auth;
      this.save();
      return;
    }
    const payload = JSON.stringify(auth);
    const encrypted = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(payload).toString("base64")
      : Buffer.from(payload, "utf8").toString("base64");
    this.data.auth = { encrypted, protected: safeStorage.isEncryptionAvailable() };
    this.save();
  }

  getAuth() {
    const saved = this.data.auth;
    if (!saved?.encrypted) return null;
    try {
      const data = Buffer.from(saved.encrypted, "base64");
      const text = saved.protected && safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(data)
        : data.toString("utf8");
      return JSON.parse(text);
    } catch (_err) {
      return null;
    }
  }

  safeSettings() {
    return this.all();
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.filePath, "utf8"));
    } catch (_err) {
      return {};
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), "utf8");
  }
}

function getPath(source, dottedPath) {
  return String(dottedPath || "").split(".").reduce((value, key) => value?.[key], source);
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch;
  if (!patch || typeof patch !== "object") return patch;
  const next = { ...(base || {}) };
  for (const [key, value] of Object.entries(patch)) {
    next[key] = value && typeof value === "object" && !Array.isArray(value)
      ? deepMerge(next[key] || {}, value)
      : value;
  }
  return next;
}

module.exports = { AppStore };
