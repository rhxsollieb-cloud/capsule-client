import { action, readText } from "./api.mjs";
import { node, replace, shortCommit } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";

const states = { unregistered: "尚未注册到本机", registered: "已注册 · 未启动", starting: "正在启动", running: "协作页面运行中", stopping: "正在关闭", stopped: "协作页面已关闭", failed: "协作页面启动失败", unknown: "上次会话待核对" };

export class SkillView {
  constructor(container, cap, { isCurrent, onError, onRun, onOpenEntry, onSaved, onControlsChanged }) {
    Object.assign(this, { cap, isCurrent, onError, onRun, onOpenEntry, onSaved, onControlsChanged });
    this.request = 0;
    this.wrapper = node("div", "skill-view");
    this.notice = node("p", "skill-notice hidden");
    this.stage = node("div", "skill-stage");
    this.wrapper.append(this.notice, this.stage);
    replace(container, this.wrapper);
    this.refresh(cap);
  }
  active() { return !this.disposed && this.isCurrent(); }
  destroy() { this.disposed = true; this.request++; }
  async refresh(cap = this.cap) {
    this.cap = cap;
    if (!this.active() || this.busy || this.refreshing) return;
    const request = ++this.request;
    this.refreshRequest = request;
    this.refreshing = true;
    try {
      const status = await action("skill-status", { name: cap.name });
      if (!this.active() || request !== this.request) return;
      this.render(status);
    } catch (error) { if (this.active() && request === this.request) this.message(error.message, true); }
    finally { if (this.refreshRequest === request) { this.refreshing = false; this.refreshRequest = null; } }
  }
  message(text, error = false) {
    this.messageText = text;
    this.messageError = error;
    this.notice.textContent = text;
    this.notice.className = `skill-notice${error ? " error-message" : ""}${text ? "" : " hidden"}`;
    this.notifyControls();
  }
  render(status) {
    this.status = status;
    const text = status.needsConversion ? "此代码尚未整理为 Skill。转换会保留原代码，并建立 SKILL.md 和独立 CLI。"
      : status.updateAvailable ? "服务端已有新提交；当前页面继续使用已注册版本，关闭后再注册新版本。"
      : status.serverError || status.session?.error || status.lastSession?.error
      || "";
    this.message(text, Boolean(status.serverError || status.session?.error));
    const url = status.state === "running" ? status.session?.url : null;
    if (url && this.frameUrl !== url) {
      const frame = node("iframe", "skill-frame");
      frame.src = url;
      frame.title = `${this.cap.name} · 本机协作页面`;
      frame.referrerPolicy = "no-referrer";
      replace(this.stage, frame);
      this.frameUrl = url;
    } else if (!url) {
      if (this.frameUrl) { replace(this.stage); this.frameUrl = null; }
      this.loadManual();
    }
  }
  notifyControls() { if (this.active()) this.onControlsChanged?.(); }
  controlsInfo() {
    if (!this.active()) return null;
    const status = this.status;
    const running = ["running", "starting", "stopping"].includes(status?.state);
    const busy = Boolean(this.busy);
    const current = (callback, allowBusy = false) => () => { if (this.active() && (allowBusy || !this.busy)) return callback(); };
    let state = "clean", statusText = "";
    if (busy) {
      state = "loading";
      statusText = { "skill-register": "注册中", "skill-start": "启动中", "skill-stop": "关闭中", "convert-skill": "转换中" }[this.operation] || "处理中";
    } else if (this.messageError || status?.state === "failed") { state = "error"; statusText = status?.state === "failed" ? "启动失败" : "本机异常"; }
    else if (!status || ["starting", "stopping"].includes(status.state)) { state = "loading"; statusText = status ? states[status.state] : "读取本机状态"; }
    else if (status.needsConversion || status.updateAvailable || status.state === "unknown") {
      state = "warning";
      statusText = status.needsConversion ? "待转换" : status.updateAvailable ? "有新版本" : "会话待核对";
    }
    const moreItems = [
      !running && !status?.needsConversion && { label: status?.updateAvailable ? "注册新版本" : status?.registered ? "核对注册" : "注册到本机", icon: "download", disabled: busy || !status, action: current(() => this.perform("skill-register")) },
      status?.registered && status.hasUI && !running && !status.needsConversion && { label: "启动协作页面", icon: "play", disabled: busy, action: current(() => this.perform("skill-start")) },
      (running || status?.state === "unknown") && { label: status.state === "unknown" ? "核对旧会话" : "关闭协作页面", icon: "close", disabled: busy, action: current(() => this.perform("skill-stop")) },
      { label: "运行 Skill CLI", icon: "terminal", disabled: busy, action: current(() => this.onRun(this.cap)) },
      { label: "查看 SKILL.md", icon: "text", action: current(() => this.onOpenEntry("SKILL.md"), true) },
      status?.needsConversion && { label: "转换为 Skill", icon: "code", disabled: busy, action: current(() => this.perform("convert-skill")) },
      status?.cli && {
        label: "CLI 与本机状态", icon: "info",
        information: { title: "独立 CLI 与本机状态", values: [
          `CLI：${status.cli.command} ${status.cli.entry}`, `工作目录：${status.cli.cwd}`, `CAPSULE_SKILL_STATE=${status.cli.state}`,
          `通过客户端 run ${this.cap.name} -- 参数执行。Agent 可在同一状态目录下调用独立 CLI。`,
        ] },
      },
    ].filter(Boolean);
    const detail = [
      states[status?.state] || "读取本机状态…", status?.commit && `已注册提交：${shortCommit(status.commit)}`,
      status?.registered && !status.hasUI && "此 Skill 仅使用独立 CLI。", this.messageText,
    ].filter(Boolean).join("\n");
    return { state, statusText, detail, moreItems };
  }
  async loadManual() {
    if (this.manualCommit === this.cap.commit && this.manualSurface) {
      if (!this.stage.contains(this.manualSurface)) replace(this.stage, this.manualSurface);
      return;
    }
    if (this.readingManual) return;
    this.readingManual = true;
    const cap = this.cap;
    try {
      const record = await readText(cap.name, "SKILL.md", () => this.active() && this.cap.commit === cap.commit);
      if (!record || this.frameUrl || !this.active()) return;
      const body = record.body.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, "");
      this.manualSurface = node("div", "reading-surface");
      this.manualSurface.append(renderMarkdown(body, { name: cap.name, entry: "SKILL.md", onOpenEntry: this.onOpenEntry }));
      this.manualCommit = cap.commit;
      replace(this.stage, this.manualSurface);
    } catch (error) { if (this.active() && !this.status?.needsConversion) this.message(error.message, true); }
    finally { this.readingManual = false; }
  }
  async perform(operation) {
    if (this.busy || !this.active()) return;
    this.request++;
    this.refreshing = false;
    this.refreshRequest = null;
    this.busy = true;
    this.operation = operation;
    this.notifyControls();
    try {
      const result = await action(operation, { name: this.cap.name, ...(operation === "convert-skill" ? { token: this.cap.token } : {}) });
      if (operation === "convert-skill") this.onSaved(result);
      else if (this.active()) this.render(result);
    } catch (error) { if (this.active()) { this.message(error.message, true); this.onError(error); } }
    finally { this.busy = false; this.operation = null; if (this.active()) { this.notifyControls(); this.refresh(); } }
  }
}
