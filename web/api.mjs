let csrfToken;

async function payload(response) {
  let value;
  try { value = await response.json(); } catch { value = {}; }
  if (!response.ok) {
    const error = new Error(value.error || `请求失败（${response.status}）`);
    Object.assign(error, { status: response.status, code: value.code, eventId: value.eventId, result: value.result });
    throw error;
  }
  return value;
}

export async function initialize() {
  const session = await payload(await fetch("/ui/session", { cache: "no-store" }));
  csrfToken = session.csrfToken;
  return session;
}

export async function action(name, fields = {}) {
  return payload(await fetch("/ui/action", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Capsule-Session": csrfToken },
    body: JSON.stringify({ action: name, ...fields }),
  }));
}

export function contentUrl(name, entry, download = false) {
  const query = new URLSearchParams({ name });
  if (entry !== undefined) query.set("entry", entry);
  if (download) query.set("download", "1");
  return `/ui/content?${query}`;
}

export async function upload(name, entry, file, token) {
  const query = new URLSearchParams({ name });
  if (entry !== undefined) query.set("entry", entry);
  return payload(await fetch(`/ui/upload?${query}`, {
    method: "PUT",
    headers: { "X-Capsule-Session": csrfToken, "If-Match": token },
    body: file,
  }));
}

export async function readText(name, entry, isCurrent) {
  const parts = [];
  let from = 1;
  let record;
  do {
    const next = await action("read", { name, entry, from, limit: 10000 });
    if (!isCurrent()) return null;
    if (record && next.token !== record.token)
      throw new Error("读取期间内容已变化，请刷新后重试；已有草稿保留。");
    record = next;
    parts.push(next.body);
    from = next.lines.nextLine;
  } while (from !== null && from !== undefined);
  return { ...record, body: parts.join("\n") };
}
