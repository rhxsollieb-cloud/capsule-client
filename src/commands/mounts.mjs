import { listMounts, mountCapsule, moveMount, positionMount, unmountMount } from "../operations/mounts.mjs";

export function mountCommand(api, { command, positional, values }) {
  if (command === "ls") return listMounts(api, { path: positional[0] || "/", ...values });
  if (command === "mount") return mountCapsule(api, { name: positional[0], path: positional[1] });
  if (command === "position") return positionMount(api, positional[0]);
  if (command === "move") return moveMount(api, { path: positional[0], to: positional[1], token: values.token });
  return unmountMount(api, { path: positional[0], token: values.token });
}
