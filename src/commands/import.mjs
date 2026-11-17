import { importDirectory } from "../operations/import.mjs";

export function importCommand(api, { positional, values }) {
  return importDirectory(api, { directory: positional[0], name: positional[1], kind: values.kind, description: values.description });
}
