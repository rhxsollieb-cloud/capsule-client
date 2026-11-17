import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { copyCapsule } from "../src/operations/copy.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { performAction } from "../src/ui/actions.mjs";

test("复制 CLI 与前端使用同一接口和源 token，不获取源编辑占用", async () => {
  const calls = [];
  const result = { name: "可编辑副本.md", kind: "markdown", token: "new-token", eventId: "copy-event" };
  const api = new ApiClient({ serverUrl: "http://test.invalid", token: "test-only" }, async (url, init) => {
    calls.push({ path: new URL(url).pathname, method: init.method, body: JSON.parse(init.body), lease: init.headers.get("X-Capsule-Lease") });
    return Response.json(result, { status: 201 });
  });
  assert.deepEqual(await dispatch(parseArguments(["copy", "只读资料.md", result.name, "--token", "source-token"]), api), result);
  assert.deepEqual(await performAction(api, { action: "copy", name: "只读资料.md", to: result.name, token: "source-token" }), result);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
  assert.deepEqual(calls[0], {
    path: "/api/capsules/" + encodeURIComponent("只读资料.md") + "/copy", method: "POST",
    body: { name: result.name, token: "source-token" }, lease: null,
  });
});

test("复制在请求前拒绝无效名称、相同目标、缺少源 token 和多余字段", async () => {
  let requests = 0;
  const api = new ApiClient({ serverUrl: "http://test.invalid" }, async () => { requests++; return Response.json({}); });
  for (const value of [
    { name: "资料", to: "资料", token: "version" },
    { name: "资料", to: "../副本", token: "version" },
    { name: "资料", to: "副本", token: "" },
  ]) await assert.rejects(copyCapsule(api, value));
  await assert.rejects(performAction(api, { action: "copy", name: "资料", to: "副本", token: "version", userId: "arbitrary" }), /参数无效/);
  assert.throws(() => parseArguments(["copy", "资料", "副本"]), /token/);
  assert.equal(requests, 0);
});

test("复制发布中保留原事件，网络结果未知只报告目标核对且不重放", async () => {
  for (const pending of [true, false]) {
    let calls = 0;
    const api = new ApiClient({ serverUrl: "http://test.invalid" }, async () => {
      calls++;
      if (pending) return Response.json({ error: "发布未完成", code: "PUBLISH_PENDING", eventId: "original-event" }, { status: 500 });
      throw new Error("connection lost");
    });
    await assert.rejects(copyCapsule(api, { name: "源", to: "已请求的副本", token: "source-version" }), (error) => {
      assert.match(error.message, /已请求的副本.*不要重新提交复制/);
      if (pending) assert.equal(error.eventId, "original-event");
      else assert.equal(error.uncertain, true);
      return true;
    });
    assert.equal(calls, 1);
  }
});
