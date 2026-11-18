import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { TEXT_INPUT_LIMIT } from "../src/commands/input.mjs";
import { planImport } from "../src/import/batch-sources.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("批量导入预演不写入，按清单挂载Markdown、媒体、目录和SQLite", { skip: missingServer, timeout: 30000 }, async (t) => {
  const { directory, cli } = await serverFixture(t);
  const manifest = join(directory, "批量清单.json");
  const original = "\uFEFF# 原文\r\n\r\n正文没有末尾换行";
  await writeFile(join(directory, "正文.md"), original);
  const attachment = Buffer.from([0xff, 0x44, 0x00, 0x02]);
  await writeFile(join(directory, "图.png"), attachment);
  const largeText = "测试正文\r\n".repeat(90000);
  assert.ok(Buffer.byteLength(largeText) > TEXT_INPUT_LIMIT);
  await writeFile(join(directory, "大文本.txt"), largeText);
  await mkdir(join(directory, "资料"));
  await writeFile(join(directory, "资料", "说明.md"), "# 文件目录");
  const database = new DatabaseSync(join(directory, "业务.sqlite"));
  try { database.exec("CREATE TABLE items(value TEXT); INSERT INTO items VALUES ('记录');"); }
  finally { database.close(); }
  await writeFile(manifest, JSON.stringify([
    { file: "正文.md", name: "课程.md", path: "/课程.md" },
    { file: "正文.md", name: "原文.md", description: "简述", path: "/课程.md/原文.md" },
    { file: "图.png", name: "图.png", kind: "image", path: "/课程.md/图.png" },
    { directory: "资料", name: "资料", kind: "files", path: "/课程.md/资料" },
    { file: "业务.sqlite", name: "业务库", kind: "database", path: "/课程.md/业务库" },
    { file: "大文本.txt", name: "大文本.txt", kind: "text", path: "/课程.md/大文本.txt" },
  ]));
  const preview = await cli("import-batch", manifest, "--dry-run");
  assert.equal(preview.canApply, true);
  assert.equal((await cli("ls", "/")).total, 0);

  const applied = await cli("import-batch", manifest, "--verify");
  assert.ok(applied.items.every((item) => item.status === "mounted"));
  assert.deepEqual(applied.items.map((item) => item.verified || item.verification), [true, true, true, "archive", "sqlite-integrity", true]);
  assert.equal((await cli("ls", "/课程.md")).total, 5);
  const copy = join(directory, "核对.md");
  await cli("get", "原文.md", "README.md", copy);
  assert.deepEqual(await readFile(copy), Buffer.from(original));
  assert.equal((await cli("stat", "原文.md")).description, "简述");
  const imageCopy = join(directory, "拷贝.png");
  await cli("get", "图.png", imageCopy);
  assert.deepEqual(await readFile(imageCopy), attachment);
  assert.equal((await cli("details", "资料")).body, "# 文件目录");
  assert.equal((await cli("query", "业务库", "--sql", "SELECT value FROM items")).items[0].value, "记录");

  const repeated = await cli("import-batch", manifest, "--dry-run");
  assert.equal(repeated.canApply, false);
  assert.ok(repeated.items.every((item) => item.status === "blocked"));
  await writeFile(join(directory, "损坏.md"), Buffer.concat([Buffer.alloc(TEXT_INPUT_LIMIT, 0x61), Buffer.from([0xe7])]));
  await assert.rejects(planImport([{ name: "损坏.md", file: "损坏.md" }], directory), /有效UTF-8/);
});

test("导入中途同名冲突保留完整回执，之后的条目不提交", { skip: missingServer, timeout: 30000 }, async (t) => {
  const { directory, cli } = await serverFixture(t);
  const existing = await cli("create", "已有.md", "--kind", "markdown");
  const manifest = join(directory, "清单.json");
  const receipt = join(directory, "回执.json");
  await writeFile(join(directory, "正文.md"), "原测试正文");
  await writeFile(manifest, JSON.stringify(["新增.md", "已有.md", "未提交.md"].map((name) => ({ file: "正文.md", name }))));
  await assert.rejects(cli("import-batch", manifest, "--out", receipt, "--json-errors"),
    (error) => error.code === 1 && JSON.parse(error.stdout).output === receipt);
  const result = JSON.parse(await readFile(receipt, "utf8"));
  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.items.map(({ status }) => status), ["created", "failed", "skipped"]);
  assert.equal(result.items[1].error.status, 409);
  assert.equal((await cli("stat", "新增.md")).commit, result.items[0].commit);
  assert.equal((await cli("stat", "已有.md")).token, existing.token);
  await assert.rejects(cli("stat", "未提交.md", "--json-errors"), (error) => JSON.parse(error.stdout).error.status === 404);
});
