import { action } from "./api.mjs";
import { node, replace, shortCommit, timeLabel } from "./dom.mjs";

const labels = { pending: "排队中", running: "处理中", succeeded: "已完成", failed: "失败", conflict: "版本冲突" };
const typeLabels = { create: "创建", write: "写入", metadata: "属性", revert: "回撤" };

export class EventPanel {
  constructor({ onError, onReverted }) {
    this.element = document.getElementById("panel");
    this.body = document.getElementById("panel-body");
    this.mode = "events";
    this.onError = onError;
    this.onReverted = onReverted;
    this.polling = false;
    document.getElementById("panel-events").addEventListener("click", () => this.open("events"));
    document.getElementById("panel-output").addEventListener("click", () => this.open("output"));
    document.getElementById("panel-close").addEventListener("click", () => this.close());
    document.getElementById("panel-refresh").addEventListener("click", () => this.refresh());
  }
  open(mode = "events") {
    this.element.classList.remove("hidden");
    this.mode = mode;
    document.getElementById("activity-events").classList.add("active");
    document.getElementById("panel-events").classList.toggle("active", mode === "events");
    document.getElementById("panel-output").classList.toggle("active", mode === "output");
    this.refresh();
  }
  close() {
    this.element.classList.add("hidden");
    document.getElementById("activity-events").classList.remove("active");
  }
  async refresh() {
    if (this.mode === "output") {
      this.renderOutput();
      return;
    }
    if (this.polling) return;
    this.polling = true;
    try {
      const result = await action("events", { limit: 30 });
      if (this.mode === "events") this.renderEvents(result.items);
    } catch (error) { this.onError(error); }
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
    this.open("events");
    let current = event;
    try {
      while (["pending", "running"].includes(current.status)) {
        await new Promise((resolve) => setTimeout(resolve, 700));
        current = await action("event", { id: event.id });
        if (!this.element.classList.contains("hidden") && this.mode === "events") await this.refresh();
      }
      if (current.status === "succeeded") this.onReverted(current);
      else throw new Error(`事件 ${current.id} ${labels[current.status] || current.status}：${current.error?.message || "请核对事件记录"}`);
    } catch (error) {
      this.onError(new Error(`${error.message} · 事件 ${event.id}，请查看事件状态，勿重复提交。`));
    }
    return current;
  }
  startPolling() {
    this.timer = setInterval(() => {
      if (!this.element.classList.contains("hidden") && this.mode === "events") this.refresh();
    }, 3000);
  }
}
