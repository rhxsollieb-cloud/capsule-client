import { action } from "./api.mjs";
import { node, replace, shortCommit } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { saveErrorPresentation, saveErrorRecord } from "./save-errors.mjs";
import { canEdit } from "./permissions.mjs";
import { editLease, leaseMessage } from "./edit-lease.mjs";

export class TextEditor {
  constructor({ onSaved, onError, onDirty, onOpenEntry, createLease = editLease }) {
    this.drafts = new Map();
    Object.assign(this, { onSaved, onError, onDirty, onOpenEntry });
    this.lease = createLease(() => {
      const current = this.current;
      if (!current) return;
      const draft = this.drafts.get(current.key);
      if (current.input) current.input.readOnly = !canEdit(current.cap) || !this.lease.proof || Boolean(draft?.saving);
      this.renderNotice(current.key);
      this.notify(current.cap, current.entry, draft?.dirty);
    });
  }
  key(name, entry) { return `${name}\0${entry ?? ""}`; }
  hasDirty(name, entry) { return Boolean(this.drafts.get(this.key(name, entry))?.dirty); }
  controls(name, entry) {
    const key = this.key(name, entry);
    if (this.current?.key !== key) return null;
    const draft = this.drafts.get(key);
    if (!draft) return null;
    const current = this.current;
    const failure = draft.error || this.current.remote ? saveErrorPresentation(draft.error, { remote: this.current.remote }) : null;
    const blocked = ["busy", "lost", "acquiring"].includes(this.lease.state.status);
    const state = draft.saving ? "saving" : blocked ? "error" : failure ? failure.state : draft.dirty ? "dirty" : "clean";
    const labels = { saving: "保存中", conflict: "版本冲突", error: "保存失败", dirty: "未保存", clean: "已保存" };
    const statusText = !draft.saving && blocked ? leaseMessage(this.lease.state) : !draft.saving && failure ? failure.label : labels[state];
    return {
      state,
      statusText,
      detail: `${failure?.message || statusText} · 基于 ${shortCommit(draft.baseCommit)} · ${draft.body.split("\n").length} 行`,
      canSave: canEdit(current.cap) && Boolean(this.lease.proof) && draft.dirty && !draft.saving,
      save: canEdit(current.cap) ? () => this.current === current ? this.save(current.cap, current.entry, draft, current.saveAction) : undefined : undefined,
      mode: current.mode,
      modeTitle: current.mode === "read" || !this.lease.proof ? "占用并编辑" : "结束编辑并阅读",
      toggleMode: canEdit(current.cap) && !draft.saving ? () => {
        if (this.current === current) return current.switchMode(current.mode === "read" || !this.lease.proof ? "edit" : "read");
      } : undefined,
      moreItems: draft.dirty ? [{ label: "放弃草稿并重载", disabled: Boolean(draft.saving), action: () => this.discard(key) }] : [],
    };
  }
  notify(cap, entry, dirty) { this.onDirty?.(cap.name, entry, dirty); }
  open(container, cap, entry, record) {
    this.close();
    const key = this.key(cap.name, entry);
    let draft = this.drafts.get(key);
    if (!draft || (!draft.dirty && !draft.saving)) {
      draft = { body: record.body, original: record.body, baseToken: record.token, baseCommit: record.commit, dirty: false };
      this.drafts.set(key, draft);
    }
    const page = node("div", "editor-page");
    const markdown = cap.kind === "markdown" && !entry || /\.md$/i.test(entry || cap.name);
    const reading = node("div", "reading-surface");
    const banner = node("div", "editor-notice");
    this.current = { key, banner, cap, entry, markdown, saveAction: record.saveAction || "save", remote: draft.baseToken !== record.token };
    const shell = node("div", "editor-shell");
    const gutter = node("pre", "line-gutter");
    gutter.setAttribute("aria-hidden", "true");
    const input = node("textarea", "text-editor");
    input.readOnly = true;
    this.current.input = input;
    input.value = draft.body;
    input.spellcheck = false;
    input.wrap = "off";
    input.setAttribute("aria-label", entry || cap.name);
    const update = () => {
      gutter.textContent = Array.from({ length: Math.max(1, input.value.split("\n").length) }, (_, index) => index + 1).join("\n");
      this.notify(cap, entry, draft.dirty);
    };
    const current = this.current;
    this.current.switchMode = async (next) => {
      if (next === "edit") {
        if (!canEdit(current.cap) || draft.saving) return;
        if (!await this.lease.acquire(cap.name, record.saveAction === "save-details" ? "details" : "content") || this.current !== current) return;
      } else this.lease.release();
      if (this.current !== current) return;
      current.mode = next;
      input.readOnly = next !== "edit" || !this.lease.proof || !canEdit(current.cap);
      shell.classList.toggle("hidden", next === "read");
      reading.classList.toggle("hidden", next !== "read");
      if (next === "read") replace(reading, markdown ? renderMarkdown(draft.body, {
        name: cap.kind === "markdown" || entry ? cap.name : undefined,
        entry: entry || "README.md",
        onOpenEntry: this.onOpenEntry,
      }) : node("pre", "text-reading", draft.body));
      this.notify(cap, entry, draft.dirty);
    };
    input.addEventListener("input", () => {
      if (!canEdit(this.current.cap) || !this.lease.proof || draft.saving) { input.value = draft.body; return; }
      draft.body = input.value;
      draft.dirty = draft.body !== draft.original;
      this.renderNotice(key);
      update();
    });
    input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
    input.addEventListener("keydown", (event) => {
      if (!canEdit(this.current.cap) || !this.lease.proof || draft.saving) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (draft.dirty && !draft.saving) this.save(cap, entry, draft, record.saveAction);
      }
      if (event.key === "Tab") {
        event.preventDefault();
        input.setRangeText("  ", input.selectionStart, input.selectionEnd, "end");
        input.dispatchEvent(new Event("input"));
      }
    });
    shell.append(gutter, input);
    page.append(banner, reading, shell);
    replace(container, page);
    this.renderNotice(key);
    update();
    this.current.switchMode("read");
  }
  updatePermissions(cap) {
    if (this.current?.cap?.name !== cap.name) return;
    this.current.cap = cap;
    if (this.current.input) this.current.input.readOnly = !canEdit(cap) || !this.lease.proof || Boolean(this.drafts.get(this.current.key)?.saving);
    if (!canEdit(cap)) this.lease.release();
  }
  discard(key) {
    if (this.current?.key !== key || this.drafts.get(key)?.saving) return;
    const { cap, entry } = this.current;
    this.drafts.delete(key);
    this.lease.release();
    this.notify(cap, entry, false);
    this.onSaved(cap, { reload: true });
  }
  renderNotice(key) {
    if (this.current?.key !== key) return;
    const { banner, remote } = this.current;
    const draft = this.drafts.get(key);
    banner.replaceChildren();
    if (["busy", "lost"].includes(this.lease.state.status)) banner.append(node("span", "error-message", leaseMessage(this.lease.state)));
    if (!draft?.dirty) return;
    if (remote || draft.error) banner.append(node("span", `error-message${remote ? " remote-notice" : ""}`, saveErrorPresentation(draft.error, { remote }).message));
  }
  markRemote(name, entry) {
    const key = this.key(name, entry);
    const draft = this.drafts.get(key);
    if (!draft?.dirty || this.current?.key !== key) return;
    this.current.remote = true;
    this.renderNotice(key);
    this.notify(this.current.cap, entry, draft.dirty);
  }
  async save(cap, entry, draft, saveAction = "save") {
    if (!canEdit(this.current?.cap?.name === cap.name ? this.current.cap : cap)) return;
    if (draft.saving || !draft.dirty) return;
    if (!this.lease.proof) { draft.error = saveErrorRecord(Object.assign(new Error(leaseMessage(this.lease.state)), { code: "EDIT_LEASE_LOST" })); this.renderNotice(this.key(cap.name, entry)); return; }
    const sentBody = draft.body;
    const context = this.current;
    const reservation = this.lease.capture();
    draft.saving = true;
    draft.error = undefined;
    this.notify(cap, entry, draft.dirty);
    try {
      const saved = await action(saveAction, { name: cap.name, ...(saveAction === "save" ? { entry } : {}), body: sentBody, token: draft.baseToken }, { lease: this.lease.requireProof() });
      draft.original = sentBody;
      draft.baseToken = saved.token;
      draft.baseCommit = saved.commit;
      draft.dirty = draft.body !== sentBody;
      if (this.current === context) this.current.remote = false;
      this.onSaved(saved, { reload: false });
      return saved;
    } catch (error) {
      draft.error = saveErrorRecord(error);
      this.onError(error);
    } finally {
      draft.saving = false;
      this.lease.release(reservation);
      if (this.current === context) this.current.switchMode("read");
      this.renderNotice(this.key(cap.name, entry));
      this.notify(cap, entry, draft.dirty);
    }
  }
  close() { this.current = null; this.lease.release(); }
}
