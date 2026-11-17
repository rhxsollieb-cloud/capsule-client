import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withClientDatabase } from "../storage/database.mjs";
import { withCacheLock } from "./lock.mjs";

export const contentLimits = Object.freeze({ fileBytes: 16 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, entries: 256 });
export const strongContentTag = (value) => typeof value === "string" && /^"[a-f0-9]{40}(?:[a-f0-9]{24})?"$/.test(value);
const invalid = () => Object.assign(new Error("原件缓存路径或登记无效，请核对本机缓存"), { code: "CONTENT_CACHE_INVALID", status: 409 });
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
export function matchesContentTag(bytes, etag) {
  if (!strongContentTag(etag)) return false;
  return '"' + createHash(etag.length === 42 ? "sha1" : "sha256").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") + '"' === etag;
}

function directory(path) {
  if (!existsSync(path)) mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw invalid();
}

function schema(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS content_cache (
    cache_key TEXT PRIMARY KEY, server_url TEXT NOT NULL, name TEXT NOT NULL, entry TEXT NOT NULL,
    etag TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL, file TEXT NOT NULL, last_used INTEGER NOT NULL
  ); CREATE INDEX IF NOT EXISTS content_cache_lru ON content_cache(last_used);`);
}

function tick(database) {
  return Math.max(Date.now(), database.prepare("SELECT coalesce(max(last_used),0)+1 AS next FROM content_cache").get().next);
}

export class ContentCache {
  constructor(config, limits = contentLimits) {
    if (!Object.values(limits).every((value) => Number.isSafeInteger(value) && value > 0) || limits.fileBytes > limits.totalBytes) throw invalid();
    this.config = config; this.limits = limits;
    this.root = join(config.home, "content-cache");
    this.files = join(this.root, "files");
  }
  identity(name, entry) {
    const key = hash(JSON.stringify([this.config.serverUrl, name, entry ?? null]));
    return { key, name, entry: entry ?? "", file: key + ".bin" };
  }
  async prepare() { directory(this.root); directory(this.files); directory(join(this.root, "locks")); }
  async entry(identity, operation, { signal } = {}) {
    await this.prepare();
    return withCacheLock(join(this.root, "locks", identity.key + ".lock"), operation, { signal });
  }
  async index(operation, { signal } = {}) {
    await this.prepare();
    return withCacheLock(join(this.root, "index.lock"), () => withClientDatabase(this.config.home, (database) => { schema(database); this.recoverFiles(database); return operation(database); }), { signal });
  }
  recoverFiles(database) {
    const registered = new Set(database.prepare("SELECT * FROM content_cache").all().map((row) => { this.path(row); return row.file; }));
    for (const entry of readdirSync(this.files, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) throw invalid();
      if (/^[a-f0-9]{64}\.bin$/.test(entry.name)) {
        if (!registered.has(entry.name)) unlinkSync(join(this.files, entry.name));
      } else if (/^\.pending-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.name)) unlinkSync(join(this.files, entry.name));
      else throw invalid();
    }
  }
  path(row) {
    if (!/^[a-f0-9]{64}$/.test(row.cache_key) || row.file !== row.cache_key + ".bin" || !strongContentTag(row.etag)
      || !Number.isSafeInteger(row.size) || row.size < 0 || row.size > this.limits.fileBytes || !/^[a-f0-9]{64}$/.test(row.sha256)) throw invalid();
    return join(this.files, row.file);
  }
  remove(row) {
    const file = this.path(row);
    try {
      const info = lstatSync(file);
      if (!info.isFile() || info.isSymbolicLink()) throw invalid();
      unlinkSync(file);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async read(identity, maximum, { signal } = {}) {
    return this.index((database) => {
      const row = database.prepare("SELECT * FROM content_cache WHERE cache_key=?").get(identity.key);
      if (!row) return undefined;
      const file = this.path(row);
      if (row.server_url !== this.config.serverUrl || row.name !== identity.name || row.entry !== identity.entry) throw invalid();
      if (row.size > maximum) return undefined;
      let bytes;
      try {
        const info = lstatSync(file);
        if (!info.isFile() || info.isSymbolicLink()) throw invalid();
        if (info.size === row.size) {
          const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const actual = fstatSync(fd);
            if (!actual.isFile() || actual.dev !== info.dev || actual.ino !== info.ino) throw invalid();
            if (actual.size === row.size) {
              const bounded = Buffer.alloc(row.size + 1);
              let offset = 0, count;
              while (offset < bounded.length && (count = readSync(fd, bounded, offset, bounded.length - offset, null))) offset += count;
              bytes = bounded.subarray(0, offset);
            }
          } finally { closeSync(fd); }
        }
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      if (!bytes || bytes.length !== row.size || hash(bytes) !== row.sha256 || !matchesContentTag(bytes, row.etag)) {
        this.remove(row); database.prepare("DELETE FROM content_cache WHERE cache_key=?").run(identity.key);
        return undefined;
      }
      database.prepare("UPDATE content_cache SET last_used=? WHERE cache_key=?").run(tick(database), identity.key);
      return { bytes, etag: row.etag };
    }, { signal });
  }
  async publish(identity, bytes, etag, { signal } = {}) {
    signal?.throwIfAborted();
    if (!Buffer.isBuffer(bytes) || bytes.length > this.limits.fileBytes || !strongContentTag(etag)) return false;
    if (!matchesContentTag(bytes, etag)) throw Object.assign(new Error("原件字节与服务端ETag不符，缓存未发布"), { status: 502, code: "CONTENT_INTEGRITY" });
    return this.index((database) => {
      const destination = join(this.files, identity.file), temporary = join(this.files, ".pending-" + randomUUID());
      if (existsSync(destination)) {
        const info = lstatSync(destination);
        if (!info.isFile() || info.isSymbolicLink()) throw invalid();
      }
      let fd;
      try {
        fd = openSync(temporary, "wx", 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
        database.exec("BEGIN IMMEDIATE");
        try {
          const rows = database.prepare("SELECT * FROM content_cache WHERE cache_key<>? ORDER BY last_used,rowid").all(identity.key);
          let total = rows.reduce((sum, row) => sum + row.size, bytes.length), count = rows.length + 1;
          for (const row of rows) {
            if (total <= this.limits.totalBytes && count <= this.limits.entries) break;
            this.remove(row); database.prepare("DELETE FROM content_cache WHERE cache_key=?").run(row.cache_key);
            total -= row.size; count--;
          }
          renameSync(temporary, destination);
          database.prepare(`INSERT INTO content_cache VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(cache_key) DO UPDATE SET
            etag=excluded.etag,size=excluded.size,sha256=excluded.sha256,file=excluded.file,last_used=excluded.last_used`)
            .run(identity.key, this.config.serverUrl, identity.name, identity.entry, etag, bytes.length, hash(bytes), identity.file, tick(database));
          database.exec("COMMIT");
        } catch (error) { database.exec("ROLLBACK"); throw error; }
      } finally { if (fd !== undefined) closeSync(fd); if (existsSync(temporary)) unlinkSync(temporary); }
      return true;
    }, { signal });
  }
}
