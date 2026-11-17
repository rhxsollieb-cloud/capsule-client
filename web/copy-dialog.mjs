import { action } from "./api.mjs";
import { directoryKinds, formField, node } from "./dom.mjs";
import { canCreate } from "./permissions.mjs";

function copyName(cap) {
  if (directoryKinds.has(cap.kind) && cap.kind !== "markdown") return `${cap.name} 副本`;
  const dot = cap.name.lastIndexOf(".");
  return dot > 0 ? `${cap.name.slice(0, dot)} 副本${cap.name.slice(dot)}` : `${cap.name} 副本`;
}

export async function copyDialog(dialogs, item) {
  if (!canCreate()) { dialogs.onError(new Error("当前身份没有创建副本权限")); return; }
  const view = dialogs.form("复制为新 cap");
  const name = node("input", "property-input");
  name.required = true; name.autocomplete = "off";
  name.value = copyName(item);
  const parent = node("input", "property-input");
  parent.value = item.path?.slice(0, item.path.lastIndexOf("/")) || "/";
  const note = node("p", "property-note", "副本独立保存，默认向普通员工开放读写，不继承源权限或版本历史。复制源的已保存内容，不包含未保存草稿。单文件请保留原扩展名，虚拟目录留空时仅创建副本。");
  view.fields.append(node("strong", "", item.name), formField("副本名称 · 全库唯一", name), formField("挂载到虚拟目录（可选）", parent), note);
  const submit = node("button", "button primary", "复制");
  submit.type = "submit"; submit.disabled = true;
  view.actions.append(submit);
  let cap;
  let pending = false;
  let submitting = false;
  const preventClose = (event) => { if (submitting) event.preventDefault(); };
  dialogs.element.addEventListener("cancel", preventClose);
  dialogs.element.addEventListener("close", () => dialogs.element.removeEventListener("cancel", preventClose), { once: true });
  const setSubmitting = (value) => {
    submitting = value;
    name.disabled = value; parent.disabled = value;
    for (const control of view.form.querySelectorAll("button[type=button]")) control.disabled = value;
  };
  const created = (saved, path) => {
    dialogs.element.close();
    Promise.resolve().then(() => dialogs.onCreated(saved, path)).catch((error) => dialogs.onError(error));
  };
  dialogs.show();
  try {
    cap = await action("stat", { name: item.name });
    if (dialogs.element.open && view.form.isConnected) submit.disabled = false;
  } catch (error) { if (view.form.isConnected) view.error.textContent = error.message; }
  view.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!cap || pending || submit.disabled) return;
    pending = true; submit.disabled = true; view.error.textContent = "";
    setSubmitting(true);
    let saved;
    try {
      if (parent.value.trim() && !parent.value.trim().startsWith("/")) throw Object.assign(new Error("虚拟目录需要以 / 开头，或留空不挂载"), { status: 400 });
      saved = await action("copy", { name: cap.name, to: name.value.trim(), token: cap.token });
      const parentPath = parent.value.trim().replace(/\/+$/, "");
      const path = parent.value.trim() ? `${parentPath}/${saved.name}` : null;
      if (path) await action("mount", { name: saved.name, path });
      created(saved, path);
    } catch (error) {
      if (saved) {
        created(saved, null);
        dialogs.onError(new Error(`副本 ${saved.name} 已创建，挂载未确认：${error.message}。请在“全部 cap”查看，勿再次复制。`));
      } else {
        const unknown = !error.status || error.uncertain || error.eventId || error.code === "PUBLISH_PENDING";
        view.error.textContent = `${error.message}${error.eventId ? ` · 事件 ${error.eventId}` : ""}`;
        if (unknown) note.textContent = "复制结果尚未确认。请关闭窗口后在全部 cap 或事件记录核对目标，勿重复提交。";
        else { pending = false; submit.disabled = false; }
      }
    } finally {
      setSubmitting(false);
    }
  });
}
