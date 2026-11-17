import { action, sessionUrl } from "./api.mjs";
import { node, replace, shortCommit } from "./dom.mjs";
import { loadOfficeApi } from "./office-loader.mjs";
import { OfficeState } from "./office-state.mjs";
import { canEdit } from "./permissions.mjs";
import { editLease, leaseMessage } from "./edit-lease.mjs";
import { startPolling } from "./polling.mjs";

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class OfficeView {
  constructor(container, cap, entry, { isCurrent, onError, onSaved, onDirty, onReload, createLease = editLease }) {
    Object.assign(this, { container, cap, entry, isCurrent, onError, onSaved, onDirty, onReload });
    this.state = new OfficeState(cap);
    this.lease = createLease(() => { if (this.active()) this.controls(); });
    this.wrapper = node("div", "onlyoffice-view");
    this.notice = node("div", "onlyoffice-notice hidden");
    this.recovery = node("a", "button secondary hidden", "下载冲突恢复原件");
    this.stage = node("div", "onlyoffice-stage");
    this.mount = node("div", "onlyoffice-mount");
    this.mount.id = `office-${crypto.randomUUID()}`;
    this.stage.append(this.mount);
    this.wrapper.append(this.notice, this.recovery, this.stage);
    replace(container, this.wrapper);
    this.open();
  }
  hasDirty() { return this.readOnly ? false : this.state.hasDirty(); }
  active() { return !this.disposed && this.isCurrent(); }
  controlsInfo() {
    const sessionStatus = this.state.session?.status;
    const failed = ["conflict", "error", "closed"].includes(sessionStatus);
    let state = "clean";
    let statusText = "已保存";
    if (sessionStatus === "conflict" || this.state.remote) { state = "conflict"; statusText = "版本冲突"; }
    else if (this.localError || ["error", "closed"].includes(sessionStatus)) { state = "error"; statusText = sessionStatus === "closed" ? "会话已结束" : "保存失败"; }
    else if (this.state.saving || this.collecting) { state = "saving"; statusText = this.collecting ? "等待输入收集" : "保存中"; }
    else if (!this.ready) { state = "loading"; statusText = "正在打开"; }
    else if (this.state.dirty) { state = "dirty"; statusText = "未保存"; }
    const moreItems = [{
      label: "重新打开当前版本", disabled: this.state.saving || this.collecting,
      action: () => { if (this.active()) this.onReload?.(); },
    }];
    if (canEdit(this.cap) && this.ready) moreItems.unshift({
      label: this.lease.proof ? "结束编辑并释放占用" : this.readOnly ? "占用并编辑Office" : "占用并继续编辑", disabled: this.state.saving || this.collecting || this.entering,
      action: () => this.lease.proof ? this.lease.release() : this.readOnly ? this.enterEditing() : this.resumeEditing(),
    });
    if (!this.readOnly && ["busy", "lost", "acquiring"].includes(this.lease.state.status)) { state = "error"; statusText = leaseMessage(this.lease.state); }
    if (this.state.session?.recoveryAvailable) moreItems.push({
      label: "下载恢复原件", icon: "download",
      action: () => { if (this.active()) this.recovery.click(); },
    });
    return {
      state, statusText,
      detail: `${this.readOnly ? "只读" : statusText} · ${shortCommit(this.state.cap.commit)}${this.localError ? ` · ${this.localError.message}` : ""}`,
      helpText: this.readOnly ? "当前Office以只读方式打开，浏览不占用。具备编辑权限时，可在文件菜单选择占用并编辑Office。" : "编辑器先将变化收集到文档服务。使用保存命令确认知识库版本提交；未完成的修改在切换前会继续保留。",
      canSave: Boolean(!this.readOnly && canEdit(this.cap) && this.lease.proof && this.ready && !this.state.saving && !this.collecting && this.state.dirty && !failed),
      save: !this.readOnly && canEdit(this.cap) ? () => this.active() ? this.save() : false : undefined,
      moreItems,
    };
  }
  controls() {
    if (this.stage) this.stage.inert = !this.readOnly && (!this.lease.proof || this.state.saving || this.collecting);
    if (!this.readOnly && ["busy", "lost"].includes(this.lease.state.status)) this.message(leaseMessage(this.lease.state), true);
    if (this.state.remote && !["conflict", "error"].includes(this.state.session?.status)) this.message("cap已有外部新版本。当前编辑会话已保留，保存将核对原版本。");
    this.onDirty?.();
  }
  message(text, error = false) {
    this.notice.textContent = text;
    this.notice.className = `onlyoffice-notice${error ? " error-message" : ""}${text ? "" : " hidden"}`;
  }
  async open() {
    const generation = this.openGeneration = (this.openGeneration || 0) + 1;
    const current = () => this.active() && this.openGeneration === generation;
    this.controls();
    try {
      const status = await action("office-status");
      if (!current()) return;
      this.available = status.configured && status.available;
      if (!status.configured || !status.available) throw new Error(status.error?.message || status.error || "ONLYOFFICE文档服务尚未就绪，请检查配置并重试");
      if (this.editingRequested && canEdit(this.cap) && !await this.lease.acquire(this.cap.name, "office")) throw new Error(leaseMessage(this.lease.state));
      if (!current()) return;
      const session = await action("office-open", { name: this.cap.name, entry: this.entry, token: this.cap.token, mode: this.editingRequested ? "edit" : "view" }, { lease: this.lease.proof });
      if (!current()) return;
      this.session = session;
      this.readOnly = session.config?.editorConfig?.mode === "view" || session.config?.document?.permissions?.edit === false;
      this.state.receive(session);
      if (this.readOnly) this.state.dirty = false;
      if (this.readOnly) this.lease.release();
      const api = await loadOfficeApi(session.editorUrl);
      if (!current()) return;
      this.editor = new api.DocEditor(this.mount.id, {
        ...session.config,
        events: {
          onDocumentReady: () => { if (current()) { this.ready = true; this.localError = null; this.message(""); this.controls(); } },
          onDocumentStateChange: ({ data }) => { if (current() && !this.readOnly) { this.state.changed(data === true); this.controls(); } },
          onError: ({ data }) => { if (current()) this.fail(new Error(data?.errorDescription || `文档编辑器错误 ${data?.errorCode || ""}`)); },
          onRequestRefreshFile: () => { if (current()) this.message("此编辑会话已结束，请保存或下载当前内容后重新打开。"); },
        },
      });
      this.poller?.stop();
      this.poller = startPolling(() => this.poll(), {
        interval: () => this.state.saving ? 1000 : this.readOnly ? 30000 : 10000,
        enabled: () => this.active() && Boolean(this.session) && !this.savePromise,
        whenHidden: () => this.state.saving,
      });
    } catch (error) {
      if (!current()) return;
      this.lease.release();
      this.localError = error;
      this.message(error.message, true);
      this.stage.append(node("p", "onlyoffice-unavailable", this.available
        ? "请核对原件格式和版本后重新打开。原件仍可下载查看。"
        : "请启动ONLYOFFICE Docs后点击“重新打开当前版本”。原件仍可下载查看。"));
      this.onError(error);
      this.controls();
    }
  }
  receive(session) {
    const saving = this.state.saving;
    const previousVersion = this.state.saveVersion;
    this.state.receive(session);
    if (session.saveVersion > previousVersion && !["conflict", "error"].includes(session.status)) {
      this.localError = null;
      this.message("");
    }
    if (session.result && session.saveVersion > previousVersion) this.onSaved?.(session.result);
    if (session.recoveryAvailable) {
      this.recovery.href = sessionUrl("/ui/office/recovery", { id: session.id });
    }
    this.recovery.classList.toggle("hidden", !session.recoveryAvailable || !["conflict", "error", "closed"].includes(session.status));
    if (["conflict", "error"].includes(session.status)) this.message(session.error?.message || "保存未完成，编辑结果已保留，请下载恢复原件后核对。", true);
    else if (session.status === "closed") this.message("编辑会话已结束，可重新打开当前版本。");
    this.controls();
    if (saving && !this.state.saving) this.lease.release();
  }
  async resumeEditing() {
    if (!this.active() || this.readOnly || !canEdit(this.cap) || this.state.saving) return false;
    const proof = await this.lease.acquire(this.cap.name, "office");
    if (proof && this.active()) { this.message(""); this.controls(); }
    return Boolean(proof);
  }
  async enterEditing() {
    if (!this.active() || !this.readOnly || !canEdit(this.cap) || this.entering) return false;
    this.entering = true;
    try {
      if (!await this.lease.acquire(this.cap.name, "office") || !this.active()) return false;
      // A view-only frame has no editable draft. Existing edit frames are resumed without replacement.
      this.editor?.destroyEditor();
      this.poller?.stop();
      this.ready = false; this.editingRequested = true; this.session = null;
      this.state = new OfficeState(this.cap);
      this.mount = node("div", "onlyoffice-mount");
      this.mount.id = `office-${crypto.randomUUID()}`;
      replace(this.stage, this.mount);
      await this.open();
      return !this.readOnly;
    } finally { this.entering = false; if (this.active()) this.controls(); }
  }
  async poll() {
    if (!this.session || this.polling || !this.active()) return;
    const previous = this.session;
    const generation = this.openGeneration;
    this.polling = true;
    try {
      const session = await action("office-session", { id: previous.id });
      if (this.active() && this.session === previous && this.openGeneration === generation) this.receive(session);
    } catch (error) { if (this.active() && this.session === previous && this.openGeneration === generation) this.message(`无法确认保存状态：${error.message}`, true); }
    finally { this.polling = false; }
  }
  async save() {
    if (this.readOnly || !canEdit(this.cap)) return false;
    if (!this.lease?.proof) { this.message("编辑占用已释放或失效，内容仍保留在当前编辑器。请先占用并继续编辑，再保存。", true); return false; }
    if (this.savePromise) return this.savePromise;
    if (!this.state.dirty) return true;
    if (!this.ready || !this.session) return false;
    this.savePromise = this.savePending();
    try { return await this.savePromise; }
    finally { this.savePromise = null; this.poller?.wake(); }
  }
  async savePending() {
    const collectedDeadline = Date.now() + 20000;
    while (!this.state.collected && this.active() && Date.now() < collectedDeadline) {
      this.collecting = true;
      this.controls();
      await delay(150);
    }
    this.collecting = false;
    if (!this.active() || !this.state.beginSave()) { this.controls(); return false; }
    this.controls();
    try {
      this.receive(await action("office-save", { id: this.session.id }, { lease: this.lease.requireProof() }));
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
    } finally { if (!this.state.saving) this.lease.release(); if (this.active()) this.controls(); }
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
    this.cap = cap;
    if (!canEdit(cap)) this.lease.release();
    this.state.markRemote(cap);
    this.controls();
  }
  fail(error) { this.localError = error; this.message(error.message, true); this.onError(error); this.controls(); }
  destroy() {
    this.disposed = true;
    this.lease.release();
    this.poller?.stop();
    this.editor?.destroyEditor();
  }
}
