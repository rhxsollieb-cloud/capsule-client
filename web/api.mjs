let csrfToken;
const inflight = new Map();
const sharedReads = new Set(["health", "me", "stat", "entries", "read", "details", "list", "ls", "where", "overview",
  "search", "history", "events", "event", "position", "activity", "office-status", "office-session", "skill-status", "table", "query"]);

async function payload(response) {
  let value;
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) {
    const error = new Error(value.error || `请求失败（${response.status}）`);
    Object.assign(error, { status: response.status, code: value.code, eventId: value.eventId, operationId: value.operationId, result: value.result, uncertain: value.uncertain, leases: value.leases });
    throw error;
  }
  return value;
}

export async function initialize() {
  const session = await payload(await fetch("/ui/session", { cache: "no-store" }));
  const sessionChanged = csrfToken !== undefined && csrfToken !== session.csrfToken;
  inflight.clear();
  csrfToken = session.csrfToken;
  return { ...session, sessionChanged };
}

export function isSessionFailure(error) {
  return error?.status === 401 || error?.status === 403 && /本地会话已失效/u.test(error.message || "");
}

export function connectionStatus() {
  return fetch("/ui/auth/status", { cache: "no-store" }).then(payload);
}

export function connectionAction(operation, values = {}) {
  inflight.clear();
  return fetch(`/ui/auth/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Capsule-Session": csrfToken },
    body: JSON.stringify(values),
  }).then(payload);
}

export async function action(name, fields = {}, { signal, keepalive = false, lease } = {}) {
  const reading = sharedReads.has(name);
  if (!reading) inflight.clear();
  const body = JSON.stringify({ action: name, ...fields });
  const key = reading && !signal && !keepalive && !lease ? csrfToken + "\0" + body : undefined;
  if (key && inflight.has(key)) return inflight.get(key).then((value) => structuredClone(value));
  const request = Promise.resolve(fetch("/ui/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Capsule-Session": csrfToken, ...(lease ? { "X-Capsule-Lease": lease } : {}) },
    body,
    ...(signal ? { signal } : {}),
    ...(keepalive ? { keepalive: true } : {}),
  })).then(payload).finally(() => { if (!reading) inflight.clear(); });
  if (!key) return request;
  const shared = request.finally(() => { if (inflight.get(key) === shared) inflight.delete(key); });
  inflight.set(key, shared);
  return shared.then((value) => structuredClone(value));
}

export async function readIdentity() {
  try { return await action("me"); }
  catch (error) {
    if ([400, 404].includes(error.status) && /未知客户端操作|接口不存在|not found/i.test(error.message)) {
      error.code = "IDENTITY_API_UNAVAILABLE";
      error.message = "客户端或服务端尚未提供身份接口。请先保存未提交内容，再同步更新并重启两端服务；不会退回匿名访问。";
    }
    throw error;
  }
}

export function contentUrl(name, entry, download = false) {
  const query = new URLSearchParams({ name });
  if (entry !== undefined) query.set("entry", entry);
  if (download) query.set("download", "1");
  return sessionUrl("/ui/content", query);
}

export function sessionUrl(path, values) {
  const query = new URLSearchParams(values);
  if (csrfToken !== undefined) query.set("session", csrfToken);
  return path + "?" + query;
}

export function rebindSessionUrls(root = globalThis.document, baseUrl = globalThis.location?.href || "http://capsule.local/") {
  if (csrfToken === undefined || !root?.querySelectorAll) return 0;
  const origin = new URL(baseUrl).origin;
  const paths = new Set(["/ui/content", "/ui/office/recovery", "/ui/admin/backup-content"]);
  let changed = 0;
  for (const element of root.querySelectorAll("[src], [href]")) {
    for (const attribute of ["src", "href"]) {
      const raw = element.getAttribute(attribute);
      if (!raw) continue;
      let url;
      try { url = new URL(raw, baseUrl); } catch { continue; }
      if (url.origin !== origin || !paths.has(url.pathname) || url.searchParams.get("session") === csrfToken) continue;
      url.searchParams.set("session", csrfToken);
      element.setAttribute(attribute, raw.startsWith("/") ? url.pathname + url.search + url.hash : url.href);
      changed++;
    }
  }
  return changed;
}

export async function upload(name, entry, file, token, { lease } = {}) {
  inflight.clear();
  const query = new URLSearchParams({ name });
  if (entry !== undefined) query.set("entry", entry);
  try {
    return await payload(await fetch(`/ui/upload?${query}`, {
      method: "PUT",
      headers: { "X-Capsule-Session": csrfToken, "If-Match": token, ...(lease ? { "X-Capsule-Lease": lease } : {}) },
      body: file,
    }));
  } finally { inflight.clear(); }
}

async function readPages(operation, name, entry, isCurrent) {
  const parts = [];
  let from = 1;
  let record;
  do {
    const next = await action(operation, { name, ...(entry === undefined ? {} : { entry }), from, limit: 10000 });
    if (!isCurrent()) return null;
    if (record && next.token !== record.token)
      throw new Error("读取期间内容已变化，请刷新后重试；已有草稿保留。");
    record = next;
    parts.push(next.body);
    from = next.lines.nextLine;
  } while (from !== null && from !== undefined);
  return { ...record, body: parts.join("\n") };
}

export function readText(name, entry, isCurrent) { return readPages("read", name, entry, isCurrent); }
export function readDetails(name, isCurrent) { return readPages("details", name, undefined, isCurrent); }
