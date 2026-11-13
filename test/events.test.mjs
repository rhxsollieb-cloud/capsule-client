import test from "node:test";
import assert from "node:assert/strict";
import { dispatch, main } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { waitForEvent } from "../src/commands/events.mjs";
import { machineError } from "../src/commands/output.mjs";

test("回撤只入队一次，等待持久事件完成并返回新版本", async () => {
  const calls = [];
  const api = {
    path: (name, operation) => ({ name, operation }),
    json: async (path, method, body) => {
      calls.push({ path, method, body });
      if (method === "POST") return { id: "event-1", status: "pending" };
      return { id: "event-1", status: "succeeded", result: { commit: "restored" } };
    },
  };
  const result = await dispatch(parseArguments(["revert", "说明.txt", "target", "--token", "baseline"]), api);
  assert.equal(result.result.commit, "restored");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(calls[0].body, { commit: "target", token: "baseline" });
  assert.equal(calls[1].path, "/api/events/event-1");
});

test("回撤冲突和等待超时保留真实事件，不能自动重放", async () => {
  await assert.rejects(
    waitForEvent({}, { id: "conflict-1", status: "conflict", error: "旧版本" }),
    (error) => error.result.status === "conflict" && /旧版本/u.test(error.message),
  );
  let queries = 0;
  const api = { json: async () => { queries++; } };
  await assert.rejects(
    waitForEvent(api, { id: "pending-1", status: "pending" }, { timeoutMs: 0 }),
    (error) => error.result.id === "pending-1" && /不能自动重放/u.test(error.message),
  );
  assert.equal(queries, 0);
  const pending = { id: "pending-2", status: "pending" };
  await assert.rejects(
    waitForEvent({ json: async () => null }, pending, { pollMs: 0 }),
    (error) => error.result === pending && /ID或状态无效/u.test(error.message),
  );
});

test("事件查询错误保留上次状态，CLI失败输出事件结果", async () => {
  const first = { id: "running-1", status: "running" };
  await assert.rejects(
    waitForEvent({ json: async () => { throw new Error("断线"); } }, first, { pollMs: 0 }),
    (error) => error.result === first && /running-1.*running.*断线/u.test(error.message),
  );
  let stdout = "";
  let stderr = "";
  const io = {
    stdout: { write: (value) => { stdout += value; } },
    stderr: { write: (value) => { stderr += value; } },
  };
  assert.equal(await main(["revert", "说明.txt", "target"], {}, io), 1);
  assert.equal(stdout, "");
  assert.match(stderr, /token/u);
});

test("已知事件失败保留原始状态码与事件ID，不标记结果未知", async () => {
  for (const status of ["failed", "conflict"]) {
    const event = { id: "known-" + status, status, error: { message: "明确失败", status: 422, code: "ORIGINAL_FAILURE" } };
    await assert.rejects(waitForEvent({}, event), (error) => {
      assert.equal(error.eventId, event.id);
      assert.equal(error.code, "ORIGINAL_FAILURE");
      assert.equal(error.status, 422);
      assert.equal(error.uncertain, undefined);
      assert.equal(error.result, event);
      const result = machineError(error).error;
      assert.equal(result.eventId, event.id);
      assert.equal(result.unknownResult, undefined);
      return true;
    });
  }
});

test("事件超时、查询失败和无效回执保留最后真实事件并标记未知", async () => {
  const first = { id: "wait-1", status: "running" };
  const scenarios = [
    { api: {}, initial: first, options: { timeoutMs: 0 }, code: "EVENT_WAIT_TIMEOUT" },
    { api: { json: async () => { throw Object.assign(new Error("暂时不可用"), { status: 503 }); } }, initial: first, options: { pollMs: 0 }, code: "EVENT_POLL_FAILED", status: 503 },
    { api: { json: async () => ({ id: "other-event", status: "succeeded" }) }, initial: first, options: { pollMs: 0 }, code: "EVENT_RECEIPT_INVALID", status: 502 },
    { api: {}, initial: { ...first, status: "succeeded", result: {} }, code: "EVENT_RESULT_INVALID", status: 502 },
  ];
  for (const scenario of scenarios) await assert.rejects(waitForEvent(scenario.api, scenario.initial, scenario.options), (error) => {
    assert.equal(error.result, scenario.initial);
    assert.equal(error.eventId, first.id);
    assert.equal(error.code, scenario.code);
    assert.equal(error.status, scenario.status);
    assert.equal(error.uncertain, true);
    const result = machineError(error).error;
    assert.equal(result.eventId, first.id);
    assert.equal(result.unknownResult, true);
    return true;
  });
  await assert.rejects(waitForEvent({}, { status: "pending" }), (error) => error.code === "EVENT_RECEIPT_INVALID" && error.uncertain === true && error.eventId === undefined);
});
