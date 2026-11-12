import { capsuleName } from "../system/paths.mjs";

const createTable = `CREATE TABLE IF NOT EXISTS cap_run_logs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  commit_id TEXT NOT NULL,
  directory TEXT NOT NULL,
  exit_code INTEGER,
  stdout TEXT NOT NULL,
  stderr TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL
)`;

export async function saveRemoteRun(api, logCap, record) {
  const name = capsuleName(logCap);
  const target = await api.json(api.path(name));
  if (target.kind !== "database")
    throw new Error("--log-cap 目标必须为 database 类别");
  return api.json(api.path(name, "write"), "POST", {
    token: target.token,
    statements: [
      { sql: createTable },
      {
        sql: "INSERT INTO cap_run_logs VALUES (?,?,?,?,?,?,?,?,?)",
        parameters: [
          record.id,
          record.name,
          record.commit,
          record.directory,
          record.exitCode ?? null,
          record.stdout || "",
          record.stderr || "",
          record.error || null,
          record.createdAt,
        ],
      },
    ],
  });
}
