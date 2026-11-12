export function uiError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

export function json(response, status, value) {
  const bytes = Buffer.from(JSON.stringify(value) + "\n");
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": bytes.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
  });
  response.end(bytes);
}

export async function requestJson(request) {
  if (!request.headers["content-type"]?.startsWith("application/json"))
    throw uiError("操作请求需要JSON", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      request.resume();
      throw uiError("请求超过1MiB", 413);
    }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw uiError("操作请求需要JSON对象");
    return value;
  } catch (error) {
    if (error.status) throw error;
    throw uiError("JSON格式无效");
  }
}

export function errorResult(error, api) {
  const scrub = (value) => {
    if (typeof value === "string") return api.redact(value);
    if (Array.isArray(value)) return value.map(scrub);
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    return value;
  };
  return scrub({
    error: error.message || "本地客户端操作失败",
    ...(typeof error.code === "string" ? { code: error.code } : {}),
    ...(error.eventId ? { eventId: error.eventId } : {}),
    ...(error.result ? { result: error.result } : {}),
  });
}
