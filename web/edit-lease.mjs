import { action } from "./api.mjs";

const scopes = new Set(["content", "details", "database", "office"]);
const lost = () => Object.assign(new Error("编辑占用已失效，草稿保留。请重新占用编辑，再核对原版本。"), { code: "EDIT_LEASE_LOST", status: 409 });
const publicLease = (lease) => ({ id: lease.id, scope: lease.scope, owner: { id: lease.owner.id, name: lease.owner.name }, expiresAt: lease.expiresAt });

function receipt(value, id, { token = false } = {}) {
  if (!value?.lease || value.lease.id !== id || !scopes.has(value.lease.scope) || typeof value.lease.owner?.name !== "string" ||
      typeof value.lease.expiresAt !== "string" || !Number.isFinite(Date.parse(value.lease.expiresAt)) ||
      !Number.isFinite(value.ttlSeconds) || value.ttlSeconds <= 0 || token && (typeof value.lease.token !== "string" || !value.lease.token))
    throw new Error("编辑占用回执无效，请重新查询；草稿保留。");
  return value;
}

export function leaseMessage(state) {
  if (state?.status === "acquiring") return "正在获取编辑占用…";
  if (state?.status === "held") return "编辑占用中，完成保存或结束编辑后立即释放";
  const holders = state?.leases?.map((item) => item.owner?.name).filter(Boolean);
  if (state?.status === "busy") return `${holders?.length ? [...new Set(holders)].join("、") : "其他同事或Agent"}正在编辑，请等待释放；草稿保留。`;
  if (state?.status === "lost") return state.error?.message || lost().message;
  return "阅读不占用，开始编辑时获取占用";
}

// The transport owns one server lease. Expired or uncertain renewals never reacquire automatically.
export class EditLeaseSession {
  constructor({ request = action, onChange = () => {}, createId = () => crypto.randomUUID(), schedule = setTimeout,
    cancel = clearTimeout, now = Date.now, heartbeatMs = 5000, timeoutMs = 8000 } = {}) {
    Object.assign(this, { request, onChange, createId, schedule, cancel, now, heartbeatMs, timeoutMs });
    this.state = { status: "idle" };
    this.onPageHide = () => this.release();
    globalThis.window?.addEventListener?.("pagehide", this.onPageHide);
  }
  notify() { this.onChange(this.state); }
  get proof() { return this.state.status === "held" && this.now() < this.deadline ? this.token : undefined; }
  async call(operation, fields, options = {}) {
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(() => this.request(operation, fields, { ...options, signal: controller.signal })),
        new Promise((_resolve, reject) => { timer = this.schedule(() => { controller.abort(); reject(new Error("编辑占用请求超时，草稿保留，请查询原占用后重试。")); }, this.timeoutMs); timer?.unref?.(); }),
      ]);
    } finally { this.cancel(timer); }
  }
  async acquire(name, scope) {
    if (this.target?.name === name && this.target.scope === scope) {
      if (this.proof) return this.proof;
      if (this.acquiring) return this.acquiring;
    }
    this.release();
    const target = this.target = { name, scope, id: this.createId() };
    this.state = { status: "acquiring" }; this.notify();
    const pending = (async () => {
      try {
        const started = this.now();
        const result = receipt(await this.call("lease-acquire", target), target.id, { token: true });
        if (this.target !== target) return undefined;
        this.token = result.lease.token;
        this.deadline = Math.min(started + result.ttlSeconds * 1000, Date.parse(result.lease.expiresAt));
        if (this.now() >= this.deadline) throw lost();
        this.state = { status: "held", lease: publicLease(result.lease) }; this.notify();
        this.queue(target);
        return this.proof;
      } catch (error) {
        if (this.target === target) { this.token = undefined; this.state = { status: error.code === "EDIT_BUSY" ? "busy" : "lost", error, leases: error.leases }; this.notify(); }
        return undefined;
      } finally { if (this.acquiring === pending) this.acquiring = null; }
    })();
    this.acquiring = pending;
    return pending;
  }
  queue(target) {
    this.cancel(this.timer);
    this.timer = this.schedule(() => { if (this.target === target) void this.renew(target); }, this.heartbeatMs);
    this.timer?.unref?.();
    this.cancel(this.expiry);
    this.expiry = this.schedule(() => { if (this.target === target && this.state.status === "held") this.invalidate(lost()); }, Math.max(0, this.deadline - this.now()));
    this.expiry?.unref?.();
  }
  async renew(target = this.target) {
    if (!target || !this.proof) { if (this.target === target) this.invalidate(lost()); return; }
    try {
      const started = this.now();
      const result = receipt(await this.call("lease-renew", { name: target.name, id: target.id }, { lease: this.token }), target.id);
      if (this.target !== target || this.state.status !== "held") return;
      this.deadline = Math.min(started + result.ttlSeconds * 1000, Date.parse(result.lease.expiresAt));
      if (this.now() >= this.deadline) throw lost();
      this.state = { status: "held", lease: publicLease(result.lease) }; this.notify(); this.queue(target);
    } catch (error) { if (this.target === target) this.invalidate(error); }
  }
  invalidate(error = lost()) {
    this.cancel(this.timer); this.cancel(this.expiry); this.token = undefined;
    this.state = { status: "lost", error, leases: error.leases }; this.notify();
  }
  requireProof() { const value = this.proof; if (!value) throw lost(); return value; }
  release() {
    this.cancel(this.timer); this.cancel(this.expiry);
    const target = this.target, token = this.token;
    this.target = null; this.token = undefined; this.acquiring = null;
    this.state = { status: "idle" }; this.notify();
    if (!target) return Promise.resolve();
    // Release can overtake acquire. The server tombstone prevents the delayed POST from taking the cap.
    this.releasing = this.call("lease-release", { name: target.name, id: target.id }, { lease: token, keepalive: true })
      .catch((error) => { this.releaseError = error; });
    return this.releasing;
  }
  destroy() { this.release(); globalThis.window?.removeEventListener?.("pagehide", this.onPageHide); }
}

