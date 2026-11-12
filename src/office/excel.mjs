import { loadWorkbook } from "../preview/excel.mjs";
import { previewError } from "../preview/limits.mjs";

export async function patchExcel(buffer, changes) {
  if (!changes || Object.keys(changes).some((key) => key !== "cells") ||
      !Array.isArray(changes.cells) || !changes.cells.length || changes.cells.length > 1000)
    throw previewError("Excel 修改需要 1–1000 项 cells 数组", 400);
  let workbook;
  try { workbook = await loadWorkbook(buffer); }
  catch { throw previewError("此原件可以兼容预览，但当前写入库不支持安全修改，请下载原件处理后重新上传", 415); }
  const pending = [];
  for (const change of changes.cells) {
    if (!change || typeof change !== "object" || Array.isArray(change) ||
        Object.keys(change).some((key) => !["sheet", "cell", "value"].includes(key)) ||
        typeof change.sheet !== "string" || typeof change.cell !== "string" ||
        !/^[A-Z]{1,3}[1-9]\d{0,6}$/.test(change.cell) || !Object.hasOwn(change, "value"))
      throw previewError("每项单元格修改需要 sheet、cell 和 value", 400);
    const { value } = change;
    if (value !== null && !["string", "number", "boolean"].includes(typeof value) ||
        typeof value === "number" && !Number.isFinite(value) ||
        typeof value === "string" && value.length > 32767)
      throw previewError("单元格 value 需要有限数字、文本、布尔值或 null", 400);
    const worksheet = workbook.getWorksheet(change.sheet);
    if (!worksheet) throw previewError(`工作表不存在：${change.sheet}`, 404);
    const cell = worksheet.getCell(change.cell);
    if (cell.row > 1048576 || cell.col > 16384)
      throw previewError("单元格地址超出 Excel 工作表范围", 400);
    pending.push({ cell, value });
  }
  for (const { cell, value } of pending) cell.value = value;
  for (const worksheet of workbook.worksheets) worksheet.eachRow((row) => row.eachCell((cell) => {
    const value = cell.value;
    if (!value || typeof value !== "object" || value.formula === undefined && value.sharedFormula === undefined) return;
    const formula = { ...value };
    delete formula.result;
    cell.value = formula;
  }));
  workbook.calcProperties.fullCalcOnLoad = true;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
