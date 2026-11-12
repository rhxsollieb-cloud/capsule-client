export function draftKey(name, table) { return `${name}\0${table}`; }

export function createDraft(record, offset = 0) {
  return { record, offset, original: structuredClone(record.items), rows: structuredClone(record.items), changes: new Map(), dirty: false };
}

export function editableCell(draft, rowIndex, name) {
  const column = draft.record.schema.find((item) => item.name === name);
  const primary = draft.record.schema.filter((item) => item.pk);
  return !draft.saving && draft.record.editable && column && !column.pk && !column.hidden
    && (draft.original[rowIndex][name] === null || typeof draft.original[rowIndex][name] !== "object")
    && primary.every((item) => draft.original[rowIndex][item.name] !== null);
}

export function editCell(draft, rowIndex, name, value) {
  if (draft.saving) return;
  draft.rows[rowIndex][name] = value;
  const original = draft.original[rowIndex];
  const changed = Object.fromEntries(Object.keys(original)
    .filter((column) => JSON.stringify(draft.rows[rowIndex][column]) !== JSON.stringify(original[column]))
    .map((column) => [column, draft.rows[rowIndex][column]]));
  if (Object.keys(changed).length) {
    const key = Object.fromEntries(draft.record.schema.filter((column) => column.pk)
      .map((column) => [column.name, original[column.name]]));
    draft.changes.set(rowIndex, { operation: "update", key, values: changed });
  } else draft.changes.delete(rowIndex);
  draft.dirty = draft.changes.size > 0;
}
