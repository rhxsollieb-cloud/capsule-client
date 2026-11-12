import { action } from "./api.mjs";
import { button, node, replace, shortCommit } from "./dom.mjs";
import { downloadButton } from "./views.mjs";
import { loadOfficeApi } from "./office-loader.mjs";
import { OfficeState } from "./office-state.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class OfficeView {
  constructor(container, cap, entry, { isCurrent, onError, onSaved, onDirty, onReload }) {
    Object.assign(this, { container, cap, entry, isCurrent, onError, onSaved, onDirty, onReload });
    this.state = new OfficeState(cap);
    this.wrapper = node("div", "onlyoffice-view");
    this.toolbar = node("div", "reading-toolbar onlyoffice-toolbar");
    this.saveButton = button("保存到 cap", () => this.save(), "button primary");
    this.saveButton.title = "确认文档服务中的修改已写入cap版本，完成后再切换内容";
    this.reloadButton = button("重新打开当前版本", () => this.onReload(), "button ghost");
    this.note = node("span", "onlyoffice-note", "正在连接文档服务…");
    this.toolbar.append(node("span", "content-eyebrow", "ONLYOFFICE DOCS"), this.note, this.saveButton, this.reloadButton, downloadButton(cap.name, entry));
    this.notice = node("div", "onlyoffice-notice hidden");
    this.recovery = node("a", "button secondary hidden", "下载冲突恢复原件");
    this.stage = node("div", "onlyoffice-stage");
    this.mount = node("div", "onlyoffice-mount");
    this.mount.id = `office-${crypto.randomUUID()}`;
    this.stage.append(this.mount);
    this.wrapper.append(this.toolbar, this.notice, this.recovery, this.stage,
      node("p", "onlyoffice-hint", "编辑器保存后，使用“保存到 cap”确认版本提交；未完成的修改在切换前会继续保留。"));
    replace(container, this.wrapper);
    this.open();
  }
  hasDirty() { return this.state.hasDirty(); }
  active() { return !this.disposed && this.isCurrent(); }
  controls() {
    this.saveButton.disabled = !this.ready || this.state.saving || !this.state.dirty || ["conflict", "error", "closed"].includes(this.state.session?.status);
    this.reloadButton.disabled = this.state.saving;
    if (this.state.saving) this.note.textContent = "正在保存，等待 cap 提交确认…";
    else if (this.state.dirty) this.note.textContent = `有未保存修改 · 基于 ${shortCommit(this.state.cap.commit)}`;
    else if (this.ready) this.note.textContent = `已保存 · ${shortCommit(this.state.cap.commit)}`;
    if (this.state.remote && !["conflict", "error"].includes(this.state.session?.status)) this.message("cap已有外部新版本。当前编辑会话已保留，保存将核对原版本。");
    this.onDirty?.();
  }
  message(text, error = false) {
    this.notice.textContent = text;
    this.notice.className = `onlyoffice-notice${error ? " error-message" : ""}${text ? "" : " hidden"}`;
  }
  async open() {
    this.controls();
    try {
      const status = await action("office-status");
      if (!this.active()) return;
      this.available = status.configured && status.available;
      if (!status.configured || !status.available) throw new Error(status.error?.message || status.error || "ONLYOFFICE文档服务尚未就绪，请检查配置并重试");
      const session = await action("office-open", { name: this.cap.name, entry: this.entry, token: this.cap.token });
      if (!this.active()) return;
      this.session = session;
      this.state.receive(session);
      const api = await loadOfficeApi(session.editorUrl);
      if (!this.active()) return;
      this.editor = new api.DocEditor(this.mount.id, {
        ...session.config,
        events: {
          onDocumentReady: () => { if (this.active()) { this.ready = true; this.message(""); this.controls(); } },
          onDocumentStateChange: ({ data }) => { if (this.active()) { this.state.changed(data === true); this.controls(); } },
          onError: ({ data }) => { if (this.active()) this.fail(new Error(data?.errorDescription || `文档编辑器错误 ${data?.errorCode || ""}`)); },
          onRequestRefreshFile: () => { if (this.active()) this.message("此编辑会话已结束，请保存或下载当前内容后重新打开。"); },
        },
      });
      this.pollTimer = setInterval(() => this.poll(), 2000);
    } catch (error) {
      if (!this.active()) return;
      this.note.textContent = this.available ? "文档未能打开" : "文档服务未就绪";
      this.message(error.message, true);
      this.stage.append(node("p", "onlyoffice-unavailable", this.available
        ? "请核对原件格式和版本后重新打开。原件仍可下载查看。"
        : "请启动ONLYOFFICE Docs后点击“重新打开当前版本”。原件仍可下载查看。"));
      this.onError(error);
    }
  }
  receive(session) {
    const previousVersion = this.state.saveVersion;
    this.state.receive(session);
    if (session.result && session.saveVersion > previousVersion) this.onSaved?.(session.result);
    if (session.recoveryAvailable) {
      this.recovery.href = `/ui/office/recovery?${new URLSearchParams({ id: session.id })}`;
      this.recovery.classList.remove("hidden");
    }
    if (["conflict", "error"].includes(session.status)) this.message(session.error?.message || "保存未完成，编辑结果已保留，请下载恢复原件后核对。", true);
    else if (session.status === "closed") this.message("编辑会话已结束，可重新打开当前版本。");
    this.controls();
  }
  async poll() {
    if (!this.session || this.polling || !this.active()) return;
    this.polling = true;
    try {
      const session = await action("office-session", { id: this.session.id });
      if (this.active()) this.receive(session);
    } catch (error) { if (this.active()) this.message(`无法确认保存状态：${error.message}`, true); }
    finally { this.polling = false; }
  }
  async save() {
    if (this.savePromise) return this.savePromise;
    if (!this.state.dirty) return true;
    if (!this.ready || !this.session) return false;
    this.savePromise = this.savePending();
    try { return await this.savePromise; }
    finally { this.savePromise = null; }
  }
  async savePending() {
    const collectedDeadline = Date.now() + 20000;
    while (!this.state.collected && this.active() && Date.now() < collectedDeadline) {
      this.note.textContent = "等待编辑器收集当前修改…";
      await delay(150);
    }
    if (!this.active() || !this.state.beginSave()) return false;
    this.controls();
    try {
      this.receive(await action("office-save", { id: this.session.id }));
      const deadline = Date.now() + 60000;
      while (this.state.saving && this.active() && Date.now() < deadline) {
        await delay(300);
        await this.poll();
      }
      if (!this.active()) return false;
      if (this.state.saving) this.message("保存仍在处理中，会话已保留。请先查询结果，不要关闭或重复提交。", true);
      else if (this.state.dirty && !["conflict", "error"].includes(this.state.session?.status)) this.message("当前仍有未保存输入，或编辑服务尚未返回新原件。请再次保存并等待提交确认。");
      return !this.hasDirty();
    } catch (error) {
      if (error.status && error.status < 500) {
        this.state.saving = false;
        this.state.pending = null;
        this.fail(error);
      } else {
        this.message("保存请求结果尚未确认，正在查询原会话。请先保留编辑器，避免重复提交。", true);
        this.onError(error);
        await this.poll();
      }
      return false;
    } finally { if (this.active()) this.controls(); }
  }
  async prepareLeave() {
    if (!this.hasDirty()) return true;
    const saved = await this.save();
    if (saved) return true;
    this.message("当前Office内容尚未安全保存，编辑器已保留。请保存成功或下载恢复原件后再切换。", true);
    const retained = this.state.session?.recoveryAvailable
      ? "服务端已收到的冲突原件会保留，可先下载恢复原件。它可能不包含之后继续输入的修改。"
      : "请先通过编辑器下载当前内容；未进入cap的修改尚未确认安全保存。";
    const pending = this.state.saving ? "已发出的保存请求仍可能完成，关闭编辑器不会取消该请求。\n" : "";
    if (!window.confirm(`${retained}\n${pending}仍要关闭当前Office编辑会话并切换吗？`)) return false;
    this.state.dirty = false;
    this.state.saving = false;
    this.state.pending = null;
    this.onDirty?.();
    return true;
  }
  refresh(cap) {
    this.state.markRemote(cap);
    this.controls();
    this.poll();
  }
  fail(error) { this.message(error.message, true); this.onError(error); }
  destroy() {
    this.disposed = true;
    clearInterval(this.pollTimer);
    this.editor?.destroyEditor();
  }
}
