import { posix } from "node:path";
import { whereCapsule } from "../operations/discovery.mjs";
import { listMounts, mountCapsule, moveMount, positionMount, unmountMount, virtualPath } from "../operations/mounts.mjs";
import { capsuleName } from "../system/paths.mjs";

const failure = (message, status, code) => Object.assign(new Error(message), { status, code });
const invalidResponse = () => failure("位置查询返回无效结果，无法核对移动范围", 502, "INVALID_RESPONSE");

async function moveSource(api, source) {
  if (source.startsWith("/")) return virtualPath(source, { root: false });
  let name;
  try { name = capsuleName(source); }
  catch (error) { throw Object.assign(error, { status: 400, code: "BAD_REQUEST" }); }
  const result = await whereCapsule(api, name, { limit: 2 });
  if (!Array.isArray(result?.items) || !Number.isSafeInteger(result.total) || result.total < 0 ||
      result.items.length !== Math.min(2, result.total)) throw invalidResponse();
  if (!result.total) throw failure(`「${name}」没有可见挂载，请先用 where 核对`, 404, "MOUNT_NOT_FOUND");
  if (result.total > 1) throw failure(`「${name}」有多处可见挂载，请用 where 查看并指定源虚拟路径`, 409, "MOUNT_AMBIGUOUS");
  const item = result.items[0];
  if (item?.name !== name || typeof item.path !== "string" || posix.basename(item.path) !== name) throw invalidResponse();
  try { return virtualPath(item.path, { root: false }); }
  catch (error) { throw Object.assign(invalidResponse(), { cause: error }); }
}

async function moveCommand(api, positional, values) {
  const [source, destination] = positional;
  const dryRun = values["dry-run"];
  if (!dryRun && values.into === undefined) return moveMount(api, { path: source, to: destination, token: values.token });

  const parent = values.into === undefined ? undefined : virtualPath(values.into);
  const explicitTo = destination === undefined ? undefined : virtualPath(destination, { root: false });
  const path = await moveSource(api, source);
  const name = posix.basename(path);
  const to = parent === undefined ? explicitTo : posix.join(parent, name);
  if (posix.basename(to) !== name)
    throw failure("目标路径末段必须等于胶囊名", 400, "BAD_REQUEST");
  if (to === path || to.startsWith(path + "/"))
    throw failure("目标不能是源位置或其子位置", 400, "BAD_REQUEST");
  if (!dryRun) return moveMount(api, { path, to, token: values.token });

  const targetParent = posix.dirname(to);
  const [position] = await Promise.all([
    positionMount(api, path),
    targetParent === "/" ? undefined : listMounts(api, { path: targetParent, limit: 1 }),
  ]);
  if (position?.path !== path || typeof position.token !== "string" || !position.token ||
      !Array.isArray(position.items) || !position.items.some((item) => item?.path === path && item.name === name) ||
      position.items.some((item) => typeof item?.path !== "string" || typeof item.name !== "string" ||
        (item.path !== path && !item.path.startsWith(path + "/")))) throw invalidResponse();
  return {
    dryRun: true, path, to, token: position.token, affected: position.items.length,
    items: position.items.map((item) => ({ name: item.name, from: item.path, path: to + item.path.slice(path.length) })),
  };
}

export function mountCommand(api, { command, positional, values }) {
  if (command === "ls") return listMounts(api, { path: positional[0] || "/", ...values });
  if (command === "mount") return mountCapsule(api, { name: positional[0], path: positional[1] });
  if (command === "position") return positionMount(api, positional[0]);
  if (command === "move") return moveCommand(api, positional, values);
  return unmountMount(api, { path: positional[0], token: values.token });
}
