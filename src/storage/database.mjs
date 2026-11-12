import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export const databasePath = (home) => join(home, "client.sqlite");

export async function withClientDatabase(home, operation) {
  await mkdir(home, { recursive: true });
  const database = new DatabaseSync(databasePath(home));
  try {
    database.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL");
    const version = database.prepare("PRAGMA user_version").get().user_version;
    if (version !== 0 && version !== 3)
      throw new Error("客户端工作区格式不兼容，请清理开发数据后重建");
    if (version === 0) {
      const existing = database.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%'").all();
      if (existing.length)
        throw new Error("客户端工作区格式不兼容，请清理开发数据后重建");
      database.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE cache_versions (
          server_url TEXT NOT NULL,
          name TEXT NOT NULL,
          commit_id TEXT NOT NULL,
          repository TEXT NOT NULL,
          metadata TEXT NOT NULL,
          PRIMARY KEY(server_url,name,commit_id)
        );
        CREATE TABLE cache_heads (
          server_url TEXT NOT NULL,
          name TEXT NOT NULL,
          commit_id TEXT NOT NULL,
          PRIMARY KEY(server_url,name)
        );
        CREATE TABLE runs (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          commit_id TEXT NOT NULL,
          directory TEXT NOT NULL,
          exit_code INTEGER,
          created_at TEXT NOT NULL,
          record_json TEXT NOT NULL
        );
        PRAGMA user_version=3;
        COMMIT;
      `);
    }
    return operation(database);
  } finally {
    database.close();
  }
}
