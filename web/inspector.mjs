import { action } from "./api.mjs";
import { button, formField, kindLabels, node, replace, shortCommit } from "./dom.mjs";
import { InspectorDetails, mediaBrowser } from "./inspector-details.mjs";
import { ActivityIndicator, ActivitySession } from "./activity.mjs";
import { saveErrorPresentation, saveErrorRecord } from "./save-errors.mjs";

export class Inspector {
  constructor({ onSaved, onError, onEdit, getDraft = () => null, createActivity = (options) => new ActivitySession(options) }) {
    Object.assign(this, { onSaved, onError, onEdit, getDraft });
    this.drafts = new Map();
    this.request = 0;
    this.element = node("dialog", "cap-properties");
    this.element.setAttribute("aria-label", "cap 属性");
    this.activityIndicator = new ActivityIndicator();
    this.activity = createActivity({ onChange: (state) => this.activityIndicator.update(state) });
    this.element.addEventListener("close", () => {
      if (this.element.open) return;
      this.activity.clear();
      this.request++;
      replace(this.element);
      this.view = null;
    });
    document.body.append(this.element);
  }
  // Workspace updates the selected entity without opening or switching the popup.
  show(cap) {
    this.selected = cap;
    if (this.current?.name === cap.name && this.view) this.update(cap);
  }
  async open(item) {
    if (!item?.name) return;
    if (this.element.open) this.hide();
    const request = ++this.request;
    this.current = null;
    const header = node("div", "dialog-header");
    const close = button("", () => this.hide(), "icon-button");
    close.textContent = "×";
    close.setAttribute("aria-label", "关闭属性");
    header.append(node("h2", "", "cap 属性"), this.activityIndicator.element, close);
    const fields = node("div", "property-fields");
    const name = node("input", "property-input");
    name.readOnly = true;
    name.value = item.name;
    this.description = node("textarea", "property-input property-summary");
    this.description.rows = 2;
    this.description.maxLength = 180;
    this.description.disabled = true;
    fields.append(formField("名称", name), formField("简述", this.description));
    const loading = node("p", "property-note", "正在读取详述…");
    const dynamic = node("div", "property-dynamic");
    fields.append(loading, dynamic);
    this.note = node("p", "property-note property-save-note");
    this.note.setAttribute("role", "status");
    this.saveButton = button("保存说明", () => this.save(), "button primary");
    this.saveButton.disabled = true;
    const actions = node("div", "dialog-actions");
    actions.append(this.note, this.saveButton);
    this.view = { fields, dynamic, request };
    replace(this.element, header, fields, actions);
    this.element.showModal();
    this.activity.setTarget({ name: item.name });
    try {
      const record = await action("details", { name: item.name, from: 1, limit: 80 });
      if (!this.visible(request)) return;
      loading.remove();
      this.apply(record);
    } catch (error) {
      if (!this.visible(request)) return;
      loading.textContent = error.message;
      loading.classList.add("error-message");
      this.onError(error);
    }
  }
  visible(request) { return this.element.open && this.view?.request === request && this.request === request; }
  apply(record) {
    this.current = record;
    let draft = this.drafts.get(record.name);
    if (!draft || (!draft.dirty && !draft.saving)) {
      const bodyReady = record.source.type === "metadata" && !record.lines.nextLine;
      draft = { value: record.description || "", original: record.description || "", baseToken: record.token, dirty: false,
        bodyReady, body: bodyReady ? record.body : undefined, originalBody: bodyReady ? record.body : undefined };
      this.drafts.set(record.name, draft);
    }
    this.draft = draft;
    this.description.disabled = false;
    this.description.value = draft.value;
    this.description.oninput = () => { draft.value = this.description.value; this.changed(); };
    const request = this.view.request;
    const details = new InspectorDetails({
      isCurrent: () => this.visible(request) && this.details === details,
      getDraft: this.getDraft,
      onEdit: (source) => { this.hide(); Promise.resolve(this.onEdit?.(source)).catch(this.onError); },
      onChange: () => this.changed(),
      onError: (error) => { this.note.textContent = error.message; this.onError(error); },
    });
    this.details = details;
    details.show(record, draft);
    replace(this.view.dynamic, details.element);
    const browse = mediaBrowser(record);
    if (browse) this.view.dynamic.append(browse);
    const version = node("details", "property-version");
    version.append(node("summary", "", "类别与版本"));
    this.commit = node("p", "mono property-note", `${kindLabels[record.kind] || record.kind} · ${shortCommit(record.commit)}`);
    this.commit.title = record.commit;
    version.append(this.commit);
    this.view.dynamic.append(version);
    this.changed();
    this.update(record);
  }
  changed() {
    const draft = this.draft;
    if (!draft) return;
    draft.dirty = draft.value !== draft.original || draft.bodyReady && draft.body !== draft.originalBody;
    this.saveButton.disabled = !draft.dirty || draft.saving;
    if (draft.dirty && !draft.saving && draft.error)
      this.note.textContent = saveErrorPresentation(draft.error, { remote: typeof this.current?.token === "string" && this.current.token !== draft.baseToken }).message;
    if (this.element.open && this.current) this.activity?.setTarget({ name: this.current.name, scope: "details", dirty: Boolean(draft.dirty) });
  }
  context(value) { this.selectionContext = value; }
  update(cap) {
    if (this.current?.name !== cap.name || !this.draft) return;
    this.current = { ...this.current, ...cap };
    if (this.commit) { this.commit.textContent = `${kindLabels[cap.kind] || cap.kind} · ${shortCommit(cap.commit)}`; this.commit.title = cap.commit; }
    if (this.draft.baseToken !== cap.token) this.note.textContent = this.draft.error
      ? saveErrorPresentation(this.draft.error, { remote: true }).message
      : "服务端已有新版本，说明草稿保留原基线；请关闭后重新核对。";
  }
  async refresh() {
    if (!this.element.open || !this.current || this.refreshing) return;
    this.details?.syncLocal();
    const request = this.request;
    const cap = this.current;
    this.refreshing = true;
    try {
      const record = await action("details", { name: cap.name, from: 1, limit: 80 });
      if (!this.visible(request)) return;
      if (record.token !== this.draft.baseToken) {
        if (this.draft.dirty || this.draft.saving) this.update(record);
        else this.apply(record);
      }
    } catch (error) { if (this.visible(request)) this.note.textContent = error.message; }
    finally { this.refreshing = false; }
  }
  async save() {
    const cap = this.current;
    const draft = this.draft;
    if (!cap || !draft?.dirty || draft.saving) return;
    const value = draft.value;
    const body = draft.body;
    const withBody = cap.source?.type === "metadata" && draft.bodyReady;
    const fields = { name: cap.name, description: value, token: draft.baseToken, ...(withBody ? { body } : {}) };
    // The transport budget applies to the encoded JSON request, including escapes.
    if (new TextEncoder().encode(JSON.stringify({ action: withBody ? "save-details" : "update", ...fields })).length > 1024 * 1024) {
      this.note.textContent = "说明请求超过1MiB，请缩短详述后保存。";
      return;
    }
    draft.saving = true;
    draft.error = undefined;
    this.saveButton.disabled = true;
    try {
      const saved = await action(withBody ? "save-details" : "update", fields);
      draft.original = value;
      if (withBody) draft.originalBody = body;
      draft.baseToken = saved.token;
      draft.dirty = draft.value !== value || draft.bodyReady && draft.body !== draft.originalBody;
      if (this.current?.name === cap.name && this.draft === draft && this.view) {
        this.current = { ...cap, ...saved };
        this.details.record.token = saved.token;
        this.details.syncLocal();
        this.note.textContent = draft.dirty ? "已保存，另有未提交修改" : "说明已保存";
        this.update(this.current);
      }
      this.onSaved(saved);
    } catch (error) {
      draft.error = saveErrorRecord(error);
      if (this.current?.name === cap.name && this.draft === draft && this.view)
        this.note.textContent = saveErrorPresentation(draft.error, { remote: typeof this.current.token === "string" && this.current.token !== draft.baseToken }).message;
      this.onError(error);
    } finally {
      draft.saving = false;
      if (this.current?.name === cap.name && this.view) { this.saveButton.disabled = !draft.dirty; this.changed(); }
    }
  }
  hide() {
    this.request++;
    this.activity?.clear();
    if (this.element.open) this.element.close();
    replace(this.element);
    this.view = null;
  }
  toggle() { if (this.element.open) this.hide(); else if (this.selected) this.open(this.selected); }
}
