import { action } from "./api.mjs";
import { button, node } from "./dom.mjs";

let clientId;
export function tabClientId() { return clientId ||= crypto.randomUUID(); }

const scopes = { content: "正文", details: "属性说明", database: "数据库", office: "Office" };
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const failure = (value) => value && typeof value.code === "string" && Number.isInteger(value.status) &&
  (value.eventId === undefined || typeof value.eventId === "string");

function activityRecord(value, name) {
  if (!value || value.name !== name || !Array.isArray(value.editors) || !Array.isArray(value.events) ||
      !count(value.editorCount) || !count(value.eventCount) || typeof value.eventsTruncated !== "boolean" ||
      typeof value.office?.active !== "boolean" || typeof value.office?.saving !== "boolean" || !count(value.ttlSeconds) || value.ttlSeconds === 0 ||
      (value.editorsTruncated !== undefined && typeof value.editorsTruncated !== "boolean") ||
      (value.leases !== undefined && (!Array.isArray(value.leases) || value.leases.some((item) => !item || typeof item.id !== "string" ||
        !Object.hasOwn(scopes, item.scope) || typeof item.owner?.id !== "string" || typeof item.owner?.name !== "string" ||
        typeof item.expiresAt !== "string" || !Number.isFinite(Date.parse(item.expiresAt))))) ||
      (value.queue !== undefined && (!value.queue || !["closed", "starting", "running", "idle"].includes(value.queue.state) ||
        typeof value.queue.blocked !== "boolean" || !Array.isArray(value.queue.errors) || value.queue.errors.some((item) => !failure(item)) ||
        (value.queue.error !== undefined && !failure(value.queue.error)))) ||
      value.editors.some((item) => !Object.hasOwn(scopes, item.scope) || typeof item.dirty !== "boolean" || !count(item.count)) ||
      value.events.some((item) => !item || typeof item.id !== "string" || !["pending", "running"].includes(item.status)))
    throw new Error("活动状态回执无效");
  return value;
}

// Each panel owns its sessions; a late release must never remove a later selection's presence.
export class ActivitySession {
  constructor({ onChange = () => {}, request = action, schedule = setTimeout, cancel = clearTimeout,
    now = Date.now, createId = () => crypto.randomUUID(), ownerId = tabClientId(), heartbeatMs = 10000, dirtyDelayMs = 500, requestTimeoutMs = 8000,
    document: page = globalThis.document } = {}) {
    Object.assign(this, { onChange, request, schedule, cancel, now, createId, ownerId, heartbeatMs, dirtyDelayMs, requestTimeoutMs, page });
    this.onVisibility = () => {
      if (!this.target || this.target.scope) return;
      this.cancel(this.timer);
      if (!this.page.hidden) void this.refresh();
    };
    this.page?.addEventListener?.("visibilitychange", this.onVisibility);
    this.onPageHide = (event) => {
      this.suspended = event.persisted && this.target ? { name: this.target.name, scope: this.target.scope, entry: this.target.entry, dirty: this.target.dirty } : null;
      this.clear();
    };
    this.onPageShow = () => {
      const target = this.suspended;
      this.suspended = null;
      if (target) this.setTarget(target);
    };
    globalThis.window?.addEventListener?.("pagehide", this.onPageHide);
    globalThis.window?.addEventListener?.("pageshow", this.onPageShow);
  }
  setTarget(input) {
    if (!input) { this.clear(); return; }
    const target = this.target;
    if (target && target.name === input.name && target.scope === input.scope && target.entry === input.entry) {
      if (target.dirty !== Boolean(input.dirty)) {
        target.dirty = Boolean(input.dirty);
        target.due = this.now() + this.dirtyDelayMs;
        if (!target.inflight) this.queue(target, this.dirtyDelayMs);
      }
      return;
    }
    this.clear();
    this.target = { ...input, dirty: Boolean(input.dirty), sessionId: input.scope ? this.createId() : undefined };
    this.state = { known: false, checking: true };
    this.notify();
    void this.refresh();
  }
  notify() {
    try { this.onChange(this.state); }
    catch (error) { console.error("活动提示更新失败", error); }
  }
  queue(target, milliseconds) {
    this.cancel(this.timer);
    if (this.page?.hidden && !target.scope) return;
    this.timer = this.schedule(() => { if (this.target === target) void this.refresh(); }, milliseconds);
    this.timer?.unref?.();
  }
  beginRequest(operation, fields, { keepalive = false } = {}) {
    const controller = new AbortController();
    let cancel;
    const stopped = new Promise((_resolve, reject) => {
      cancel = (message = "活动查询已取消") => { controller.abort(); reject(new Error(message)); };
    });
    const timeout = this.schedule(() => cancel("活动查询超时，无法确认当前状态"), this.requestTimeoutMs);
    timeout?.unref?.();
    const request = Promise.resolve().then(() => this.request(operation, fields, { signal: controller.signal, keepalive }));
    const promise = Promise.race([request, stopped]).finally(() => this.cancel(timeout));
    return { promise, cancel };
  }
  async refresh() {
    const target = this.target;
    if (!target || target.inflight || this.page?.hidden && !target.scope) return;
    this.cancel(this.timer);
    target.due = undefined;
    try {
      const fields = { name: target.name, clientId: this.ownerId };
      if (target.scope) Object.assign(fields, { sessionId: target.sessionId, scope: target.scope, dirty: target.dirty,
        ...(target.entry === undefined ? {} : { entry: target.entry }) });
      target.request = this.beginRequest(target.scope ? "activity-heartbeat" : "activity", fields);
      target.inflight = target.request.promise;
      const data = activityRecord(await target.inflight, target.name);
      if (this.target === target) { this.state = { known: true, data }; this.notify(); }
    } catch (error) {
      if (this.target === target) { this.state = { known: false, checking: false, error: error.message || "连接失败" }; this.notify(); }
    } finally {
      target.request = null;
      target.inflight = null;
      if (this.target === target) this.queue(target, target.due === undefined ? this.heartbeatMs : Math.max(0, target.due - this.now()));
    }
  }
  clear() {
    this.cancel(this.timer);
    const target = this.target;
    this.target = null;
    this.state = null;
    if (!target) return;
    target.request?.cancel();
    this.notify();
    if (!target.scope) return;
    // Abort this panel's old request, then release its independent session. TTL covers unreachable releases.
    this.releasing = Promise.resolve(target.inflight).catch(() => {}).then(() => this.beginRequest("activity-release", {
      name: target.name, clientId: this.ownerId, sessionId: target.sessionId,
    }, { keepalive: true }).promise).catch((error) => { this.releaseError = error; });
  }
  destroy() {
    this.clear();
    this.suspended = null;
    globalThis.window?.removeEventListener?.("pagehide", this.onPageHide);
    globalThis.window?.removeEventListener?.("pageshow", this.onPageShow);
    this.page?.removeEventListener?.("visibilitychange", this.onVisibility);
  }
}

