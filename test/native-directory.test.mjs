import test from "node:test";
import assert from "node:assert/strict";
import { ApiClient } from "../src/api/client.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { NativeDirectoryPages } from "../web/native-directory.mjs";

const result = (path, commit = "v1", nextOffset = null) => ({ items: [{ path, size: 3, kind: "file" }], commit, nextOffset });

test("第二列拒绝续入新版目录，切换cap时迟到页不污染新目录", async () => {
  const delayed = Promise.withResolvers(), errors = [], calls = [];
  const directories = new NativeDirectoryPages({
    request: async (_operation, input, { signal }) => {
      calls.push({ input, signal });
      if (input.name === "旧书.md" && input.directory === "") return result("README.md");
      if (input.name === "旧书.md" && !input.offset) return result("assets/0.jpg", "v1", 1);
      if (input.name === "旧书.md") return result("assets/1.jpg", "v2");
      if (input.name === "慢书.md") return delayed.promise;
      return result("README.md", "v3");
    },
    onChange() {}, onError(error) { errors.push(error.message); },
  });
  await directories.load("旧书.md");
  await directories.load("旧书.md", "assets");
  assert.equal(await directories.load("旧书.md", "assets", 1), false);
  assert.deepEqual(directories.get("assets").items.map(({ path }) => path), ["assets/0.jpg"]);
  assert.match(errors[0], /版本已变化/);
  directories.reset();
  const previous = directories.load("慢书.md");
  directories.reset();
  assert.equal(calls.at(-1).signal.aborted, true);
  await directories.load("新书.md");
  delayed.resolve(result("旧文件.md"));
  assert.equal(await previous, false);
  assert.deepEqual(directories.get().items.map(({ path }) => path), ["README.md"]);
});

test("根目录分页只在旧接口明确拒绝directory时退回平铺", async () => {
  for (const error of [
    { status: 400, code: "BAD_REQUEST", message: "请求包含不支持的字段" },
    { status: 400, message: "操作参数无效" },
    { status: 404, code: "NOT_FOUND", message: "胶囊不存在" },
  ]) {
    const calls = [];
    const directories = new NativeDirectoryPages({
      request: async (_operation, input) => {
        calls.push(input);
        if (input.directory === "") throw Object.assign(new Error(error.message), error);
        return { items: [{ path: "assets/0.jpg", size: 3 }], nextOffset: null };
      },
      onChange() {}, onError() {},
    });
    const expected = error.status === 400;
    assert.equal(await directories.load("书稿.md"), expected);
    assert.equal(directories.legacy, expected);
    assert.equal(calls.length, expected ? 2 : 1);
    if (expected) assert.equal(Object.hasOwn(calls[1], "directory"), false);
  }
});

test("本机桥接保留显式根目录参数和未指定目录的旧API", async () => {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://example.test" }, async (url) => {
    calls.push(new URL(url).searchParams);
    return Response.json({ items: [], total: 0, nextOffset: null });
  });
  for (const directory of ["", "assets/内层", undefined])
    await performAction(api, { action: "entries", name: "书稿.md", directory });
  assert.deepEqual(calls.map((query) => query.get("directory")), ["", "assets/内层", null]);
  await assert.rejects(performAction(api, { action: "entries", name: "书稿.md", directory: "../外部" }), { status: 400 });
});
