import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, readdir, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";

function openDatabase(home) {
  const database = new DatabaseSync(join(home, "runs.sqlite"));
  database.exec(`
    PRAGMA journal_mode=DELETE;
    PRAGMA busy_timeout=5000;
    PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      commit_id TEXT NOT NULL,
      directory TEXT NOT NULL,
      exit_code INTEGER,
      created_at TEXT NOT NULL,
      record_json TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS migration_errors (
      path TEXT PRIMARY KEY,
      error TEXT NOT NULL,
      observed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS migrations (
      name TEXT PRIMARY KEY,
      completed_at TEXT NOT NULL
    );
  `);
  return database;
}

function insert(database, record, { legacy = false } = {}) {
  for (const key of ["id", "name", "commit", "directory", "createdAt"]) {
    if (typeof record[key] !== "string" || !record[key])
      throw new Error(`运行记录缺少 ${key}`);
  }
  const existing = database.prepare("SELECT record_json FROM runs WHERE id=?").get(record.id);
  if (legacy && existing) {
    if (existing.record_json !== JSON.stringify(record))
      throw new Error("旧运行记录与同ID数据库记录不一致，原文件已保留");
    return;
  }
  database.prepare(`
    INSERT INTO runs VALUES (?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      commit_id=excluded.commit_id,
      directory=excluded.directory,
      exit_code=excluded.exit_code,
      created_at=excluded.created_at,
      record_json=excluded.record_json
  `).run(
    record.id,
    record.name,
    record.commit,
    record.directory,
    record.exitCode ?? null,
    record.createdAt,
    JSON.stringify(record),
  );
}

async function migrateLegacy(database, home) {
  const migrated = database.prepare("SELECT name FROM migrations WHERE name=?").get("result-json-v1");
  let files;
  if (migrated) {
    files = database.prepare("SELECT path FROM migration_errors ORDER BY path").all()
      .map((row) => row.path);
  } else {
    let directories;
    try {
      directories = await readdir(join(home, "runs"), { withFileTypes: true });
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      directories = [];
    }
    files = directories
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => join(home, "runs", entry.name, "result.json"));
  }
  for (const file of files) {
    try {
      const contents = await readFile(file, "utf8");
      const record = JSON.parse(contents);
      record.directory ||= dirname(file);
      record.createdAt ||= (await stat(file)).mtime.toISOString();
      database.exec("BEGIN IMMEDIATE");
      try {
        insert(database, record, { legacy: true });
        database.prepare("DELETE FROM migration_errors WHERE path=?").run(file);
        database.exec("COMMIT");
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
      await unlink(file);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      database.prepare(`
        INSERT INTO migration_errors VALUES (?,?,?)
        ON CONFLICT(path) DO UPDATE SET error=excluded.error, observed_at=excluded.observed_at
      `).run(file, error.message, new Date().toISOString());
    }
  }
  database.prepare("INSERT OR IGNORE INTO migrations VALUES (?,?)")
    .run("result-json-v1", new Date().toISOString());
}

export async function saveRun(home, record) {
  await mkdir(home, { recursive: true });
  const database = openDatabase(home);
  try {
    await migrateLegacy(database, home);
    insert(database, record);
    const warnings = database.prepare("SELECT path,error FROM migration_errors ORDER BY path").all();
    return { database: join(home, "runs.sqlite"), warnings };
  } finally {
    database.close();
  }
}
