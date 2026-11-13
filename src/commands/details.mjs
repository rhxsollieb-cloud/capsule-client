import { capsuleName } from "../system/paths.mjs";
import { readTextInput } from "./input.mjs";

export async function detailsCommand(api, { command, positional, values }, context) {
  const name = capsuleName(positional[0]);
  if (command === "details") return api.json(api.path(name, "details", values));
  const body = await readTextInput(values.file, context);
  return api.json(api.path(name, "details"), "PUT", {
    token: values.token,
    body,
    ...(values.description !== undefined ? { description: values.description } : {}),
  });
}