// Two panels in one tab share their exclusive cap lease. Closing one panel cannot release another's lease.
const channels = new Map();
export function editLease(onChange = () => {}) {
  let channel, generation = 0;
  const handle = {
    get state() { return channel?.session.state || { status: "idle" }; },
    get proof() { return channel?.session.proof; },
    capture() { return { channel, generation }; },
    requireProof() { if (!channel) throw lost(); return channel.session.requireProof(); },
    invalidate(error) { channel?.session.invalidate(error); },
    async acquire(name, scope) {
      const key = name + "\0" + (scope === "office" ? "office" : "exclusive");
      if (channel?.key !== key) handle.release();
      if (!channel) {
        channel = channels.get(key);
        if (!channel) {
          const entry = { key, listeners: new Map() };
          entry.session = new EditLeaseSession({ onChange: (state) => { for (const listener of entry.listeners.values()) listener(state); } });
          channels.set(key, entry); channel = entry;
        }
        channel.listeners.set(handle, onChange);
        generation++;
      }
      return channel.session.acquire(name, channel.session.target?.scope || scope);
    },
    release(ticket) {
      if (ticket && (ticket.channel !== channel || ticket.generation !== generation)) return Promise.resolve();
      if (!channel) return Promise.resolve();
      const previous = channel; channel = null;
      generation++;
      previous.listeners.delete(handle);
      onChange({ status: "idle" });
      if (previous.listeners.size) return Promise.resolve();
      channels.delete(previous.key);
      const releasing = previous.session.release();
      previous.session.destroy();
      return releasing;
    },
    destroy() { return handle.release(); },
  };
  return handle;
}

export async function withEditLease(name, scope, operation) {
  const lease = editLease();
  try {
    const proof = await lease.acquire(name, scope);
    if (!proof) throw Object.assign(new Error(leaseMessage(lease.state)), { code: lease.state.error?.code || "EDIT_LEASE_LOST", status: lease.state.error?.status || 409, leases: lease.state.leases });
    return await operation(proof);
  } finally { await lease.release(); }
}
