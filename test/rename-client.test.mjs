import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { machineError } from "../src/commands/output.mjs";

const source = "摄影.md";
const target = "《电影摄影》.md";
const path = `/知识库.md/${source}`;
const baseline = { token: "before", mountsToken: "positions" };
const commitArgs = ["rename", path, target, "--token", baseline.token, "--mounts-token", baseline.mountsToken];
const renamePath = `/api/capsules/${encodeURIComponent(source)}/rename`;

test("重命名可从精确挂载预演，用两枚原token提交同一cap", async () => {
  const calls = [];
  const preview = { name: source, targetName: target, affectedPositions: [], blockedReasons: [], ...baseline };
  const saved = { name: target, previousName: source, commit: "commit", token: "after", movedPositions: [], eventId: "rename-event" };
  const api = new ApiClient({ serverUrl: "http://backend.invalid" }, async (address, init) => {
    const url = new URL(address);
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method, body: init.body && JSON.parse(init.body) });
    if (url.pathname === "/api/mounts/position") return Response.json({ path, items: [{ path, name: source }] });
    return Response.json(init.method === "GET" ? preview : saved);
  });
  assert.deepEqual(await dispatch(parseArguments(["rename", path, target, "--dry-run"]), api), { ...preview, dryRun: true, canApply: true });
  assert.deepEqual(await dispatch(parseArguments(commitArgs), api), saved);
  const position = { path: "/api/mounts/position", query: { path }, method: "GET", body: undefined };
  assert.deepEqual(calls, [position, { path: renamePath, query: { name: target }, method: "GET", body: undefined },
    position, { path: renamePath, query: {}, method: "POST", body: { name: target, ...baseline } }]);
});

test("改名拒绝残缺的基线、无效位置及不明成功回执", async () => {
  assert.throws(() => parseArguments(commitArgs.slice(0, -2)), /--token和--mounts-token/);
  assert.throws(() => parseArguments([...commitArgs, "--dry-run"]), /预演不携/);
  const missing = new ApiClient({ serverUrl: "http://backend.invalid" }, async (url) => {
    assert.ok(url.includes("/api/mounts/position"));
    return Response.json({ path, items: [{ path: `/${source}`, name: source }] });
  });
  await assert.rejects(dispatch(parseArguments(commitArgs), missing), (error) => error.code === "INVALID_RESPONSE" && !error.unknownResult);

  const incomplete = new ApiClient({ serverUrl: "http://backend.invalid" }, async () => Response.json({ eventId: "rename-event" }));
  const args = parseArguments(["rename", source, ...commitArgs.slice(2)]);
  await assert.rejects(dispatch(args, incomplete), (error) => {
    assert.match(error.message, /不能自动重放/);
    const details = machineError(error, { command: args.command }).error;
    return details.code === "INVALID_RESPONSE" && details.eventId === "rename-event" && details.unknownResult === true;
  });
});
