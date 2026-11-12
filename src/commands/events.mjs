import { setTimeout } from "node:timers/promises";
import { capsuleName } from "../system/paths.mjs";

const terminal = new Set(["succeeded", "failed", "conflict"]);
const states = new Set(["pending", "running", ...terminal]);

function eventError(message, event) {
  const error = new Error(message);
  error.result = event;
  return error;
}

export async function waitForEvent(api, first, { timeoutMs = 30 * 60 * 1000, pollMs = 100 } = {}) {
  let event = first;
  if (!event || typeof event.id !== "string" || !event.id)
    throw new Error("服务端未返回有效回撤事件ID，请查询events核对实际状态");
  const deadline = Date.now() + timeoutMs;
  while (!terminal.has(event.status)) {
    if (!states.has(event.status))
      throw eventError(`事件 ${event.id} 返回未知状态，请查询event核对`, event);
    if (Date.now() >= deadline)
      throw eventError(`等待回撤事件超时，事件 ${event.id} 当前为 ${event.status}；请用event查询，不能自动重放`, event);
    await setTimeout(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    let next;
    try {
      next = await api.json(`/api/events/${encodeURIComponent(first.id)}`);
    } catch (error) {
      throw eventError(`查询回撤事件 ${first.id} 失败，最后状态 ${event.status}：${error.message}`, event);
    }
    if (!next || next.id !== first.id || !states.has(next.status))
      throw eventError("服务端返回的事件ID或状态无效，请查询原事件核对", event);
    event = next;
  }
  if (event.status !== "succeeded") {
    const detail = typeof event.error === "string" ? event.error : event.error?.message;
    throw eventError(`回撤事件 ${event.id} ${event.status}${detail ? "：" + detail : ""}`, event);
  }
  if (!event.result || typeof event.result.commit !== "string")
    throw eventError("成功事件缺少提交结果，请查询event核对，不能自动重放", event);
  return event;
}

export async function eventCommand(api, { command, positional, values }) {
  if (command === "events") return api.json(api.query("/api/events", values));
  if (command === "event")
    return api.json(`/api/events/${encodeURIComponent(positional[0])}`);
  const name = capsuleName(positional[0]);
  let event;
  try {
    event = await api.json(api.path(name, "revert"), "POST", {
      commit: positional[1],
      token: values.token,
    });
  } catch (error) {
    if (!error.status)
      error.message += "；回撤提交结果未知，请查询events核对，不能自动重放";
    throw error;
  }
  return waitForEvent(api, event, { timeoutMs: (values.timeout ?? 1800) * 1000 });
}
