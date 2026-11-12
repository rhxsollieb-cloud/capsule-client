import { Tabulator } from "./vendor/grid.mjs";
import { node } from "./dom.mjs";

export function cellText(value) {
  if (value === null) return "NULL";
  if (value?.type === "bigint") return value.value;
  if (value?.type === "blob") return `[BLOB · ${Math.floor(value.base64.length * 3 / 4)} B]`;
  return typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
}

export function createDataGrid(container, { columns, rows, editable, onEdit }) {
  const table = new Tabulator(container, {
    data: rows.map((row, index) => Object.fromEntries([
      ["_rowIndex", index],
      ...columns.map((column, columnIndex) => [`c${columnIndex}`, row[column]]),
    ])),
    index: "_rowIndex",
    height: "100%",
    layout: "fitDataStretch",
    placeholder: "没有匹配记录",
    editTriggerEvent: "dblclick",
    validationMode: "blocking",
    columns: columns.map((column, index) => ({
      title: column,
      titleFormatter: () => node("span", "", column),
      field: `c${index}`,
      minWidth: 130,
      maxWidth: 420,
      headerFilter: "input",
      headerFilterPlaceholder: "筛选当前页",
      formatter: (cell) => node("span", cell.getValue() === null ? "null-value" : "", cellText(cell.getValue())),
      editor: onEdit ? "adaptable" : false,
      validator: (cell, value) => {
        const original = rows[cell.getRow().getData()._rowIndex][column];
        if (typeof original === "number") return typeof value === "number" && Number.isFinite(value);
        if (typeof original === "boolean") return typeof value === "boolean";
        return true;
      },
      editable: (cell) => Boolean(editable?.(cell.getRow().getData()._rowIndex, column)),
    })),
  });
  table.on("cellEdited", (cell) => {
    const column = columns[Number(cell.getField().slice(1))];
    const dirty = onEdit?.(cell.getRow().getData()._rowIndex, column, cell.getValue());
    cell.getElement().classList.toggle("cell-dirty", dirty !== false);
  });
  return { destroy: () => table.destroy() };
}
