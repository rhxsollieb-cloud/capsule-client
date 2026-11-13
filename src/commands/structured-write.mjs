import { writeOffice } from "../office/write.mjs";
import { writeTable } from "../database/tables.mjs";
import { readJsonInput } from "./input.mjs";

export async function structuredWriteCommand(api, { command, positional, values }, context) {
  const changes = await readJsonInput(values.file, context);
  const name = positional[0];
  if (command === "table-write")
    return writeTable(api, name, { table: positional[1], changes, token: values.token });
  return writeOffice(api, name, { entry: positional[1], changes, token: values.token });
}
