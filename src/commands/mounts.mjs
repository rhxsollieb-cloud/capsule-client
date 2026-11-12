import { capsuleName } from "../system/paths.mjs";

export async function mountCommand(api, { command, positional, values }) {
  switch (command) {
    case "ls":
      return api.json(
        api.query("/api/mounts", { path: positional[0] || "/", ...values }),
      );
    case "mount":
      return api.json("/api/mounts", "POST", {
        name: capsuleName(positional[0]),
        path: positional[1],
      });
    case "position":
      return api.json(
        api.query("/api/mounts/position", { path: positional[0] }),
      );
    case "move":
      return api.json("/api/mounts/move", "POST", {
        path: positional[0],
        to: positional[1],
        token: values.token,
      });
    case "unmount":
      return api.json(
        api.query("/api/mounts", { path: positional[0] }),
        "DELETE",
        undefined,
        { "If-Match": values.token },
      );
    default:
      throw new Error("不支持的位置命令：" + command);
  }
}
