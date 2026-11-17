import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { archiveDirectory } from "../src/import/archive.mjs";
import { importDirectory } from "../src/operations/import.mjs";
import { execute } from "../src/system/process.mjs";

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "capsule-import-client-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, "source");
  await mkdir(source);
  await writeFile(join(source, "README.md"), "# 原始正文\n");
  return { directory, source };
}

test("导入在传输前拒绝凭据和硬链接，不静默跳过本地内容", async (t) => {
  const { directory, source } = await fixture(t);
  let calls = 0;
  const api = new ApiClient({ home: join(directory, "client"), serverUrl: "http://test.invalid" }, async () => { calls++; assert.fail("不应发送导入"); });
  await writeFile(join(source, ".env"), "synthetic-test-configuration");
  await assert.rejects(importDirectory(api, { directory: source, name: "新cap", kind: "code" }), /凭据|运行/);
  await rm(join(source, ".env"));
  await mkdir(join(source, "assets"));
  await link(join(source, "README.md"), join(source, "assets", "linked.txt"));
  await assert.rejects(importDirectory(api, { directory: source, name: "新cap" }), /硬链接/);
  assert.equal(calls, 0);
});

test("归档期间新增空目录或凭据在二次清单核对中拒绝", async (t) => {
  const { directory, source } = await fixture(t);
  await mkdir(join(source, "assets"));
  for (const credential of [false, true]) {
    const added = join(source, credential ? ".env" : "assets/new-empty-directory");
    await assert.rejects(archiveDirectory(source, join(directory, "content.tar"), "markdown", {
      run: async (command, args, options) => {
        const result = await execute(command, args, options);
        if (args.includes("-cf")) {
          if (credential) await writeFile(added, "synthetic");
          else await mkdir(added);
        }
        return result;
      },
    }), credential ? /凭据|运行/ : /目录内容变化/);
    await rm(added, { recursive: true, force: true });
  }
});

test("导入网络结果未知不重放，保留目标提示并关流清理归档", async (t) => {
  const { directory, source } = await fixture(t);
  const home = join(directory, "client");
  let calls = 0;
  const api = new ApiClient({ home, serverUrl: "http://test.invalid" }, async () => { calls++; throw new Error("connection lost"); });
  await assert.rejects(importDirectory(api, { directory: source, name: "需核对的目标" }), (error) => {
    assert.equal(error.uncertain, true);
    assert.match(error.message, /需核对的目标.*勿自动重放导入/);
    return true;
  });
  assert.equal(calls, 1);
  assert.deepEqual(await readdir(join(home, "imports")), []);
});
