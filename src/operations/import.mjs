import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { capsuleName } from "../system/paths.mjs";
import { archiveDirectory } from "../import/archive.mjs";

export async function importDirectory(api, { directory, name, kind = "markdown", description = "" }) {
  name = capsuleName(name);
  if (!["markdown", "files", "code"].includes(kind)) throw new Error("目录导入仅支持markdown、files或code");
  if (typeof description !== "string" || description.length > 180) throw new Error("简述最多180字符");
  const imports = join(api.config.home, "imports");
  await mkdir(imports, { recursive: true });
  const temporary = await mkdtemp(join(imports, "archive-"));
  let source;
  try {
    const archive = await archiveDirectory(directory, join(temporary, "content.tar"), kind);
    source = createReadStream(archive.file);
    const response = await api.response(api.query("/api/capsules/import", { name, kind, description }), {
      method: "POST", headers: { "Content-Type": "application/x-tar", "Content-Length": String(archive.size) },
      body: source, duplex: "half", signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    let record;
    try { record = await response.json(); }
    catch { throw Object.assign(new Error("导入响应未确认，请先查询目标名称，不要重新导入"), { code: "IMPORT_RESULT_UNKNOWN", uncertain: true }); }
    if (record.name !== name || typeof record.token !== "string")
      throw Object.assign(new Error("导入响应不完整，请查询目标及事件，不要重新导入"), { code: "IMPORT_RESULT_UNKNOWN", uncertain: true, eventId: record.eventId });
    return record;
  } catch (error) {
    if (error.uncertain || error.eventId || error.code === "PUBLISH_PENDING")
      error.message += `；请查询 ${name}${error.eventId ? ` 及原事件 ${error.eventId}` : ""}，勿自动重放导入`;
    throw error;
  } finally {
    if (source) { source.destroy(); await finished(source).catch(() => {}); }
    await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
}
