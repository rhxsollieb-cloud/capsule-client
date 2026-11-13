import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApiClient } from "../src/api/client.mjs";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { performAction } from "../src/ui/actions.mjs";

function apiFixture(respond) {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://backend.invalid", token: "private-token" }, async (url, init) => {
    const call = { url: new URL(url), method: init.method, body: init.body === undefined ? undefined : JSON.parse(init.body), headers: init.headers };
    calls.push(call);
    assert.equal(call.headers.get("Authorization"), "Bearer private-token");
    return respond(call);
  });
  return { api, calls };
}

async function textFile(t, bytes) {
  const directory = await mkdtemp(join(tmpdir(), "capsule-details-client-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "详述.txt");
  await writeFile(file, bytes);
  return file;
}

test("详述读取保留服务端来源与分页，不自行复制正文或推断存储", async () => {
  const details = { name: "资料包", kind: "database", description: "简述", body: "第二行", token: "cap-version", commit: "commit", source: { type: "content", entry: "说明.md" }, lines: { from: 2, to: 2, total: 3, nextLine: 3, truncated: true } };
  const { api, calls } = apiFixture(() => Response.json(details));
  assert.deepEqual(await dispatch(parseArguments(["details", "资料包", "--from", "2", "--limit", "1"]), api), details);
  assert.equal(calls.length, 1);
  assert.equal(decodeURIComponent(calls[0].url.pathname), "/api/capsules/资料包/details");
  assert.equal(calls[0].url.searchParams.get("from"), "2");
  assert.equal(calls[0].url.searchParams.get("limit"), "1");
  assert.equal(calls[0].url.searchParams.has("entry"), false);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].body, undefined);
});

test("CLI简述和详述携原token同一次PUT保存，并区分省略与清空简述", async (t) => {
  const body = "\ufeff完整详述\r\n第二段\n";
  const file = await textFile(t, body);
  const saved = { name: "原件.docx", token: "next-version", commit: "next-commit", eventId: "details-write" };
  const { api, calls } = apiFixture(() => Response.json(saved));
  const args = ["write-details", saved.name, "--file", file, "--token", "original-version"];
  assert.deepEqual(await dispatch(parseArguments([...args, "--description", ""]), api), saved);
  assert.equal(calls[0].method, "PUT");
  assert.equal(decodeURIComponent(calls[0].url.pathname), "/api/capsules/原件.docx/details");
  assert.deepEqual(calls[0].body, { token: "original-version", body, description: "" });
  await dispatch(parseArguments(args), api);
  assert.deepEqual(calls[1].body, { token: "original-version", body });
  assert.equal(calls.length, 2);
});

test("CLI详述写入要求明确文件和token，拒绝超限与非UTF8输入", async (t) => {
  assert.throws(() => parseArguments(["write-details", "资料包", "--file", "input.txt"]), /--token/u);
  assert.throws(() => parseArguments(["write-details", "资料包", "--token", "version"]), /--file/u);
  assert.throws(() => parseArguments(["details", "资料包", "--from", "0"]), /有效整数/u);
  const invalid = await textFile(t, Buffer.from([0xff, 0xfe, 0x80]));
  const tooLarge = await textFile(t, Buffer.alloc(1024 * 1024 + 1, 97));
  const { api, calls } = apiFixture(() => { throw new Error("无效文本不应发送"); });
  await assert.rejects(dispatch(parseArguments(["write-details", "资料包", "--file", invalid, "--token", "version"]), api), /UTF-8/u);
  await assert.rejects(dispatch(parseArguments(["write-details", "资料包", "--file", tooLarge, "--token", "version"]), api), /1MiB/u);
  assert.equal(calls.length, 0);
});

test("BFF详述读写通过同一接口，简述和正文不拆成两个请求", async () => {
  const details = { name: "图片.png", kind: "image", body: "媒体说明", token: "original-version", source: { type: "metadata" } };
  const { api, calls } = apiFixture((call) => Response.json(call.method === "GET" ? details : { name: details.name, token: "saved-version", eventId: "details-write" }));
  assert.deepEqual(await performAction(api, { action: "details", name: details.name, from: 3, limit: 20 }), details);
  await performAction(api, { action: "save-details", name: details.name, body: "新详述", description: "新简述", token: details.token });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url.searchParams.get("from"), "3");
  assert.equal(calls[0].url.searchParams.get("limit"), "20");
  assert.equal(calls[1].method, "PUT");
  assert.deepEqual(calls[1].body, { body: "新详述", description: "新简述", token: "original-version" });
  assert.equal(calls[0].url.pathname, calls[1].url.pathname);
});

test("BFF详述不能覆盖来源选择或省略版本，冲突保留回执且不重放", async () => {
  const { api, calls } = apiFixture(() => Response.json({ error: "版本冲突", code: "CONFLICT", eventId: "details-conflict" }, { status: 409 }));
  for (const input of [
    { action: "details", name: "资料包", entry: "another.txt" },
    { action: "save-details", name: "资料包", body: "正文" },
    { action: "save-details", name: "资料包", body: "正文", token: "version", details: "重复正文" },
    { action: "details", name: "../资料包" },
  ]) await assert.rejects(performAction(api, input), (error) => error.status === 400);
  assert.equal(calls.length, 0);
  await assert.rejects(performAction(api, { action: "save-details", name: "资料包", body: "尚未保存", token: "old-version" }),
    (error) => error.status === 409 && error.eventId === "details-conflict");
  assert.deepEqual(calls[0].body, { body: "尚未保存", token: "old-version" });
  assert.equal(calls.length, 1);
});
