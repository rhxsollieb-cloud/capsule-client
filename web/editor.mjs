import { action } from "./api.mjs";
import { node, replace, shortCommit } from "./dom.mjs";
import { renderMarkdown } from "./markdown.mjs";
import { saveErrorPresentation, saveErrorRecord } from "./save-errors.mjs";

export class TextEditor {
  constructor({ onSaved, onError, onDirty, onOpenEntry }) {
    this.drafts = new Map();
    Object.assign(this, { onSaved, onError, onDirty, onOpenEntry });
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
    const state = draft.saving ? "saving" : failure ? failure.state : draft.dirty ? "dirty" : "clean";
    const labels = { saving: "保存中", conflict: "版本冲突", error: "保存失败", dirty: "未保存", clean: "已保存" };
    const statusText = !draft.saving && failure ? failure.label : labels[state];
    return {
      state,
      statusText,
      detail: `${failure?.message || statusText} · 基于 ${shortCommit(draft.baseCommit)} · ${draft.body.split("\n").length} 行`,
      canSave: draft.dirty && !draft.saving,
      save: () => this.current === current ? this.save(current.cap, current.entry, draft, current.saveAction) : undefined,
      mode: current.mode,
      toggleMode: current.markdown ? () => {
        if (this.current === current) current.switchMode(current.mode === "read" ? "edit" : "read");
      } : undefined,
      moreItems: draft.dirty ? [{ label: "放弃草稿并重载", disabled: Boolean(draft.saving), action: () => this.discard(key) }] : [],
    };
  }
  notify(cap, entry, dirty) { this.onDirty?.(cap.name, entry, dirty); }
  open(container, cap, entry, record) {
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
    input.value = draft.body;
    input.spellcheck = false;
    input.wrap = "off";
    input.setAttribute("aria-label", entry || cap.name);
    const update = () => {
      gutter.textContent = Array.from({ length: Math.max(1, input.value.split("\n").length) }, (_, index) => index + 1).join("\n");
      this.notify(cap, entry, draft.dirty);
    };
    this.current.switchMode = (next) => {
      this.current.mode = next;
      shell.classList.toggle("hidden", next === "read");
      reading.classList.toggle("hidden", next !== "read");
      if (next === "read") replace(reading, renderMarkdown(draft.body, {
        name: cap.kind === "markdown" || entry ? cap.name : undefined,
        entry: entry || "README.md",
        onOpenEntry: this.onOpenEntry,
      }));
      this.notify(cap, entry, draft.dirty);
    };
    input.addEventListener("input", () => {
      draft.body = input.value;
      draft.dirty = draft.body !== draft.original;
      this.renderNotice(key);
      update();
    });
    input.addEventListener("scroll", () => { gutter.scrollTop = input.scrollTop; });
    input.addEventListener("keydown", (event) => {
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
    this.current.switchMode(markdown && !draft.dirty ? "read" : "edit");
  }
  discard(key) {
    if (this.current?.key !== key || this.drafts.get(key)?.saving) return;
    const { cap, entry } = this.current;
    this.drafts.delete(key);
    this.notify(cap, entry, false);
    this.onSaved(cap, { reload: true });
  }
  renderNotice(key) {
    if (this.current?.key !== key) return;
    const { banner, remote } = this.current;
    const draft = this.drafts.get(key);
    banner.replaceChildren();
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
    if (draft.saving || !draft.dirty) return;
    const sentBody = draft.body;
    draft.saving = true;
    draft.error = undefined;
    this.notify(cap, entry, draft.dirty);
    try {
      const saved = await action(saveAction, { name: cap.name, ...(saveAction === "save" ? { entry } : {}), body: sentBody, token: draft.baseToken });
      draft.original = sentBody;
      draft.baseToken = saved.token;
      draft.baseCommit = saved.commit;
      draft.dirty = draft.body !== sentBody;
      if (this.current?.key === this.key(cap.name, entry)) this.current.remote = false;
      this.onSaved(saved, { reload: false });
      return saved;
    } catch (error) {
      draft.error = saveErrorRecord(error);
      this.onError(error);
    } finally {
      draft.saving = false;
      this.renderNotice(this.key(cap.name, entry));
      this.notify(cap, entry, draft.dirty);
    }
  }
}
