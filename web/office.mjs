import { action } from "./api.mjs";
import { button, node, replace, shortCommit } from "./dom.mjs";
import { downloadButton } from "./views.mjs";
import { editOffice } from "./office-edit.mjs";

function columnName(index) {
  let value = "";
  for (let number = index + 1; number > 0; number = Math.floor((number - 1) / 26)) value = String.fromCharCode(65 + (number - 1) % 26) + value;
  return value;
}

function spreadsheet(sheet) {
  const scroll = node("div", "sheet-scroll");
  const table = node("table", "data-table sheet-table");
  const head = node("thead");
  const title = node("tr");
  title.append(node("th", "sheet-index", ""));
  const width = Math.max(1, ...sheet.rows.map((row) => row.length));
  for (let index = 0; index < width; index++) {
    title.append(node("th", "", columnName(index)));
  }
  head.append(title);
  const body = node("tbody");
  sheet.rows.forEach((values, index) => {
    const row = node("tr");
    row.append(node("th", "sheet-index", index + 1));
    for (let column = 0; column < width; column++) row.append(node("td", "", values[column] ?? ""));
    body.append(row);
  });
  table.append(head, body);
  scroll.append(table);
  return scroll;
}

function documentPage(blocks) {
  const page = node("article", "document-paper");
  for (const block of blocks) {
    if (block.type === "table") {
      const table = node("table", "document-table");
      for (const values of block.rows) {
        const row = node("tr");
        for (const value of values) row.append(node("td", "", value));
        table.append(row);
      }
      page.append(table);
    } else page.append(node(block.type === "heading" ? `h${Math.max(1, Math.min(6, block.level || 1))}` : "p", "", block.text));
  }
  return page;
}

export async function officeView(container, cap, entry, isCurrent, onError, onContext, onSaved) {
  replace(container, node("p", "loading", "正在读取办公文件…"));
  try {
    const result = await action("preview", { name: cap.name, entry });
    if (!isCurrent()) return;
    if (result.commit !== cap.commit) throw new Error("文件在读取期间已有新版本，请刷新后查看。原有草稿会保留。");
    const wrapper = node("div", `office-view ${result.kind}-view`);
    const toolbar = node("div", "reading-toolbar");
    const edit = button(result.kind === "excel" ? "修改单元格" : "填充模板", () => editOffice(cap, entry, result, onSaved, onError));
    const hasTemplate = result.kind !== "word" || result.blocks.some((block) => /\{\{[^{}]+\}\}/.test(block.text || block.rows?.flat().join("\n") || ""));
    edit.disabled = result.writeSupported === false || !hasTemplate;
    if (!hasTemplate) edit.title = "文档中没有可填写的模板字段";
    if (result.writeSupported === false) edit.title = "此工作簿可读取，当前写回库不支持其封装";
    toolbar.append(node("span", "content-eyebrow", result.kind === "excel" ? "SPREADSHEET" : "DOCUMENT"), node("span", "muted", `原件预览 · ${shortCommit(result.commit)}`), edit, downloadButton(cap.name, entry));
    wrapper.append(toolbar);
    if (result.writeSupported === false) wrapper.append(node("p", "range-notice", "当前支持读取此原件；修改请下载后编辑，再上传新版本。"));
    if (result.kind === "excel") {
      const content = node("div", "sheet-content");
      const tabs = node("div", "sheet-tabs");
      const controls = [];
      const choose = (sheet, index) => {
        replace(content, spreadsheet(sheet));
        controls.forEach((control, item) => control.classList.toggle("active", item === index));
        onContext?.({ label: "工作表", values: result.sheets.map((item) => `${item.name} · ${item.rows.length} 行`) });
      };
      result.sheets.forEach((sheet, index) => {
        const control = button(sheet.name, () => choose(sheet, index), "button ghost");
        controls.push(control);
        tabs.append(control);
      });
      wrapper.append(content, tabs);
      if (result.sheets.length) choose(result.sheets[0], 0);
      else content.append(node("p", "file-empty", "工作簿没有可预览的工作表"));
    } else {
      const canvas = node("div", "document-canvas");
      canvas.append(documentPage(result.blocks));
      wrapper.append(canvas);
      onContext?.({ label: "文档大纲", values: result.blocks.filter((block) => block.type === "heading").map((block) => block.text) });
    }
    if (result.truncated) wrapper.append(node("p", "range-notice", "已达到预览范围上限，完整内容请下载原件。"));
    replace(container, wrapper);
  } catch (error) {
    if (!isCurrent()) return;
    const card = node("div", "empty-state");
    card.append(node("h2", "", "无法生成此文件的预览"), node("p", "", error.message), downloadButton(cap.name, entry));
    replace(container, card);
    onError(error);
  }
}
