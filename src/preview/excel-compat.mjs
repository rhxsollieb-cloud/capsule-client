import XLSX from "xlsx";
import { limits, previewError, TextBudget } from "./limits.mjs";

function cellText(cell) {
  if (!cell) return "";
  if (cell.v !== undefined && cell.v !== null) {
    if (cell.t === "b") return cell.v ? "TRUE" : "FALSE";
    if (cell.v instanceof Date) return cell.v.toISOString();
    return String(cell.v);
  }
  return cell.f ? "=" + cell.f : "";
}

// The compatibility reader never serializes the workbook back to the original cap.
export function compatibleExcelPreview(buffer) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellFormula: true, cellDates: false });
  } catch {
    throw previewError("Excel 文件无法由兼容读取器解析");
  }
  if (!workbook.SheetNames.length) throw previewError("Excel 文件没有工作表");
  const budget = new TextBudget();
  const sheets = workbook.SheetNames.slice(0, limits.sheets).map((name) => {
    const sheet = workbook.Sheets[name];
    const range = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]) : undefined;
    const rows = [];
    let truncated = Boolean(range && (range.e.r >= limits.rows || range.e.c >= limits.columns));
    if (range) for (let row = 0; row <= Math.min(range.e.r, limits.rows - 1); row++) {
      if (!budget.remaining) { truncated = true; break; }
      const values = [];
      for (let column = 0; column <= Math.min(range.e.c, limits.columns - 1); column++)
        values.push(budget.take(cellText(sheet[XLSX.utils.encode_cell({ r: row, c: column })])));
      rows.push(values);
    }
    return { name: budget.take(name), rows, truncated };
  });
  return {
    kind: "excel",
    sheets,
    truncated: workbook.SheetNames.length > limits.sheets || budget.truncated || sheets.some((sheet) => sheet.truncated),
    writeSupported: false,
  };
}
