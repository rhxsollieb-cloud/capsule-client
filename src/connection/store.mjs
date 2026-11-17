import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, closeSync, existsSync, lstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, win32 } from "node:path";

export function normalizeConnectionPath(value, platform = process.platform) {
  return platform === "win32" ? win32.normalize(value).replace(/^\\\\\?\\/u, "").toLowerCase() : resolve(value);
}

function canonicalLocation(file) {
  let cursor = file;
  const suffix = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return file;
    suffix.unshift(basename(cursor)); cursor = parent;
  }
  return join(realpathSync(cursor), ...suffix);
}

export function connectionHome(env = process.env) {
  if (env.CAPSULE_CONFIG_HOME || env.CAPSULE_CLIENT_HOME) return resolve(env.CAPSULE_CONFIG_HOME || env.CAPSULE_CLIENT_HOME);
  if (process.platform === "win32") return join(env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "Capsule");
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support", "Capsule");
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "capsule");
}

function ordinary(path, directory = false) {
  const value = lstatSync(path);
  if (value.isSymbolicLink() || (directory ? !value.isDirectory() : !value.isFile()))
    throw new Error("本机连接配置位置无效，请核对受保护的用户目录");
}

export class ConnectionStore {
  constructor(env = process.env) { this.home = connectionHome(env); this.file = join(this.home, "connection.sqlite"); }
  get key() { return createHash("sha256").update(normalizeConnectionPath(canonicalLocation(this.file))).digest("hex"); }
  read() {
    if (!existsSync(this.file)) return undefined;
    ordinary(this.home, true); ordinary(this.file);
    const db = new DatabaseSync(this.file, { readOnly: true });
    try {
      db.exec("PRAGMA busy_timeout=5000");
      const row = db.prepare("SELECT profile FROM client_connection WHERE id=1").get();
      if (!row) return undefined;
      const value = JSON.parse(row.profile);
      if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1)
        throw new Error("本机连接配置格式不兼容，请核对后重新连接");
      return value;
    } finally { db.close(); }
  }
  write(profile) {
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    ordinary(this.home, true);
    try { closeSync(openSync(this.file, "wx", 0o600)); }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    ordinary(this.file);
    const db = new DatabaseSync(this.file);
    try {
      if (process.platform !== "win32") chmodSync(this.file, 0o600);
      db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;");
      db.exec("CREATE TABLE IF NOT EXISTS client_connection (id INTEGER PRIMARY KEY CHECK(id=1), profile TEXT NOT NULL)");
      db.prepare("INSERT INTO client_connection VALUES (1,?) ON CONFLICT(id) DO UPDATE SET profile=excluded.profile")
        .run(JSON.stringify({ ...profile, version: 1 }));
    } finally { db.close(); }
  }
}
