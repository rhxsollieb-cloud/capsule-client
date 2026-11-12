import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withCacheLock } from "../src/cache/lock.mjs";

test("缓存锁阻止同胶囊并发写，完成后释放本次锁", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cache.lock");
  let release;
  let signalEntered;
  const entered = new Promise((resolve) => {
    signalEntered = resolve;
  });
  const first = withCacheLock(file, async () => {
    signalEntered();
    await new Promise((resolve) => {
      release = resolve;
    });
    return "first";
  });
  await entered;
  await assert.rejects(withCacheLock(file, async () => "second"), /正在同步/u);
  release();
  assert.equal(await first, "first");
  assert.equal(await withCacheLock(file, async () => "third"), "third");
});

test("死进程锁保留原文件并给出可核对的位置", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-dead-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await once(child, "exit");
  const file = join(directory, "cache.lock");
  const owner = JSON.stringify({ pid: child.pid, token: "old-owner" });
  await writeFile(file, owner);
  await assert.rejects(
    withCacheLock(file, async () => "unreachable"),
    (error) => {
      assert.match(error.message, /进程已退出/u);
      assert.ok(error.message.includes(file));
      return true;
    },
  );
  assert.equal(await readFile(file, "utf8"), owner);
});

test("释放前核对身份，保留被替换的锁", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-replaced-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cache.lock");
  const replacement = JSON.stringify({ pid: process.pid, token: "another-owner" });
  await assert.rejects(
    withCacheLock(file, async () => {
      await writeFile(file, replacement);
    }),
    /身份已变化/u,
  );
  assert.equal(await readFile(file, "utf8"), replacement);
});
