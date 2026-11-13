import { action } from "./api.mjs";
import { formField, node } from "./dom.mjs";

export class LibraryManagement {
  constructor({ dialogs, draftState, onUnlinked, onPending }) {
    Object.assign(this, { dialogs, draftState, onUnlinked, onPending });
  }
  async open(operation, item) {
    if (operation === "unlink" && !item.path) return;
    const removing = operation === "delete";
    const view = this.dialogs.form(removing ? "清除整个 cap" : "断开当前挂载");
    view.fields.append(node("strong", "", item.name));
    const loading = node("p", "dialog-message", "正在核对影响范围…");
    view.fields.append(loading);
    this.dialogs.show();
    try {
      const preview = await action(removing ? "removal" : "position", removing ? { name: item.name } : { path: item.path });
      if (!view.form.isConnected || !this.dialogs.element.open) return;
      loading.remove();
      const blocked = removing ? this.removalFields(view, preview, item) : this.unlinkFields(view, preview, item);
      if (blocked) return;
      const confirmation = node("input", "property-input");
      confirmation.autocomplete = "off";
      confirmation.required = true;
      confirmation.setAttribute("aria-label", "输入完整 cap 名称确认");
      if (removing) view.fields.append(formField("输入完整 cap 名称确认清除", confirmation));
      const submit = node("button", "button danger", removing ? "清除 cap" : "断开挂载");
      let submitted = false;
      submit.type = "submit";
      submit.disabled = removing;
      confirmation.addEventListener("input", () => { submit.disabled = submitted || confirmation.value !== item.name; });
      view.actions.append(submit);
      view.form.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (submitted || submit.disabled || removing && confirmation.value !== item.name) return;
        if (removing && this.draftState(item.name).saving) {
          view.error.textContent = "此 cap 仍有保存请求进行中，请等待确认后重新核对。";
          return;
        }
        submitted = true;
        submit.disabled = true;
        confirmation.disabled = true;
        view.error.textContent = "";
        try {
          const result = await action(removing ? "delete" : "unmount", removing
            ? { name: item.name, token: preview.token, mountsToken: preview.mountsToken }
            : { path: item.path, token: preview.token });
          if (view.form.isConnected) this.dialogs.element.close();
          if (removing) this.onPending(result);
          else await this.onUnlinked(item);
        } catch (error) {
          if (view.form.isConnected) view.error.textContent = `${error.message}${error.eventId ? ` · 事件 ${error.eventId}` : ""}。请重新核对实际状态后再操作。`;
          if (removing && error.eventId) this.onPending({ id: error.eventId, name: item.name, type: "delete", status: "pending" });
        }
      });
    } catch (error) {
      if (view.form.isConnected) { loading.remove(); view.error.textContent = error.message; }
    }
  }
  removalFields(view, preview, item) {
    if (preview.name !== item.name) throw new Error("清除预览与所选 cap 不一致");
    view.fields.append(node("p", "dialog-message", "将删除此 cap 的全部内容、独立 Git 历史及以下所有挂载。清除无法通过版本回撤恢复。"));
    const paths = node("ul", "management-paths");
    for (const mount of preview.mounts) paths.append(node("li", "mono", mount.path));
    view.fields.append(paths.children.length ? paths : node("p", "dialog-message", "此 cap 当前没有虚拟路径挂载。"));
    const draft = this.draftState(item.name);
    if (draft.dirty) view.fields.append(node("p", "error-message dialog-message", "此 cap 有未保存的本地草稿，清除成功后这些草稿也将移除。"));
    const reasons = [...(preview.blockedReasons || [])];
    if (preview.blockedBy?.length) reasons.push(`以下子挂载属于其他 cap，请先移动或断开：${preview.blockedBy.map((mount) => mount.path).join("、")}`);
    if (draft.saving) reasons.push("此 cap 的保存仍在进行中，请等待确认后重新核对。");
    for (const reason of reasons) view.fields.append(node("p", "error-message dialog-message", reason));
    return reasons.length > 0;
  }
  unlinkFields(view, preview, item) {
    if (!preview.items.some((mount) => mount.name === item.name && mount.path === item.path)) throw new Error("当前位置已变化，请重新选择后操作");
    view.fields.append(node("p", "mono dialog-message", item.path), node("p", "dialog-message", "仅移除此虚拟路径挂载，cap 内容、版本和本地草稿保留。可在“全部 cap”中继续访问。"));
    if (preview.items.length > 1) {
      view.fields.append(node("p", "error-message dialog-message", "此位置仍有子挂载，请先移动或逐个断开子挂载。"));
      return true;
    }
    return false;
  }
}
