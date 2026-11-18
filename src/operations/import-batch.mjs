import { posix } from "node:path";
import { importDirectory } from "./import.mjs";
import { listMounts, mountCapsule } from "./mounts.mjs";

async function checkParents(api, plan) {
  const previous = new Set(["/"]);
  for (const { path } of plan) {
    if (!path) continue;
    const parent = posix.dirname(path);
    if (!previous.has(parent)) {
      await listMounts(api, { path: parent, limit: 1 });
      previous.add(parent);
    }
    previous.add(path);
  }
}

async function previewNames(api, items) {
  for (let offset = 0; offset < items.length; offset += 8) {
    await Promise.all(items.slice(offset, offset + 8).map(async (item) => {
      try { await api.json(api.path(item.name)); }
      catch (error) {
        if (error.status === 404) { item.status = "ready"; return; }
        throw error;
      }
      item.status = "blocked";
      item.code = "NAME_OCCUPIED";
    }));
  }
}

async function verifyOriginal(api, saved, { entry, blobIds }) {
  const response = await api.response(api.path(saved.name, "content", { entry }), { method: "HEAD" });
  const hash = response.headers.get("ETag")?.match(/^"([a-f0-9]{40}|[a-f0-9]{64})"$/)?.[1];
  if (!blobIds.includes(hash) || response.headers.get("X-Capsule-Commit") !== saved.commit)
    throw Object.assign(new Error("远端原件与导入字节或提交不一致"), { code: "IMPORT_VERIFICATION_FAILED", status: 409 });
}

function savedReceipt(saved, name) {
  if (saved?.name !== name || [saved.commit, saved.token, saved.eventId].some((value) => typeof value !== "string" || !value))
    throw Object.assign(new Error("导入回执无效"), { code: "INVALID_RESPONSE", status: 502, uncertain: true, eventId: saved?.eventId });
  return { commit: saved.commit, token: saved.token, eventId: saved.eventId };
}

export async function importBatch(api, plan, { dryRun = false, verify = false } = {}) {
  await checkParents(api, plan);
  const items = plan.map(({ input, path, file, directory, bytes }) => ({ name: input.name, kind: input.kind, path, file, directory, bytes, status: "skipped" }));
  if (dryRun) {
    await previewNames(api, items);
    return { dryRun, canApply: items.every(({ status }) => status === "ready"), items };
  }
  for (const [index, source] of plan.entries()) {
    const { input, path, directory, file, entry } = source;
    const item = items[index];
    let operation = directory ? "import" : "create";
    try {
      let saved = directory
        ? await importDirectory(api, { ...input, directory })
        : await api.json("/api/capsules", "POST", input);
      Object.assign(item, { status: "created", ...savedReceipt(saved, input.name) });
      if (!directory && input.body === undefined) {
        operation = "upload";
        item.createEventId = saved.eventId;
        saved = await api.upload(input.name, entry, file, saved.token);
        Object.assign(item, { status: "stored", ...savedReceipt(saved, input.name) });
      }
      if (source.blobIds) {
        operation = "verify";
        await verifyOriginal(api, saved, source);
        item.verified = true;
      } else if (verify) {
        item.verification = directory ? "archive" : "sqlite-integrity";
      }
      if (path) {
        operation = "mount";
        const mounted = await mountCapsule(api, { name: input.name, path });
        if (mounted?.name !== input.name || mounted.path !== path)
          throw Object.assign(new Error("挂载回执无效"), { code: "INVALID_RESPONSE", status: 502, uncertain: true });
        item.status = "mounted";
      }
    } catch (error) {
      const unknownResult = operation !== "verify" && (error.unknownResult || error.uncertain || !error.status || error.status >= 500);
      if (operation === "create" || operation === "import") item.status = unknownResult ? "unknown" : "failed";
      item.error = { operation, code: error.code || "IMPORT_FAILED", ...(error.status ? { status: error.status } : {}),
        ...(error.eventId ? { eventId: error.eventId } : {}), ...(unknownResult ? { unknownResult: true } : {}), message: error.message };
      const hint = operation === "mount" ? `用 where ${item.name} 核对挂载` : `用 stat ${item.name} 和原事件核对`;
      return {
        exitCode: 1, status: "incomplete", eventId: error.eventId,
        error: { ...item.error, message: `导入在第${index + 1}项停止。请${hint}，按回执处理剩余项。${item.error.message}` },
        items,
      };
    }
  }
  return { items };
}
