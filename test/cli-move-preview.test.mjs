import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { mountCommand } from "../src/commands/mounts.mjs";

const name = "词形索引.md";
const source = "/旧主题.md/" + name;
const parent = "/影视术语词表.md";
const destination = parent + "/" + name;
const child = "说明.md";

function fixture({ positions = [{ name, path: source }], conflict = false } = {}) {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://backend.invalid", token: "" }, async (address, request) => {
    const url = new URL(address);
    calls.push({ path: decodeURIComponent(url.pathname), query: Object.fromEntries(url.searchParams), method: request.method,
      ...(request.body ? { body: JSON.parse(request.body) } : {}) });
    if (url.pathname.endsWith("/positions")) return Response.json({ items: positions, total: positions.length, nextOffset: null });
    if (url.pathname === "/api/mounts/position") return Response.json({ path: source, token: "preview-tree-token",
      items: [{ name, path: source }, { name: child, path: source + "/" + child }] });
    if (url.pathname === "/api/mounts") {
      assert.equal(url.searchParams.get("path"), parent);
      return Response.json({ items: [], total: 0, nextOffset: null });
    }
    if (url.pathname === "/api/mounts/move") {
      if (conflict) return Response.json({ error: "位置已变化", code: "VERSION_CONFLICT" }, { status: 409 });
      return Response.json({ path: destination, moved: 2 });
    }
    assert.fail("Unexpected route " + url.pathname);
  });
  return { calls, move: (...args) => mountCommand(api, parseArguments(["move", ...args])) };
}

test("按唯一胶囊名预演移动，定位目标父节点并给出子树的具体去向", async () => {
  const { calls, move } = fixture();
  const preview = await move(name, "--into", parent, "--dry-run");
  assert.deepEqual(preview, { dryRun: true, path: source, to: destination, token: "preview-tree-token", affected: 2,
    items: [{ name, from: source, path: destination }, { name: child, from: source + "/" + child, path: destination + "/" + child }] });
  assert.deepEqual(calls.map(({ method }) => method), ["GET", "GET", "GET"]);
  assert.deepEqual(calls[0].query, { limit: "2" });
  assert.deepEqual(calls[1].query, { path: source });
  assert.deepEqual(calls[2].query, { path: parent, limit: "1" });
});

test("正式移动携预演token，仅发送一条写入，遇版本冲突不换token重放", async () => {
  for (const conflict of [false, true]) {
    const { calls, move } = fixture({ conflict });
    const apply = move(source, "--into", parent, "--token", "preview-tree-token");
    if (conflict) await assert.rejects(apply, { code: "VERSION_CONFLICT", status: 409 });
    else assert.deepEqual(await apply, { path: destination, moved: 2 });
    assert.deepEqual(calls, [{ path: "/api/mounts/move", query: {}, method: "POST",
      body: { path: source, to: destination, token: "preview-tree-token" } }]);
  }
});

test("无挂载或多挂载不选择源，绝对虚拟路径可直接预演移到根", async () => {
  for (const [paths, code] of [[[], "MOUNT_NOT_FOUND"], [[source, "/第二处.md/" + name], "MOUNT_AMBIGUOUS"]]) {
    const { calls, move } = fixture({ positions: paths.map(path => ({ name, path })) });
    await assert.rejects(move(name, "--into", parent, "--dry-run"), { code });
    assert.equal(calls.length, 1);
  }
  const { calls, move } = fixture();
  const preview = await move(source, "--into", "/", "--dry-run");
  assert.equal(preview.to, "/" + name);
  assert.equal(calls.length, 1);
  await assert.rejects(move(source, "--into", source, "--dry-run"), { status: 400 });
  assert.equal(calls.length, 1);
});
