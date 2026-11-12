import { action } from "./api.mjs";
import { button, formField, node, shortCommit } from "./dom.mjs";
import { icon } from "./icons.mjs";

function excelFields(result, fields) {
  const sheet = node("select");
  for (const item of result.sheets) {
    const option = node("option", "", item.name);
    option.value = item.name;
    sheet.append(option);
  }
  const cell = node("input");
  cell.required = true;
  cell.placeholder = "例如 B6";
  cell.pattern = "[A-Za-z]{1,3}[1-9][0-9]{0,6}";
  const type = node("select");
  for (const [value, label] of [["text", "文本"], ["number", "数字"], ["boolean", "布尔值"], ["null", "清空"]]) {
    const option = node("option", "", label);
    option.value = value;
    type.append(option);
  }
  const value = node("textarea");
  value.rows = 3;
  value.placeholder = "输入单元格的新值";
  type.addEventListener("change", () => { value.disabled = type.value === "null"; });
  fields.append(formField("工作表", sheet), formField("单元格地址", cell), formField("值的类型", type), formField("新值", value), node("p", "property-note", "按单元格地址修改原工作簿。现有公式保留，本次输入作为值保存。"));
  return () => {
    let parsed = value.value;
    if (type.value === "number") {
      if (!value.value.trim() || !Number.isFinite(Number(value.value))) throw new Error("请输入有限数字");
      parsed = Number(value.value);
    } else if (type.value === "boolean") {
      if (!["true", "false"].includes(value.value.trim().toLowerCase())) throw new Error("布尔值请输入 true 或 false");
      parsed = value.value.trim().toLowerCase() === "true";
    } else if (type.value === "null") parsed = null;
    return { cells: [{ sheet: sheet.value, cell: cell.value.trim().toUpperCase(), value: parsed }] };
  };
}

function templateFields(result, fields) {
  const text = result.blocks.map((block) => block.text || block.rows?.flat().join("\n") || "").join("\n");
  const names = [...new Set([...text.matchAll(/\{\{([^{}\n]+)\}\}/g)].map((match) => match[1]))];
  const inputs = [];
  const add = (name = "") => {
    const row = node("div", "template-field-row");
    const key = node("input");
    key.value = name;
    key.placeholder = "字段名，不含 {{ }}";
    key.required = true;
    const value = node("textarea");
    value.rows = 2;
    value.placeholder = "填充内容";
    row.append(formField("模板字段", key), formField("内容", value));
    inputs.push({ key, value });
    fields.append(row);
  };
  fields.append(node("p", "dialog-message", "填写原件中的 {{字段名}} 占位符，保留文档现有结构与样式。"));
  for (const name of names.length ? names : [""]) add(name);
  fields.append(button("增加字段", () => add(), "button ghost"));
  return () => {
    const replacements = Object.create(null);
    for (const { key, value } of inputs) {
      const name = key.value.trim();
      if (!name || /[{}\n]/.test(name)) throw new Error("模板字段名不能留空或包含花括号");
      if (Object.hasOwn(replacements, name)) throw new Error("模板字段名重复");
      replacements[name] = value.value;
    }
    return { replacements };
  };
}

export function editOffice(cap, entry, preview, onSaved, onError) {
  const dialog = node("dialog", "office-edit-dialog");
  const form = node("form", "dialog-form");
  const header = node("div", "dialog-header");
  const close = button("", () => dialog.close(), "icon-button");
  close.append(icon("close"));
  close.setAttribute("aria-label", "关闭编辑");
  header.append(node("h2", "", preview.kind === "excel" ? "修改单元格" : "填充 Word 模板"), close);
  const fields = node("div", "dialog-fields");
  fields.append(node("strong", "", entry || cap.name), node("span", "property-note", `基于 ${shortCommit(preview.commit)}，保存生成新版本`));
  const changes = preview.kind === "excel" ? excelFields(preview, fields) : templateFields(preview, fields);
  const error = node("p", "error-message");
  const actions = node("div", "dialog-actions");
  const submit = node("button", "button primary", "保存修改");
  submit.type = "submit";
  actions.append(button("取消", () => dialog.close()), submit);
  fields.append(error);
  form.append(header, fields, actions);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove(), { once: true });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    error.textContent = "";
    submit.disabled = true;
    try {
      const saved = await action("office-write", { name: cap.name, entry, changes: changes(), token: cap.token });
      dialog.close();
      onSaved?.(saved);
    } catch (failure) {
      error.textContent = failure.status === 409 ? "原件已有新版本，输入已保留。请核对版本后再修改。" : failure.message;
      onError(failure);
    } finally { submit.disabled = false; }
  });
  document.body.append(dialog);
  dialog.showModal();
}
