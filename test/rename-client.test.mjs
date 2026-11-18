import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { machineError, printResult } from "../src/commands/output.mjs";

const source = "摄影.md";
const target = "《电影摄影》.md";
const path = `/知识库.md/${source}`;
const baseline = { token: "before", mountsToken: "positions" };
const commitArgs = ["rename", path, target, "--token", baseline.token, "--mounts-token", baseline.mountsToken];
const renamePath = `/api/capsules/${encodeURIComponent(source)}/rename`;
const stdin = (value) => ({ stdin: Readable.from([JSON.stringify(value)]) });

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
  const { plan, ...prepared } = await dispatch(parseArguments(["rename", path, target, "--dry-run"]), api);
  assert.deepEqual(prepared, { ...preview, dryRun: true, prepared: true, canApply: true });
  assert.deepEqual({ sourceName: plan.sourceName, name: plan.name, token: plan.token, mountsToken: plan.mountsToken }, { sourceName: source, name: target, ...baseline });
  assert.deepEqual(await dispatch(parseArguments(commitArgs), api), saved);
  const position = { path: "/api/mounts/position", query: { path }, method: "GET", body: undefined };
  assert.deepEqual(calls, [position, { path: renamePath, query: { name: target }, method: "GET", body: undefined },
    position, { path: renamePath, query: {}, method: "POST", body: { name: target, ...baseline } }]);
});

test("移动并改名的预演文件保留范围，提交沿用两个版本且只发送一次POST", async (t) => {
  const into = `/档案.md/${source}`;
  const destination = `/档案.md/${target}/${target}`;
  const mapping = [
    { from: path, path: destination, name: target },
    { from: `${path}/术语.md`, path: `${destination}/术语.md`, name: "术语.md" },
    { from: into, path: `/档案.md/${target}`, name: target },
  ];
  const dir = await mkdtemp(join(tmpdir(), "capsule-rename-plan-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, "改名.json");
  const calls = [];
  const preview = { name: source, targetName: target, affectedPositions: mapping, path: destination, blockedReasons: [], ...baseline };
  const saved = { name: target, previousName: source, commit: "commit", token: "after", movedPositions: mapping, path: destination, eventId: "rename-event" };
  const api = new ApiClient({ serverUrl: "http://backend.invalid" }, async (address, init) => {
    const url = new URL(address);
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), method: init.method, body: init.body && JSON.parse(init.body) });
    return Response.json(init.method === "GET" ? preview : saved);
  });
  const args = parseArguments(["rename", path, target, "--into", into, "--dry-run", "--out", file, "--fields", "path"]);
  await printResult(await dispatch(args, api), args, { stdout: { write() {} } });
  const onDisk = JSON.parse(await readFile(file, "utf8"));
  assert.deepEqual(onDisk.affectedPositions, mapping);
  assert.equal(onDisk.path, destination);
  assert.deepEqual(await dispatch(parseArguments(["rename", "--plan", file]), api), saved);
  const post = { path: renamePath, query: {}, method: "POST", body: { name: target, ...baseline, path, into } };
  assert.deepEqual(calls, [{ path: renamePath, query: { name: target, path, into }, method: "GET", body: undefined }, post]);

  const modified = { ...onDisk, affectedPositions: mapping.slice(0, 1) };
  await assert.rejects(dispatch(parseArguments(["rename", "--plan", "-"]), api, stdin(modified)), (error) => error.code === "RENAME_PLAN_INVALID");
  assert.equal(calls.length, 2);
  assert.deepEqual(await dispatch(parseArguments([...commitArgs, "--into", into]), api), saved);
  assert.deepEqual(calls.at(-1), post);

  const stale = new ApiClient({ serverUrl: "http://backend.invalid" }, async (_address, init) => {
    assert.equal(init.method, "POST");
    return Response.json({ error: "挂载已变化", code: "RENAME_POSITIONS_CHANGED" }, { status: 409 });
  });
  await assert.rejects(dispatch(parseArguments(["rename", "--plan", "-"]), stale, stdin(onDisk)), (error) => error.code === "RENAME_POSITIONS_CHANGED" && !error.unknownResult);
});

test("被阻止的预演和互斥参数均不允许提交", async () => {
  assert.throws(() => parseArguments(["rename", source, target, "--into", "/", "--dry-run"]), /需要原精确虚拟路径/);
  assert.throws(() => parseArguments(["rename", "--plan", "-", "--dry-run"]), /不能与/);
  let calls = 0;
  const api = new ApiClient({ serverUrl: "http://backend.invalid" }, async () => {
    calls++;
    return Response.json({ name: source, targetName: target, affectedPositions: [], blockedReasons: ["目标父位置不存在"], ...baseline });
  });
  const blocked = await dispatch(parseArguments(["rename", path, target, "--into", "/不存在.md", "--dry-run"]), api);
  assert.equal(blocked.canApply, false);
  await assert.rejects(dispatch(parseArguments(["rename", "--plan", "-"]), api, stdin(blocked)), (error) => error.code === "RENAME_PLAN_BLOCKED");
  assert.equal(calls, 1);
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
