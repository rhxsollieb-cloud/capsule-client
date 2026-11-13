import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api/client.mjs";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { waitForEvent } from "../src/commands/events.mjs";
import { performAction } from "../src/ui/actions.mjs";

function apiFixture(respond) {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://backend.invalid", token: "private-token" }, async (url, init) => {
    const call = { url: new URL(url), method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers };
    calls.push(call);
    assert.equal(init.headers.get("Authorization"), "Bearer private-token");
    return respond(call);
  });
  return { api, calls };
}

test("清除命令显式要求实体及挂载两个版本，预览命令只读", async () => {
  assert.throws(() => parseArguments(["delete", "资料包"]), /--token/u);
  assert.throws(() => parseArguments(["delete", "资料包", "--token", "cap-version"]), /--mounts-token/u);
  assert.throws(() => parseArguments(["delete", "资料包", "--token", "cap-version", "--mounts-token", "mount-version", "--timeout", "0"]), /有效整数/u);
  const preview = { name: "资料包", token: "cap-version", mountsToken: "mount-version", mounts: [], blockedBy: [], blockedReasons: [] };
  const { api, calls } = apiFixture(() => Response.json(preview));
  assert.deepEqual(await dispatch(parseArguments(["removal", "资料包"]), api), preview);
  assert.equal(calls.length, 1);
  assert.equal(decodeURIComponent(calls[0].url.pathname), "/api/capsules/资料包/removal");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, undefined);
});

test("CLI清除只入队一次，等待删除事件并接受无commit的终态结果", async () => {
  const result = { name: "资料包", removed: true, mounts: [{ name: "资料包", path: "/资料包" }], eventId: "delete-1" };
  const { api, calls } = apiFixture((call) => call.method === "DELETE"
    ? Response.json({ id: "delete-1", type: "delete", name: "资料包", status: "pending" }, { status: 202 })
    : Response.json({ id: "delete-1", type: "delete", name: "资料包", status: "succeeded", result }));
  const event = await dispatch(parseArguments(["delete", "资料包", "--token", "cap-version", "--mounts-token", "mount-version"]), api);
  assert.deepEqual(event.result, result);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "DELETE");
  assert.deepEqual(calls[0].body, { token: "cap-version", mountsToken: "mount-version" });
  assert.equal(calls[0].headers.has("If-Match"), false);
  assert.equal(calls[1].url.pathname, "/api/events/delete-1");
});

test("BFF位置与断链透传子树版本，整cap清除透传两份独立版本和事件", async () => {
  const pending = { id: "delete-2", type: "delete", name: "正文.txt", status: "pending" };
  const { api, calls } = apiFixture((call) => Response.json(call.url.pathname.endsWith("/position")
    ? { path: "/主题/正文.txt", token: "position-version", items: [{ name: "正文.txt", path: "/主题/正文.txt" }] }
    : call.method === "DELETE" && call.url.pathname.startsWith("/api/capsules/") ? pending : { ok: true }));
  const position = await performAction(api, { action: "position", path: "/主题/正文.txt" });
  await performAction(api, { action: "unmount", path: position.path, token: position.token });
  await performAction(api, { action: "removal", name: "正文.txt" });
  assert.deepEqual(await performAction(api, { action: "delete", name: "正文.txt", token: "cap-version", mountsToken: "all-mounts-version" }), pending);
  assert.equal(calls.length, 4);
  assert.equal(calls[0].url.pathname, "/api/mounts/position");
  assert.equal(calls[0].url.searchParams.get("path"), "/主题/正文.txt");
  assert.equal(calls[1].url.pathname, "/api/mounts");
  assert.equal(calls[1].url.searchParams.get("path"), position.path);
  assert.equal(calls[1].headers.get("If-Match"), "position-version");
  assert.equal(calls[1].body, undefined);
  assert.equal(decodeURIComponent(calls[2].url.pathname), "/api/capsules/正文.txt/removal");
  assert.deepEqual(calls[3].body, { token: "cap-version", mountsToken: "all-mounts-version" });
});

test("BFF拒绝缺失版本、未知字段和无效位置，不替调用者补版本", async () => {
  const { api, calls } = apiFixture(() => { throw new Error("无效输入不能访问服务端"); });
  for (const input of [
    { action: "delete", name: "正文.txt", token: "cap-version" },
    { action: "delete", name: "正文.txt", mountsToken: "mount-version" },
    { action: "delete", name: "正文.txt", token: "cap-version", mountsToken: "" },
    { action: "delete", name: "正文.txt", token: "cap-version", "mounts-token": "mount-version" },
    { action: "unmount", path: "/正文.txt" },
    { action: "position", path: "/" },
    { action: "position", path: "/主题/../正文.txt" },
  ]) await assert.rejects(performAction(api, input), (error) => error.status === 400);
  assert.equal(calls.length, 0);
});

test("清除冲突保留事件回执，未知提交结果不重放", async () => {
  const args = parseArguments(["delete", "正文.txt", "--token", "cap-version", "--mounts-token", "mount-version"]);
  const conflict = apiFixture(() => Response.json({ error: "挂载已变化", code: "CONFLICT", eventId: "delete-conflict" }, { status: 409 }));
  await assert.rejects(dispatch(args, conflict.api), (error) => error.status === 409 && error.eventId === "delete-conflict");
  assert.equal(conflict.calls.length, 1);
  const unknown = apiFixture(() => { throw new Error("连接中断"); });
  await assert.rejects(dispatch(args, unknown.api), /清除提交结果未知.*不能自动重放/u);
  assert.equal(unknown.calls.length, 1);
});

test("清除终态需匹配目标，超时保留原事件供查询", async () => {
  const wrong = { id: "delete-wrong", status: "succeeded", result: { name: "另一胶囊", removed: true } };
  const { api, calls } = apiFixture(() => Response.json(wrong, { status: 202 }));
  await assert.rejects(dispatch(parseArguments(["delete", "正文.txt", "--token", "cap-version", "--mounts-token", "mount-version"]), api),
    (error) => error.result.id === wrong.id && /清除结果/u.test(error.message));
  assert.equal(calls.length, 1);
  const pending = { id: "delete-pending", status: "running" };
  await assert.rejects(waitForEvent(api, pending, { timeoutMs: 0, operation: "清除" }),
    (error) => error.result === pending && /等待清除事件超时.*不能自动重放/u.test(error.message));
  assert.equal(calls.length, 1);
});
