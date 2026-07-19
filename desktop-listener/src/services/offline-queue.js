"use strict";

const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

class OfflineQueue {
  constructor(userDataPath, logger) {
    this.dbPath = path.join(userDataPath, "khuntest-listener-queue.sqlite");
    this.logger = logger;
    this.SQL = null;
    this.db = null;
    this.pending = 0;
    this.lastFlush = "";
  }

  async init() {
    const wasmDir = path.dirname(require.resolve("sql.js/dist/sql-wasm.wasm"));
    this.SQL = await initSqlJs({ locateFile: (file) => path.join(wasmDir, file) });
    const bytes = fs.existsSync(this.dbPath) ? fs.readFileSync(this.dbPath) : null;
    this.db = bytes ? new this.SQL.Database(bytes) : new this.SQL.Database();
    this.db.run(`CREATE TABLE IF NOT EXISTS queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      payload TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_error TEXT
    )`);
    this.persist();
    await this.count();
  }

  async enqueue(payload, error) {
    const statement = this.db.prepare("INSERT INTO queue (payload, attempts, created_at, last_error) VALUES (?, 0, ?, ?)");
    statement.run([JSON.stringify(payload), new Date().toISOString(), error || ""]);
    statement.free();
    this.persist();
    this.logger.warn("queue", "Stored result offline", { sample: payload?.parsed?.sampleId, details: error });
    await this.count();
  }

  async flush(uploader) {
    const rows = this.query("SELECT * FROM queue ORDER BY id ASC LIMIT 25");
    for (const row of rows) {
      try {
        const payload = JSON.parse(row.payload);
        await uploader({ payload });
        this.run("DELETE FROM queue WHERE id = ?", [row.id]);
        this.logger.info("queue", "Uploaded queued result", { sample: payload?.parsed?.sampleId });
      } catch (err) {
        this.run("UPDATE queue SET attempts = attempts + 1, last_error = ? WHERE id = ?", [err.message, row.id]);
        this.logger.warn("queue", "Queue flush paused", { details: err.message });
        break;
      }
    }
    this.lastFlush = new Date().toISOString();
    this.persist();
    await this.count();
  }

  async count() {
    const rows = this.query("SELECT COUNT(*) count FROM queue");
    this.pending = rows[0]?.count || 0;
    return this.pending;
  }

  run(sql, params = []) {
    const statement = this.db.prepare(sql);
    statement.run(params);
    statement.free();
  }

  query(sql, params = []) {
    const statement = this.db.prepare(sql);
    statement.bind(params);
    const rows = [];
    while (statement.step()) rows.push(statement.getAsObject());
    statement.free();
    return rows;
  }

  persist() {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    fs.writeFileSync(this.dbPath, Buffer.from(this.db.export()));
  }

  status() {
    return { pending: this.pending, lastFlush: this.lastFlush };
  }
}

module.exports = { OfflineQueue };
