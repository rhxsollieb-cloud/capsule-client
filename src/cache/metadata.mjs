import { withClientDatabase } from "../storage/database.mjs";

function versionMetadata(record) {
  const metadata = {
    name: record.name,
    kind: record.kind,
    description: record.description || "",
    commit: record.commit,
  };
  if (record.runtime) metadata.runtime = record.runtime;
  return metadata;
}

export async function saveCachedVersion(config, record, repository) {
  const metadata = versionMetadata(record);
  return withClientDatabase(config.home, (database) => {
    const existing = database.prepare(
      "SELECT metadata FROM cache_versions WHERE server_url=? AND name=? AND commit_id=?",
    ).get(config.serverUrl, record.name, record.commit);
    const encoded = JSON.stringify(metadata);
    if (existing && existing.metadata !== encoded)
      throw new Error("同一提交返回了不同元数据，缓存未更新");
    database.exec("BEGIN IMMEDIATE");
    try {
      database.prepare(`
        INSERT INTO cache_versions VALUES (?,?,?,?,?)
        ON CONFLICT(server_url,name,commit_id) DO UPDATE SET repository=excluded.repository
      `).run(config.serverUrl, record.name, record.commit, repository, encoded);
      database.prepare(`
        INSERT INTO cache_heads VALUES (?,?,?)
        ON CONFLICT(server_url,name) DO UPDATE SET commit_id=excluded.commit_id
      `).run(config.serverUrl, record.name, record.commit);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    return { ...metadata, repository };
  });
}

export async function cachedVersion(config, name, commit) {
  return withClientDatabase(config.home, (database) => {
    const row = database.prepare(
      "SELECT metadata,repository FROM cache_versions WHERE server_url=? AND name=? AND commit_id=?",
    ).get(config.serverUrl, name, commit);
    if (!row) throw new Error("该提交的缓存元数据不存在，请重新同步");
    return { ...JSON.parse(row.metadata), repository: row.repository };
  });
}
