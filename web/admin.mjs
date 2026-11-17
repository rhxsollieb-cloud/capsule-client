import { action, readIdentity } from "./api.mjs";
import { button, node, replace } from "./dom.mjs";
import { details, form, input, oneTimeCredential, pagination, roleLabels, rows, section } from "./admin-common.mjs";
import { usersPage } from "./admin-users.mjs";
import { accessPage } from "./admin-access.mjs";
import { backupsPage } from "./admin-backups.mjs";

export class Administration {
  constructor({ onError, onIdentity, getCap = () => null }) {
    Object.assign(this, { onError, onIdentity, getCap });
    this.element = node("dialog", "admin-dialog");
    this.element.setAttribute("aria-label", "账户与知识库管理");
    this.element.addEventListener("cancel", (event) => { if (this.busy) event.preventDefault(); });
    this.element.addEventListener("close", () => { this.request++; if (this.secretBox) replace(this.secretBox); replace(this.element); });
    document.body.append(this.element);
    this.request = 0;
  }
  async open() {
    if (this.element.open) return;
    const heading = node("div", "dialog-header");
    heading.append(node("h2", "", "账户与管理"), button("×", () => { if (!this.busy) this.element.close(); }, "icon-button"));
    this.tabs = node("nav", "admin-tabs");
    this.note = node("p", "admin-note"); this.note.setAttribute("role", "status");
    this.secretBox = node("div", "admin-secret-box");
    this.body = node("div", "admin-body");
    replace(this.element, heading, this.tabs, this.note, this.secretBox, this.body);
    this.element.showModal();
    await this.load("identity");
  }
  error(error) { if (this.element.open) { this.note.textContent = `${error.message}${error.code ? ` · ${error.code}` : ""}${error.operationId ? ` · 操作ID：${error.operationId}` : ""}`; this.note.classList.add("error-message"); } }
  secret(result) {
    const token = oneTimeCredential(result);
    if (typeof token !== "string") return;
    const value = input("一次性凭据", token); value.control.readOnly = true; value.control.spellcheck = false;
    const copy = button("复制凭据", async () => {
      try { await navigator.clipboard.writeText(value.control.value); copy.textContent = "已复制"; }
      catch { value.control.focus(); value.control.select(); copy.textContent = "请手动复制"; }
    });
    replace(this.secretBox, section("请立即保存", node("p", "", "这是兼容旧脚本的访问令牌，仅显示一次。人与 Agent 均可使用用户名密码登录，无需额外签发令牌；不要将此令牌发送到聊天或提交Git。"), value.field, copy));
  }
  async perform(operation, value, onResult, onFailure) {
    if (this.busy || !this.element.open) return;
    this.busy = true;
    this.body.inert = true; this.tabs.inert = true;
    this.element.classList.add("admin-busy");
    this.note.classList.remove("error-message"); this.note.textContent = "正在处理，请等待操作回执…";
    try {
      const result = await action(operation, value);
      if (this.element.open) { this.note.textContent = "操作已完成"; await onResult?.(result); }
    } catch (error) { this.error(error); onFailure?.(error); }
    finally { this.busy = false; this.body.inert = false; this.tabs.inert = false; this.element.classList.remove("admin-busy"); }
  }
  async load(tab, offset = 0, keepSecret = false) {
    if (this.busy && tab !== this.tab) return;
    this.tab = tab; this.offset = offset;
    const request = ++this.request;
    const current = () => this.element.open && this.request === request;
    if (!keepSecret) replace(this.secretBox);
    replace(this.body, node("p", "loading", "正在读取…"));
    const context = { body: this.body, current, capName: this.getCap()?.name,
      load: (next, position) => this.load(next, position), reload: (keep) => this.load(tab, offset, keep),
      error: (error) => { if (current()) this.error(error); }, secret: (result) => { if (current()) this.secret(result); },
      perform: (...args) => current() ? this.perform(...args) : undefined };
    try {
      const identity = await readIdentity();
      if (!current()) return;
      this.identity = identity;
      this.onIdentity?.(identity);
      const manager = identity.permissions?.manage || identity.principal?.role === "admin";
      replace(this.tabs, ...[["identity", "当前身份"], ...(manager ? [["users", "用户与凭据"], ["grants", "胶囊权限"], ["audit", "审计"], ["backups", "备份与恢复"]] : [])].map(([key, label]) => button(label, () => { if (!this.busy) this.load(key); }, `tab-button${tab === key ? " active" : ""}`)));
      if (tab !== "identity" && !manager) throw new Error("当前身份没有管理权限");
      if (tab === "users") await usersPage(context, offset);
      else if (tab === "grants") await accessPage(context);
      else if (tab === "backups") await backupsPage(context, offset);
      else if (tab === "audit") await this.audit(context, offset);
      else replace(this.body, section("当前连接身份", details({ ...identity.principal, roleLabel: roleLabels[identity.principal?.role], permissions: identity.permissions }),
        node("p", "property-note", "人与 Agent 均通过用户名密码登录，CLI 默认复用本机当前会话。已有脚本仍可显式配置兼容访问令牌；本页面不回显已有令牌。")));
    } catch (error) { if (current()) { this.error(error); replace(this.body, node("p", "error-message", "读取未完成，请核对连接身份后重试。")); } }
  }
  async audit(context, offset) {
    const filters = this.auditFilters || {};
    const name = input("cap 名称", filters.name || "");
    const operation = input("操作", filters.operation || "");
    const outcome = input("结果", filters.outcome || "");
    const records = await action("audit", { ...filters, limit: 30, offset });
    if (!context.current()) return;
    const controls = form([name.field, operation.field, outcome.field], "过滤审计", () => {
      this.auditFilters = Object.fromEntries([["name", name.control.value.trim()], ["operation", operation.control.value.trim()], ["outcome", outcome.control.value.trim()]].filter(([, value]) => value));
      this.load("audit");
    });
    replace(context.body, section("操作审计", controls,
      rows(records.items, [["createdAt", "时间"], [(item) => item.actorName || item.principal?.name || item.actorId || "—", "操作者"], ["action", "操作"], ["name", "cap"], ["outcome", "结果"]], (item) => [button("详情", () => this.inspectAudit(item))]),
      pagination(records, offset, (next) => context.load("audit", next))));
  }
  inspectAudit(item) { this.body.append(section("审计详情", details(item))); }
}
