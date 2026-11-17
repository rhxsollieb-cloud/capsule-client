import { button, formField, node } from "./dom.mjs";

export const roleLabels = { admin: "管理员", editor: "普通员工" };
export function input(label, value = "", { required = false, type = "text", options } = {}) {
  const control = node(options ? "select" : "input", "property-input");
  if (options) for (const [key, text] of Object.entries(options)) {
    const option = node("option", "", text); option.value = key; control.append(option);
  }
  else control.type = type;
  control.value = value;
  control.required = required;
  if (!options) control.autocomplete = "off";
  return { control, field: formField(label, control) };
}
export function section(title, ...children) {
  const element = node("section", "admin-section");
  element.append(node("h3", "", title), ...children);
  return element;
}
export function form(fields, label, submit) {
  const element = node("form", "admin-form");
  const control = node("button", "button primary", label);
  control.type = "submit";
  element.append(...fields, control);
  element.addEventListener("submit", (event) => { event.preventDefault(); submit(); });
  return element;
}
export function rows(items, columns, actions) {
  const wrapper = node("div", "admin-table-scroll");
  if (!items.length) { wrapper.append(node("p", "property-note", "暂无记录")); return wrapper; }
  const table = node("table", "admin-table");
  const header = node("tr");
  for (const [, title] of columns) header.append(node("th", "", title));
  if (actions) header.append(node("th", "", "操作"));
  const head = node("thead"); head.append(header); table.append(head);
  const body = node("tbody");
  for (const item of items) {
    const row = node("tr");
    for (const [key] of columns) row.append(node("td", "", typeof key === "function" ? key(item) : item[key] ?? "—"));
    if (actions) { const controls = node("td", "admin-row-actions"); controls.append(...actions(item).filter(Boolean)); row.append(controls); }
    body.append(row);
  }
  table.append(body); wrapper.append(table); return wrapper;
}
export function pagination(result, offset, load) {
  const element = node("div", "admin-pagination");
  const previous = button("上一页", () => load(Math.max(0, offset - 30)));
  const next = button("下一页", () => load(result.nextOffset));
  previous.disabled = !offset;
  next.disabled = result.nextOffset === null || result.nextOffset === undefined;
  element.append(node("span", "property-note", `共 ${result.total ?? result.items.length} 项 · 本页 ${result.items.length} 项`), previous, next);
  return element;
}
export function details(value) {
  const result = node("pre", "admin-result"); result.textContent = JSON.stringify(value, null, 2); return result;
}
export function oneTimeCredential(result) {
  return result?.token || result?.bootstrapCredential?.token;
}
