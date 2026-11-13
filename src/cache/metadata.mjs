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

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

export async function saveCachedVersion(config, record, repository) {
  const metadata = versionMetadata(record);
  let published = false;
  try {
    return await withClientDatabase(config.home, (database) => {
      const encoded = JSON.stringify(metadata);
      database.exec("BEGIN IMMEDIATE");
      try {
        const existing = database.prepare(
          "SELECT metadata FROM cache_versions WHERE server_url=? AND name=? AND commit_id=?",
        ).get(config.serverUrl, record.name, record.commit);
        if (existing && JSON.stringify(canonical(JSON.parse(existing.metadata))) !== JSON.stringify(canonical(metadata)))
          throw new Error("同一提交返回了不同元数据，缓存未更新");
        database.prepare(`
          INSERT INTO cache_versions VALUES (?,?,?,?,?)
          ON CONFLICT(server_url,name,commit_id) DO UPDATE SET repository=excluded.repository
        `).run(config.serverUrl, record.name, record.commit, repository, encoded);
        database.prepare(`
          INSERT INTO cache_heads VALUES (?,?,?)
          ON CONFLICT(server_url,name) DO UPDATE SET commit_id=excluded.commit_id
        `).run(config.serverUrl, record.name, record.commit);
        database.exec("COMMIT");
        published = true;
      } catch (error) {
        try { database.exec("ROLLBACK"); }
        catch (rollback) { error.message += `；缓存元数据回滚失败：${rollback.message}`; }
        throw error;
      }
      return { ...metadata, repository };
    });
  } catch (error) {
    if (published) {
      error.cachePublished = true;
      error.code ||= "CACHE_DATABASE_CLOSE_FAILED";
      error.message += "；缓存版本已发布，数据库收尾失败，已保留当前缓存版本，请核对状态";
    }
    throw error;
  }
}

export async function findCachedVersion(config, name, commit) {
  return withClientDatabase(config.home, (database) => {
    const row = database.prepare(
      "SELECT metadata,repository FROM cache_versions WHERE server_url=? AND name=? AND commit_id=?",
    ).get(config.serverUrl, name, commit);
    if (!row) return null;
    const metadata = JSON.parse(row.metadata);
    if (metadata.name !== name || metadata.commit !== commit) throw new Error("缓存元数据与提交身份不一致，请核对本机缓存");
    return { ...metadata, repository: row.repository };
  });
}

export async function cachedVersion(config, name, commit) {
  const version = await findCachedVersion(config, name, commit);
  if (!version) throw new Error("该提交的缓存元数据不存在，请重新同步");
  return version;
}
