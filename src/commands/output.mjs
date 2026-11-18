import { constants } from "node:fs";
import { access, link, lstat, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const receiptKeys = ["id", "name", "targetName", "previousName", "entry", "path", "to", "commit", "token", "mountsToken", "eventId", "operationId",
  "receipt", "baseline", "counts", "dryRun", "prepared", "affected", "matches", "canApply", "blockedBy",
  "status", "code", "error", "lines", "total", "nextOffset", "scanned",
  "returned", "truncated", "budgetLimited", "revision", "previewId", "restoreId", "backupId", "checksum", "confirmationName", "expiresAt", "isolated"];
const guideKeys = ["guideVersion", "scope", "topic", "title", "source", "next"];
const preservedKeys = (value) => value.guideVersion === undefined ? receiptKeys : [...receiptKeys, ...guideKeys];
const select = (value, keys) => Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
const encoded = (value) => JSON.stringify(value, null, 2);
const sensitiveCommands = new Set(["user-create", "credential-create", "lease-acquire"]);

function project(value, fields) {
  if (!fields || !value || typeof value !== "object" || Array.isArray(value)) return value;
  const plan = value.prepared === true ? ["plan"] : [];
  if (value.prepared === true && value.plan?.operation === "rename") plan.push("affectedPositions", "blockedReasons");
  if (typeof value.previousName === "string" && Array.isArray(value.movedPositions)) plan.push("movedPositions");
  const selected = select(value, [...new Set([...preservedKeys(value), ...plan, ...fields])]);
  const rowKeys = [...new Set(["id", "name", "path", "from", "operation", "index", ...fields])];
  if (Array.isArray(value.items)) selected.items = value.items.map((item) => item && typeof item === "object" ? select(item, rowKeys) : item);
  return selected;
}

function summary(value, characters) {
  const receipt = value && typeof value === "object" && !Array.isArray(value) ? select(value, preservedKeys(value)) : {};
  if (receipt.error && typeof receipt.error === "object") {
    receipt.error = select(receipt.error, ["message", "code", "status", "eventId", "operationId", "unknownResult"]);
    if (receipt.error.message?.length > 128) receipt.error.message = receipt.error.message.slice(0, 128) + "…";
  }
  if (typeof receipt.error === "string" && receipt.error.length > 256) receipt.error = receipt.error.slice(0, 256) + "…";
  if (value?.result && typeof value.result === "object") receipt.result = select(value.result, ["name", "commit", "token", "eventId", "removed"]);
  return { ...receipt, truncated: true, dataOmitted: true, totalCharacters: characters, hint: value?.guideVersion === undefined
    ? "结果超过输出预算，正文/记录未完整返回。用--fields或分页缩小范围、增大--max-chars，或用--out保存完整JSON；已完成的写入不能重放。"
    : "说明超过输出预算，请增大--max-chars或用--out保存完整JSON。" };
}

function fitSummary(value, maxChars) {
  const omitted = [];
  value.omittedFields = omitted;
  for (const key of ["path", "to", "entry", "targetName", "previousName", "name", "totalCharacters", "returned", "scanned", "result", "counts"]) {
    if (encoded(value).length <= maxChars) break;
    if (Object.hasOwn(value, key)) { delete value[key]; omitted.push(key); }
  }
  if (encoded(value).length > maxChars) value.hint = "输出超预算，请使用--out；已完成的写入勿重放。";
  const shrinkMessage = () => {
    if (typeof value.error === "string" && value.error.length > 16) { value.error = value.error.slice(0, Math.floor(value.error.length / 2)) + "…"; return true; }
    if (value.error?.message?.length > 16) {
      value.error.message = value.error.message.slice(0, Math.floor(value.error.message.length / 2)) + "…";
      value.error.messageTruncated = true;
      return true;
    }
    return false;
  };
  while (encoded(value).length > maxChars && shrinkMessage()) { /* Keep the failure code and receipt intact. */ }
  for (const key of ["lines", "total", "token", "commit", "eventId", "id"]) {
    if (encoded(value).length <= maxChars) break;
    if (Object.hasOwn(value, key)) { delete value[key]; omitted.push(key); }
  }
  if (value.error && typeof value.error === "object") for (const key of ["command", "eventId", "code"]) {
    if (encoded(value).length <= maxChars) break;
    if (Object.hasOwn(value.error, key)) { delete value.error[key]; omitted.push("error." + key); }
  }
  if (!omitted.length) delete value.omittedFields;
  // The omitted-fields list itself is optional; identities are never sliced into invalid values.
  if (encoded(value).length > maxChars) value.omittedFields = ["metadata"];
  if (encoded(value).length > maxChars) return {
    truncated: true, dataOmitted: true, omittedFields: ["metadata"],
    ...(value.error ? { error: { message: "错误详情超过输出预算", ...(typeof value.error.status === "number" ? { status: value.error.status } : {}) } } : {}),
    hint: "必要回执也超过预算，请增大--max-chars或事前使用--out；已完成的写入勿重放。",
  };
  return value;
}

export function boundedResult(value, maxChars = 12000, { offset = 0 } = {}) {
  const text = encoded(value);
  if (text.length <= maxChars) return value;
  const pageable = value && Object.hasOwn(value, "nextOffset");
  if (value && typeof value === "object" && Array.isArray(value.items) && value.items.length) {
    const result = { ...value, items: [...value.items], truncated: true, budgetLimited: true };
    while (result.items.length > 1 && encoded(result).length > maxChars) result.items.pop();
    if (result.items.length < value.items.length) {
      // Search offsets count scanned candidate caps, not emitted records.
      if (value.scanned) return fitSummary({ ...summary(value, text.length), nextOffset: value.scanned.from, retryOffset: value.scanned.from }, maxChars);
      if (pageable) result.nextOffset = (value.offset ?? offset) + result.items.length;
    }
    if (encoded(result).length <= maxChars) return result;
  }
  if (typeof value?.body === "string" && value.lines) {
    const lines = value.body.split("\n");
    const resumeLimit = value.next?.limit ?? lines.length;
    const result = { ...value, lines: { ...value.lines }, truncated: true, budgetLimited: true };
    while (lines.length > 1) {
      lines.pop();
      result.body = lines.join("\n");
      result.lines.to = result.lines.from + lines.length - 1;
      result.lines.nextLine = result.lines.to + 1;
      result.lines.truncated = true;
      if (value.guideVersion !== undefined) result.next = { topic: value.topic, from: result.lines.nextLine, limit: resumeLimit };
      if (encoded(result).length <= maxChars) return result;
    }
  }
  const result = summary(value, text.length);
  if (pageable && Array.isArray(value?.items)) result.nextOffset = value.scanned?.from ?? value.offset ?? offset;
  // A large single line cannot be resumed using a line cursor; never pretend it was returned.
  if (result.lines) result.lines = { ...result.lines, nextLine: result.lines.from, truncated: true, budgetLimited: true };
  if (value?.guideVersion !== undefined && result.lines) {
    result.lines.to = result.lines.from - 1;
    result.next = { topic: value.topic, from: result.lines.from, limit: value.next?.limit ?? 60 };
  }
  return fitSummary(result, maxChars);
}

export async function prepareOutput(output = {}) {
  if (!output.outFile) return;
  const path = resolve(output.outFile);
  try { await lstat(path); throw new Error("输出文件已存在，未执行业务：" + path); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  await access(dirname(path), constants.W_OK);
}

export async function printResult(value, { output = {}, values = {}, command } = {}, io = process) {
  const selected = project(value, output.fields);
  if (output.outFile) {
    const path = resolve(output.outFile);
    const text = encoded(selected) + "\n";
    let directory;
    try {
      directory = await mkdtemp(join(dirname(path), ".capsule-output-"));
      const temporary = join(directory, "result.json");
      await writeFile(temporary, text, { flag: "wx", ...(sensitiveCommands.has(command) ? { mode: 0o600 } : {}) });
      await link(temporary, path);
    }
    catch (error) {
      const failure = new Error(`操作已返回，但保存输出失败：${error.message}；不要重放已完成的写入`, { cause: error });
      failure.code = "OUTPUT_WRITE_FAILED";
      const issued = sensitiveCommands.has(command) && (value.token || value.bootstrapCredential?.token || value.lease?.token);
      const credential = value.credential || value.bootstrapCredential?.credential;
      failure.result = issued ? {
        token: issued, ...(credential?.id ? { id: credential.id } : {}), ...(credential?.userId ? { userId: credential.userId } : {}),
        ...(command === "lease-acquire" ? { leaseAcquired: true, id: value.lease.id } : { credentialIssued: true }), outputFailed: true,
        hint: command === "lease-acquire" ? "占用已获取，文件未保存。请保存凭证并及时续租或释放，不要改id重放获取。" : "凭据已签发，文件未保存。本响应仅显示一次，请立即保存，勿重放签发。",
      } : summary(value, text.length);
      throw failure;
    }
    finally { if (directory) await rm(directory, { recursive: true, force: true }); }
    io.stdout.write(encoded({ output: path, characters: text.length }) + "\n");
    return;
  }
  if (output.raw) {
    if (typeof value?.body !== "string") throw new Error("此结果没有可输出的正文");
    if (value.body.length > (output.maxChars ?? 12000)) throw new Error("选定正文超过--raw输出预算，请缩小行范围或增大--max-chars；没有输出不完整正文");
    io.stdout.write(value.body);
    return;
  }
  io.stdout.write(encoded(boundedResult(selected, output.maxChars, { offset: values.offset || 0 })) + "\n");
}

export function machineError(error, { token, leaseToken, command } = {}) {
  const knownTerminal = ["failed", "conflict"].includes(error.result?.status);
  const scrub = (value) => {
    if (typeof value === "string") { for (const secret of [token, leaseToken].filter(Boolean)) value = value.replaceAll(secret, "[凭据已隐藏]"); return value; }
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  return scrub({ error: {
    message: error.message || "操作失败",
    code: error.code || "CLI_ERROR",
    ...(error.status === undefined ? {} : { status: error.status }),
    ...(command ? { command } : {}),
    ...(error.eventId ? { eventId: error.eventId } : {}),
    ...(error.operationId ? { operationId: error.operationId } : {}),
    ...(error.uncertain ? { uncertain: true } : {}),
    ...(error.unknownResult || error.uncertain || (!knownTerminal && /结果未知|不能自动重放/.test(error.message || "")) ? { unknownResult: true } : {}),
  }, ...(Array.isArray(error.leases) ? { leases: error.leases } : {}), ...(error.result ? { result: error.result } : {}) });
}
