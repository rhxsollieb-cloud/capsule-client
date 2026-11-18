import { capsuleName } from "../system/paths.mjs";
import { waitForEvent } from "./events.mjs";
import { renameCommand } from "./rename.mjs";

export async function managementCommand(api, { command, positional, values }, context) {
  if (command === "rename") return renameCommand(api, positional, values, context);
  const name = capsuleName(positional[0]);
  if (command === "removal") return api.json(api.path(name, "removal"));
  let event;
  try {
    event = await api.json(api.path(name), "DELETE", { token: values.token, mountsToken: values["mounts-token"] });
  } catch (error) {
    if (!error.status)
      error.message += "；清除提交结果未知，请查询events核对，不能自动重放";
    throw error;
  }
  return waitForEvent(api, event, {
    timeoutMs: (values.timeout ?? 1800) * 1000,
    operation: "清除",
    validateResult: (result) => result?.name === name && result.removed === true,
  });
}
