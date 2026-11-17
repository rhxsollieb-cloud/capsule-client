import { capsuleName, entryPath } from "../system/paths.mjs";
import { ContentCache, contentLimits, strongContentTag } from "./content-store.mjs";

export function expectedContentToken(value) {
  if (value === undefined) return value;
  if (typeof value !== "string" || !value.length || value.length > 512
      || [...value].some((character) => { const code = character.codePointAt(0); return code < 32 || code >= 127 && code <= 159; }))
    throw Object.assign(new Error("原件version需为1至512字符且不含控制字符的版本标识"), { status: 400, code: "INVALID_CONTENT_VERSION" });
  return value;
}

export async function assertContentVersion(response, expectedToken) {
  if (expectedToken === undefined || response.headers.get("X-Capsule-Token") === expectedToken) return;
  try { await response.body?.cancel(); } catch { /* A failed body cannot satisfy the version guard. */ }
  throw Object.assign(new Error("原件版本已变化，请刷新正文后重试"), { status: 409, code: "CONTENT_VERSION_CHANGED" });
}

function tooLarge() { return Object.assign(new Error("原件超过本机缓冲上限，请流式下载查看"), { status: 413, code: "CONTENT_TOO_LARGE" }); }
function declaredSize(response) {
  const value = response.headers.get("Content-Length");
  if (value === null) return undefined;
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) throw Object.assign(new Error("原件长度响应无效"), { status: 502, code: "INVALID_RESPONSE" });
  return Number(value);
}

async function boundedBytes(response, maximum, signal) {
  if (!response.body) throw Object.assign(new Error("服务端未返回原件内容"), { status: 502 });
  const reader = response.body.getReader(), chunks = [];
  const cancel = () => { reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  let size = 0;
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw tooLarge(); }
      chunks.push(Buffer.from(value));
    }
  } finally { signal?.removeEventListener("abort", cancel); reader.releaseLock(); }
  return Buffer.concat(chunks, size);
}

function bufferedResponse(response, bytes) {
  const headers = new Headers(response.headers);
  headers.delete("Content-Encoding"); headers.delete("Content-Range");
  headers.set("Content-Length", String(bytes.length));
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/octet-stream");
  return new Response(bytes, { status: 200, headers });
}

export async function revalidatedContent(api, name, entry, { maxBytes = contentLimits.fileBytes, allowStreaming = false, signal, expectedToken } = {}) {
  signal?.throwIfAborted();
  expectedToken = expectedContentToken(expectedToken);
  name = capsuleName(name);
  if (entry !== undefined) entry = entryPath(entry);
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > contentLimits.fileBytes) throw new Error("原件缓冲上限无效");
  const cache = api.config?.home ? new ContentCache(api.config) : undefined;
  const identity = cache?.identity(name, entry);
  const read = async () => {
    signal?.throwIfAborted();
    const existing = await cache?.read(identity, maxBytes, { signal });
    const response = await api.response(api.path(name, "content", { entry }), {
      ...(existing ? { headers: { "If-None-Match": existing.etag } } : {}),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30 * 60 * 1000)]) : AbortSignal.timeout(30 * 60 * 1000),
    }, { allowNotModified: Boolean(existing) });
    if (signal?.aborted) { await response.body?.cancel(); signal.throwIfAborted(); }
    await assertContentVersion(response, expectedToken);
    if (response.status === 304) {
      if (!existing || response.headers.get("ETag") !== existing.etag) throw Object.assign(new Error("原件条件响应与缓存版本不一致"), { status: 502, code: "INVALID_RESPONSE" });
      return { response: bufferedResponse(response, existing.bytes), cacheHit: true, cached: true };
    }
    let size;
    try { size = declaredSize(response); } catch (error) { await response.body?.cancel(); throw error; }
    if (size === undefined || size > maxBytes) {
      if (allowStreaming) return { response, cacheHit: false, cached: false };
      if (size > maxBytes) { await response.body?.cancel(); throw tooLarge(); }
    }
    const etag = response.headers.get("ETag");
    if (allowStreaming && (!cache || !strongContentTag(etag))) return { response, cacheHit: false, cached: false };
    const bytes = await boundedBytes(response, maxBytes, signal);
    if (size !== undefined && bytes.length !== size) throw Object.assign(new Error("原件传输长度与响应不符"), { status: 502, code: "INVALID_RESPONSE" });
    signal?.throwIfAborted();
    const cached = Boolean(cache && strongContentTag(etag) && await cache.publish(identity, bytes, etag, { signal }));
    return { response: bufferedResponse(response, bytes), cacheHit: false, cached };
  };
  return cache ? cache.entry(identity, read, { signal }) : read();
}
