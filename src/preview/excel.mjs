import ExcelJS from "exceljs";
import { compatibleExcelPreview } from "./excel-compat.mjs";
import { limits, previewError, TextBudget } from "./limits.mjs";

export function cellText(value) {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value !== "object") return String(value);
  if (Array.isArray(value.richText)) return value.richText.map((run) => run.text).join("");
  if (value.formula !== undefined || value.sharedFormula !== undefined)
    return value.result === undefined ? "=" + (value.formula || value.sharedFormula) : cellText(value.result);
  if (value.error !== undefined) return value.error;
  return value.text === undefined ? "" : String(value.text);
}

export async function loadWorkbook(buffer) {
  try {
    return await new ExcelJS.Workbook().xlsx.load(buffer);
  } catch {
    throw previewError("Excel 文件无法由 ExcelJS 读取");
  }
}

export async function excelPreview(buffer) {
  let workbook;
  try { workbook = await loadWorkbook(buffer); }
  catch { return compatibleExcelPreview(buffer); }
  if (!workbook.worksheets.length) throw previewError("Excel 文件没有工作表");
  const budget = new TextBudget();
  const sheets = workbook.worksheets.slice(0, limits.sheets).map((worksheet) => {
    const rows = [];
    let truncated = worksheet.rowCount > limits.rows || worksheet.columnCount > limits.columns;
    for (let index = 1; index <= Math.min(worksheet.rowCount, limits.rows); index++) {
      if (budget.remaining === 0) { truncated = true; break; }
      const row = worksheet.getRow(index);
      const values = [];
      for (let column = 1; column <= Math.min(row.cellCount, limits.columns); column++)
        values.push(budget.take(cellText(row.getCell(column).value)));
      rows.push(values);
    }
    return { name: budget.take(worksheet.name), rows, truncated };
  });
  return {
    kind: "excel",
    sheets,
    truncated: workbook.worksheets.length > limits.sheets || budget.truncated || sheets.some((sheet) => sheet.truncated),
  };
}
