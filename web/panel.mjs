import { action } from "./api.mjs";
import { node, replace, shortCommit, timeLabel } from "./dom.mjs";
import { startPolling, waitUntilVisible } from "./polling.mjs";

const labels = { pending: "排队中", running: "处理中", succeeded: "已完成", failed: "失败", conflict: "版本冲突" };
const typeLabels = { create: "创建", write: "写入", metadata: "属性", revert: "回撤", delete: "清除", organize: "位置组织" };
const needsAttention = (event) => ["failed", "conflict"].includes(event.status) || Boolean(event.error);

export class EventPanel {
  constructor({ onError, onReverted, onDeleted, onAttention, onVisibility }) {
    this.element = document.getElementById("panel");
    this.body = document.getElementById("panel-body");
    this.mode = "events";
    this.onError = onError;
    this.onReverted = onReverted;
    this.onDeleted = onDeleted;
    this.watched = new Map();
    this.finishing = new Set();
    this.onAttention = onAttention;
    this.onVisibility = onVisibility;
    this.seen = new Set();
    this.events = [];
    this.polling = false;
    document.getElementById("panel-events").addEventListener("click", () => this.open("events"));
    document.getElementById("panel-output").addEventListener("click", () => this.open("output"));
    document.getElementById("panel-close").addEventListener("click", () => this.close());
    document.getElementById("panel-refresh").addEventListener("click", () => this.refresh());
  }
  open(mode = "events") {
    this.element.classList.remove("hidden");
    this.mode = mode;
    if (mode === "events") {
      this.events.filter(needsAttention).forEach((event) => this.seen.add(event.id));
      this.onAttention?.(0);
    }
    this.onVisibility?.(true);
    document.getElementById("panel-events").classList.toggle("active", mode === "events");
    document.getElementById("panel-output").classList.toggle("active", mode === "output");
    this.refresh();
  }
  close() {
    this.element.classList.add("hidden");
    this.onVisibility?.(false);
  }
  async refresh({ eventsOnly = false, quiet = false } = {}) {
    if (this.mode === "output" && !eventsOnly) {
      this.renderOutput();
      return;
    }
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await action("events", { limit: 30 });
      this.events = result.items;
      for (const event of result.items) await this.finish(event);
      const listed = new Set(result.items.map((event) => event.id));
      for (const id of this.watched.keys()) if (!listed.has(id)) await this.finish(await action("event", { id }));
      const visible = this.mode === "events" && !this.element.classList.contains("hidden");
      if (visible) result.items.filter(needsAttention).forEach((event) => this.seen.add(event.id));
      this.onAttention?.(result.items.filter((event) => needsAttention(event) && !this.seen.has(event.id)).length);
      if (visible) this.renderEvents(result.items);
    } catch (error) { if (!quiet) this.onError(error); }
    finally { this.polling = false; }
  }
  renderEvents(events) {
    const list = node("div", "event-list");
    if (!events.length) list.append(node("p", "muted panel-empty", "还没有事件记录"));
    for (const event of events) {
      const row = node("div", "event-row");
      const state = node("span", `event-status status-${event.status}`, labels[event.status] || event.status);
      const name = node("span", "event-name", event.name);
      const detail = node("span", "muted", `${typeLabels[event.type] || event.type} · ${event.id.slice(0, 8)}`);
      detail.title = event.id;
      row.append(state, name, detail, node("time", "muted event-time", timeLabel(event.createdAt)));
      if (event.error) {
        const error = node("div", "event-error error-message", event.error.message || String(event.error));
        row.append(error);
      }
      list.append(row);
    }
    replace(this.body, list);
  }
  showRun(result) {
    this.output = result;
    this.open("output");
  }
  renderOutput() {
    if (!this.output) {
      replace(this.body, node("p", "muted panel-empty", "运行代码 cap 后在这里查看结果"));
      return;
    }
    const result = this.output;
    const header = node("div", "run-summary");
    header.append(node("strong", "", result.name || "运行结果"), node("span", "mono muted", shortCommit(result.commit)), node("span", result.exitCode === 0 ? "status-succeeded" : "status-failed", result.exitCode === undefined ? "执行失败" : `退出码 ${result.exitCode}`));
    const pre = node("pre", "run-output", [result.stdout, result.stderr, result.error].filter(Boolean).join("\n") || "（没有输出）");
    if (result.logError) pre.append(node("span", "error-message", `\n日志记录异常\n${JSON.stringify(result.logError, null, 2)}`));
    replace(this.body, header, pre);
  }
  async watch(event) {
    this.watched.set(event.id, event);
    this.open("events");
    let current = event;
    try {
      while (["pending", "running"].includes(current.status)) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        await waitUntilVisible();
        current = await action("event", { id: event.id });
        const listed = this.events.findIndex((event) => event.id === current.id);
        if (listed >= 0) this.events[listed] = current;
        if (!this.element.classList.contains("hidden") && this.mode === "events") this.renderEvents(this.events);
      }
      await this.finish(current);
    } catch (error) {
      this.refresh({ eventsOnly: true, quiet: true });
      this.onError(new Error(`${error.message} · 事件 ${event.id}，请查看事件状态，勿重复提交。`));
    }
    return current;
  }
  async finish(event) {
    if (!this.watched.has(event.id) || ["pending", "running"].includes(event.status)) return;
    if (this.finishing.has(event.id)) return;
    this.finishing.add(event.id);
    try {
      if (event.status === "succeeded") {
        if (event.type === "delete") {
          if (event.result?.removed !== true || event.result.name !== event.name) {
            this.watched.delete(event.id);
            this.onError(new Error(`清除事件 ${event.id} 的结果不完整，请核对原事件`));
            return;
          }
          await this.onDeleted?.(event);
        }
        else if (event.type === "revert") await this.onReverted?.(event);
      } else this.onError(new Error(`事件 ${event.id} ${labels[event.status] || event.status}：${event.error?.message || "请核对事件记录"}`));
      this.watched.delete(event.id);
    } finally { this.finishing.delete(event.id); }
  }
  startPolling() {
    this.poller?.stop();
    this.poller = startPolling(() => {
      const visible = !this.element.classList.contains("hidden") && this.mode === "events";
      return this.refresh(visible ? {} : { eventsOnly: true, quiet: true });
    }, { interval: () => !this.element.classList.contains("hidden") && this.mode === "events" ? 3000 : 30000, immediate: true });
  }
}
