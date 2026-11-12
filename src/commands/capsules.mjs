import { readFile } from "node:fs/promises";
import { capsuleName, entryPath } from "../system/paths.mjs";

export async function capsuleCommand(api, { command, positional, values }) {
  if (command === "list") return api.json(api.query("/api/capsules", values));
  const name = capsuleName(positional[0]);
  switch (command) {
    case "create": {
      if (Boolean(values.engine) !== Boolean(values.entry))
        throw new Error("运行配置需同时提供 --engine 和 --entry");
      const input = { name, description: values.description || "" };
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
      return api.json(api.path(name));
    case "entries":
      return api.json(api.path(name, "entries", values));
    case "read":
      return api.json(
        api.path(name, "read", {
          entry: entryPath(positional[1] || "说明.md"),
          ...values,
        }),
      );
    case "history":
      return api.json(api.path(name, "history", values));
    case "put":
      return api.upload(
        name,
        entryPath(positional[1]),
        positional[2],
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
