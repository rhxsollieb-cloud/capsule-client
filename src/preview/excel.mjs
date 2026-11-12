import { posix } from "node:path";
import { children, descendants, first, textContent, xmlDocument } from "./xml.mjs";
import { limits, previewError, TextBudget } from "./limits.mjs";

function columnIndex(reference) {
  const match = /^([A-Z]+)[1-9]\d*$/.exec(reference || "");
  if (!match || match[1].length > 3) return undefined;
  let number = 0;
  for (const letter of match[1]) number = number * 26 + letter.charCodeAt(0) - 64;
  return number - 1;
}

function cellValue(cell, strings) {
  const type = cell.attributes.t;
  const value = textContent(first(cell, "v"));
  if (type === "s") {
    if (!/^\d+$/.test(value) || Number(value) >= strings.length)
      throw previewError("Excel 共享文本索引无效");
    return strings[Number(value)];
  }
  if (type === "inlineStr") return descendants(cell, "t").map(textContent).join("");
  if (type === "b") return value === "1" ? "TRUE" : "FALSE";
  const formula = first(cell, "f");
  return value || (formula ? "=" + textContent(formula) : "");
}

function worksheet(source, strings, budget) {
  const document = xmlDocument(source);
  const data = descendants(document, "sheetData")[0];
  if (!data) throw previewError("Excel 工作表缺少数据区域");
  const rows = [];
  let truncated = false;
  let implicitRow = 0;
  for (const row of children(data, "row")) {
    const explicit = row.attributes.r;
    if (explicit !== undefined && !/^[1-9]\d*$/.test(explicit))
      throw previewError("Excel 行号无效");
    const index = explicit === undefined ? implicitRow : Number(explicit) - 1;
    implicitRow = index + 1;
    if (index >= limits.rows || budget.remaining === 0) {
      truncated = true;
      continue;
    }
    while (rows.length <= index) rows.push([]);
    let implicitColumn = 0;
    for (const cell of children(row, "c")) {
      const column = cell.attributes.r === undefined ? implicitColumn : columnIndex(cell.attributes.r);
      if (column === undefined) throw previewError("Excel 单元格坐标无效");
      implicitColumn = column + 1;
      if (column >= limits.columns) {
        truncated = true;
        continue;
      }
      while (rows[index].length <= column) rows[index].push("");
      rows[index][column] = budget.take(cellValue(cell, strings));
    }
  }
  return { rows, truncated };
}

export function excelPreview(parts) {
  const workbook = xmlDocument(parts.get("xl/workbook.xml"));
  const relationships = xmlDocument(parts.get("xl/_rels/workbook.xml.rels"));
  const targets = new Map(descendants(relationships, "Relationship").map((element) =>
    [element.attributes.Id, element.attributes]));
  const strings = parts.has("xl/sharedStrings.xml")
    ? descendants(xmlDocument(parts.get("xl/sharedStrings.xml")), "si")
      .map((element) => descendants(element, "t").map(textContent).join(""))
    : [];
  const allSheets = descendants(workbook, "sheet");
  if (!allSheets.length) throw previewError("Excel 文件没有可预览工作表");
  const budget = new TextBudget();
  const sheets = allSheets.slice(0, limits.sheets).map((sheet) => {
    const relationship = targets.get(sheet.attributes.id);
    if (!relationship || relationship.TargetMode === "External")
      throw previewError("Excel 工作表引用无效或指向外部内容");
    const target = relationship.Target || "";
    if (target.includes("\\") || /^[a-z]+:/i.test(target))
      throw previewError("Excel 工作表路径无效");
    const path = posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join("xl", target));
    if (!/^xl\/worksheets\/[^/]+\.xml$/.test(path))
      throw previewError("Excel 工作表不在受支持的文件区");
    return {
      name: budget.take(sheet.attributes.name || "工作表"),
      ...worksheet(parts.get(path), strings, budget),
    };
  });
  return {
    kind: "excel",
    sheets,
    truncated: allSheets.length > limits.sheets || budget.truncated || sheets.some((sheet) => sheet.truncated),
  };
}
