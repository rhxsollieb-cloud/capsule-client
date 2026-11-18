import { revalidatedContent } from "../cache/content.mjs";
import { contentDigest, patchBytes, patchError, patchText } from "./text-patch.mjs";

const bodyEntries = { markdown: "README.md", code: "SKILL.md", files: "说明.md", database: "说明.md" };
const hasVersion = (value) => typeof value?.token === "string" && /^[a-f0-9]{64}$/.test(value.token) &&
  typeof value.commit === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value.commit);

function invalidResponse() { return patchError("服务端返回的原件或编辑回执缺少可核对的版本", 502, "INVALID_RESPONSE"); }

async function inspect(api, item) {
  const { name, replacements } = item;
  const record = await api.json(api.path(name));
  if (record?.name !== name || !hasVersion(record)) throw invalidResponse();
  if (item.token !== undefined && (item.token !== record.token || item.commit !== record.commit))
    throw patchError("内容版本已变化，请重新预演", 409, "VERSION_CONFLICT");
  if (record.permissions?.edit === false) throw patchError("当前身份无法编辑此cap", 403, "FORBIDDEN");
  const entry = item.entry ?? (record.kind === "text" ? name : Object.hasOwn(bodyEntries, record.kind) ? bodyEntries[record.kind] : undefined);
  if (!entry) throw patchError("此cap需要指定文本原件entry");
  if (record.kind === "database" && entry !== "说明.md" && !entry.startsWith("media/"))
    throw patchError("数据库正文仅支持说明.md及明确指定的文字媒体条目");
  const { response } = await revalidatedContent(api, name, entry, { maxBytes: patchBytes, expectedToken: record.token });
  if (response.headers.get("X-Capsule-Commit") !== record.commit) {
    await response.body?.cancel();
    throw invalidResponse();
  }
  const bytes = await response.arrayBuffer();
  let original;
  try { original = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw patchError("原件需要有效的UTF-8文本", 415, "INVALID_TEXT"); }
  if (original.includes("\0")) throw patchError("预演需要不含NUL的文字原件", 415, "INVALID_TEXT");
  const patched = patchText(original, replacements);
  const baseline = { name, entry, replacements, commit: record.commit, token: record.token };
  return { baseline, ...patched, ...(patched.body === undefined ? {} : { digest: contentDigest(patched.body) }) };
}

function errorDetails(error) {
  return { code: error.code || "EDIT_FAILED", message: error.message,
    ...(error.status ? { status: error.status } : {}), ...(error.eventId ? { eventId: error.eventId } : {}),
    ...(Array.isArray(error.leases) ? { leases: error.leases } : {}) };
}

export async function prepareEdits(api, items) {
  const summaries = [], planItems = [];
  for (const item of items) {
    try {
      const { baseline, digest, matches, blockedBy, reason } = await inspect(api, item);
      summaries.push({ name: baseline.name, entry: baseline.entry, commit: baseline.commit, matches,
        canApply: !blockedBy, ...(blockedBy ? { blockedBy, reason } : {}) });
      if (!blockedBy) planItems.push({ ...baseline, digest });
    } catch (error) {
      summaries.push({ name: item.name, entry: item.entry, canApply: false, error: errorDetails(error) });
    }
  }
  const canApply = planItems.length === items.length;
  return { prepared: true, dryRun: true, canApply, items: summaries,
    ...(canApply ? { plan: { operation: "edit", version: 1, items: planItems, reviewDigest: contentDigest(JSON.stringify(planItems)) } } : {}) };
}

function failed(receipts, index, error, publishing = false) {
  const unknownResult = publishing && (error.uncertain || error.unknownResult || !error.status || error.status >= 500);
  const record = receipts[index];
  record.status = unknownResult ? "unknown" : "failed";
  record.error = { ...errorDetails(error), ...(unknownResult ? { unknownResult: true } : {}) };
  const hint = unknownResult ? "请用event或stat核对这项的实际结果" : "请按回执核对后续项";
  return { exitCode: 1, status: "incomplete", ...("eventId" in record.error ? { eventId: record.error.eventId } : {}),
    error: { ...record.error, message: `修改 ${record.name} 时停止。${hint}。${error.message}` }, items: receipts };
}

export async function applyEdits(api, items) {
  if (api.leaseProof && items.length > 1) throw patchError("同一个编辑占用凭证只适用于一个cap，请用对应的单cap计划提交");
  const receipts = items.map(({ name, entry, commit }) => ({ name, entry, beforeCommit: commit, status: "skipped" }));
  const snapshots = [];
  for (const [index, item] of items.entries()) {
    try {
      const snapshot = await inspect(api, item);
      if (snapshot.blockedBy || snapshot.digest !== item.digest)
        throw patchError(snapshot.reason || "替换结果与原预演不一致，请重新预演", 409, snapshot.blockedBy || "EDIT_PLAN_CHANGED");
      snapshots.push(snapshot);
    } catch (error) { return failed(receipts, index, error); }
  }
  for (const [index, { baseline, body, matches }] of snapshots.entries()) {
    try {
      const result = await api.putText(baseline.name, baseline.entry, body, baseline.token);
      const { name, commit, token, eventId } = result || {};
      if (name !== baseline.name || !hasVersion(result) || commit === baseline.commit ||
          token === baseline.token || typeof eventId !== "string" || !eventId)
        throw Object.assign(invalidResponse(), typeof eventId === "string" ? { eventId } : {});
      Object.assign(receipts[index], { status: "applied", commit, token, eventId, matches });
    } catch (error) { return failed(receipts, index, error, true); }
  }
  return { status: "succeeded", items: receipts };
}
