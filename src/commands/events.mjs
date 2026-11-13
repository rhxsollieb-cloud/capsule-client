import { setTimeout } from "node:timers/promises";
import { capsuleName } from "../system/paths.mjs";

const terminal = new Set(["succeeded", "failed", "conflict"]);
const states = new Set(["pending", "running", ...terminal]);

function eventError(message, event, { code, status, uncertain = false, cause } = {}) {
  const error = new Error(message, cause ? { cause } : undefined);
  if (event !== undefined) error.result = event;
  if (typeof event?.id === "string" && event.id) error.eventId = event.id;
  if (code) error.code = code;
  if (Number.isInteger(status) && status >= 400 && status <= 599) error.status = status;
  if (uncertain) error.uncertain = true;
  return error;
}

export async function waitForEvent(api, first, {
  timeoutMs = 30 * 60 * 1000,
  pollMs = 100,
  operation = "回撤",
  validateResult = (result) => typeof result?.commit === "string",
} = {}) {
  let event = first;
  if (!event || typeof event.id !== "string" || !event.id)
    throw eventError(`服务端未返回有效${operation}事件ID，请查询events核对实际状态`, event,
      { code: "EVENT_RECEIPT_INVALID", status: 502, uncertain: true });
  const deadline = Date.now() + timeoutMs;
  while (!terminal.has(event.status)) {
    if (!states.has(event.status))
      throw eventError(`事件 ${event.id} 返回未知状态，请查询event核对`, event,
        { code: "EVENT_RECEIPT_INVALID", status: 502, uncertain: true });
    if (Date.now() >= deadline)
      throw eventError(`等待${operation}事件超时，事件 ${event.id} 当前为 ${event.status}；请用event查询，不能自动重放`, event,
        { code: "EVENT_WAIT_TIMEOUT", uncertain: true });
    await setTimeout(Math.min(pollMs, Math.max(0, deadline - Date.now())));
    let next;
    try {
      next = await api.json(`/api/events/${encodeURIComponent(first.id)}`);
    } catch (error) {
      throw eventError(`查询${operation}事件 ${first.id} 失败，最后状态 ${event.status}：${error.message}`, event,
        { code: "EVENT_POLL_FAILED", status: error.status, uncertain: true, cause: error });
    }
    if (!next || next.id !== first.id || !states.has(next.status))
      throw eventError("服务端返回的事件ID或状态无效，请查询原事件核对", event,
        { code: "EVENT_RECEIPT_INVALID", status: 502, uncertain: true });
    event = next;
  }
  if (event.status !== "succeeded") {
    const detail = typeof event.error === "string" ? event.error : event.error?.message;
    throw eventError(`${operation}事件 ${event.id} ${event.status}${detail ? "：" + detail : ""}`, event, {
      code: typeof event.error?.code === "string" && event.error.code ? event.error.code : event.status === "conflict" ? "CONFLICT" : "EVENT_FAILED",
      status: event.error?.status ?? (event.status === "conflict" ? 409 : 500),
    });
  }
  if (!validateResult(event.result))
    throw eventError(`成功事件缺少有效${operation}结果，请查询event核对，不能自动重放`, event,
      { code: "EVENT_RESULT_INVALID", status: 502, uncertain: true });
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
