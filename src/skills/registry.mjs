import { withClientDatabase } from "../storage/database.mjs";

async function registry(config, operation) {
  return withClientDatabase(config.home, (database) => {
    database.exec(`CREATE TABLE IF NOT EXISTS skill_registrations (
      server_url TEXT NOT NULL, name TEXT NOT NULL, record_json TEXT NOT NULL,
      PRIMARY KEY(server_url,name)
    )`);
    return operation(database);
  });
}
export function readRegistration(config, name) {
  return registry(config, (database) => {
    const row = database.prepare("SELECT record_json FROM skill_registrations WHERE server_url=? AND name=?").get(config.serverUrl, name);
    return row ? JSON.parse(row.record_json) : null;
  });
}
export function saveRegistration(config, record) {
  return registry(config, (database) => {
    database.prepare(`INSERT INTO skill_registrations VALUES (?,?,?)
      ON CONFLICT(server_url,name) DO UPDATE SET record_json=excluded.record_json`)
      .run(config.serverUrl, record.name, JSON.stringify(record));
    return record;
  });
}
