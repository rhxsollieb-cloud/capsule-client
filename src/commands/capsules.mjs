import { readFile } from "node:fs/promises";
import { capsuleName, entryPath } from "../system/paths.mjs";

export async function capsuleCommand(api, { command, positional, values }) {
  if (command === "list") return api.json(api.query("/api/capsules", values));
  const name = capsuleName(positional[0]);
  switch (command) {
    case "create": {
      const input = { name, description: values.description || "" };
      if (values.kind !== undefined) input.kind = values.kind;
      if (values.body) input.body = await readFile(values.body, "utf8");
      if (values.engine) {
        input.runtime = {
          engine: values.engine,
          entry: entryPath(values.entry),
        };
      }
      return api.json("/api/capsules", "POST", input);
    }
    case "stat":
      return api.json(api.path(name, "", values));
    case "update": {
      const input = { token: values.token };
      if (values.description !== undefined) input.description = values.description;
      if (values.engine !== undefined)
        input.runtime = { engine: values.engine, entry: entryPath(values.entry) };
      return api.json(api.path(name), "PATCH", input);
    }
    case "entries":
      return api.json(api.path(name, "entries", values));
    case "read":
      return api.json(
        api.path(name, "read", {
          ...(positional[1] === undefined ? {} : { entry: entryPath(positional[1]) }),
          ...values,
        }),
      );
    case "history":
      return api.json(api.path(name, "history", values));
    case "put":
      return api.upload(
        name,
        positional.length === 2 ? undefined : entryPath(positional[1]),
        positional.at(-1),
        values.token,
      );
    case "remove-entry":
      return api.json(
        api.path(name, "content", { entry: entryPath(positional[1]) }),
        "DELETE",
        undefined,
        { "If-Match": values.token },
      );
    default:
      throw new Error("不支持的胶囊命令：" + command);
  }
}
