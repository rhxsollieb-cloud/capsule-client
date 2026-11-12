import { databasePath, withClientDatabase } from "../storage/database.mjs";

export async function saveRun(home, record) {
  for (const key of ["id", "name", "commit", "directory", "createdAt"]) {
    if (typeof record[key] !== "string" || !record[key])
      throw new Error(`运行记录缺少 ${key}`);
  }
  await withClientDatabase(home, (database) => {
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
  });
  return { database: databasePath(home) };
}