export function activityPresentation(state) {
  const detail = ["编辑占用会阻止其他写入，保存仍核对原版本；活动会话数不是人数。"];
  if (!state) return { label: "", detail };
  if (!state.known) return {
    label: state.checking ? "正在查询占用" : "占用状态未知", unknown: true,
    detail: [...detail, state.checking ? "正在查询服务端真实状态。" : "连接或回执异常，不能确认当前编辑与队列状态。", ...(state.error ? [String(state.error).slice(0, 240)] : [])],
  };
  const value = state.data;
  const labels = [];
  if (value.leases?.length) {
    const owners = [...new Set(value.leases.map((item) => item.owner.name))];
    labels.push(`${owners.slice(0, 2).join("、")}${owners.length > 2 ? "等" : ""}正在编辑`);
    for (const lease of value.leases) detail.push(`${lease.owner.name} · ${scopes[lease.scope]} · 占用到 ${new Date(lease.expiresAt).toLocaleTimeString("zh-CN", { hour12: false })}`);
  }
  const queueErrors = [...(value.queue?.errors || []), ...(value.queue?.error ? [value.queue.error] : [])];
  const lockWait = value.queue?.blocked && queueErrors.length > 0 && queueErrors.every((error) => error.code === "LOCK_BUSY");
  if (value.queue?.blocked) labels.push(lockWait ? "等待占用释放" : value.queue.errors.length ? "事件待恢复" : "队列异常");
  for (const error of value.queue?.errors || []) detail.push(`${error.code === "LOCK_BUSY" ? "等待占用释放" : "事件待恢复"}：${error.code || "未知错误"}${error.status ? `（${error.status}）` : ""}${error.eventId ? ` · ${error.eventId}` : ""}`);
  if (value.queue?.error) detail.push(`${value.queue.error.code === "LOCK_BUSY" ? "等待占用释放" : "队列异常"}：${value.queue.error.code || "未知错误"}${value.queue.error.status ? `（${value.queue.error.status}）` : ""}`);
  if (value.editorCount) {
    labels.push(`另有 ${value.editorCount} 个编辑会话${value.editors.some((item) => item.dirty) ? " · 有待保存更改" : ""}`);
    for (const item of value.editors) detail.push(`${scopes[item.scope]}${item.entry ? ` · ${item.entry}` : ""}：${item.count} 个会话${item.dirty ? "，有待保存更改" : ""}`);
    if (value.editorsTruncated) detail.push("编辑会话分组较多，仅显示部分；总会话数仍为完整统计。");
  }
  const running = value.events.filter((event) => event.status === "running").length;
  const pending = value.events.filter((event) => event.status === "pending").length;
  if (running) labels.push("事件处理中");
  if (pending) labels.push("事件排队中");
  if (value.eventCount && !value.events.length) labels.push("有未完成事件");
  for (const event of value.events) detail.push(`${event.status === "running" ? "处理中" : "排队"}：${event.type || "事件"} · ${event.id}`);
  if (value.eventsTruncated) detail.push(`共 ${value.eventCount} 项未完成事件，仅显示部分；可在事件面板继续查询。`);
  if (value.office.saving) labels.push("Office保存中");
  else if (value.office.active) labels.push("Office会话中");
  detail.push(`仅统计其他客户端的编辑提示；Office状态包含本客户端。心跳过期 ${value.ttlSeconds} 秒后自动清理。`);
  return { label: labels.join(" · "), detail, warning: Boolean(value.queue?.blocked && !lockWait) };
}

export function showActivityInformation(state) {
  const dialog = node("dialog", "document-info activity-info");
  const body = node("div", "document-info-body");
  body.append(node("h2", "", "胶囊活动"));
  for (const text of activityPresentation(state).detail) body.append(node("p", "", text));
  body.append(button("关闭", () => dialog.close()));
  dialog.append(body);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  document.body.append(dialog);
  dialog.showModal();
}

export class ActivityIndicator {
  constructor({ onOpen = showActivityInformation } = {}) {
    this.element = button("", () => onOpen(this.state), "activity-indicator hidden");
    this.element.setAttribute("aria-live", "polite");
  }
  update(state) {
    this.state = state;
    const { label, unknown, warning } = activityPresentation(state);
    this.element.textContent = label;
    this.element.title = label ? label + "；点击查看活动详情" : "";
    this.element.className = `activity-indicator${unknown || warning ? " activity-unknown" : ""}${label ? "" : " hidden"}`;
  }
}
