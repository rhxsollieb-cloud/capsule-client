import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { withCacheLock } from "../src/cache/lock.mjs";

test("缓存锁让同胶囊并发等待，完成后释放本次锁并复用", async (t) => {
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
  const owner = JSON.parse(await readFile(file, "utf8"));
  assert.equal(owner.pid, process.pid);
  assert.equal((await lstat(file)).nlink, 2);
  let secondEntered = false;
  const second = withCacheLock(file, async () => { secondEntered = true; return "second"; });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(secondEntered, false);
  release();
  assert.equal(await first, "first");
  assert.equal(await second, "second");
  assert.equal(await withCacheLock(file, async () => "third"), "third");
  assert.deepEqual(await readdir(directory), []);
});

test("缓存锁等待有界，EPERM视为占用且不回收活锁", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-busy-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cache.lock");
  const owner = JSON.stringify({ pid: process.pid, token: "other" });
  await writeFile(file, owner);
  t.mock.method(process, "kill", () => { throw Object.assign(new Error("not permitted"), { code: "EPERM" }); });
  await assert.rejects(withCacheLock(file, async () => assert.fail("占用锁不能进入"), { timeoutMs: 10, pollMs: 2 }),
    (error) => error.code === "CACHE_BUSY" && error.status === 409);
  assert.equal(await readFile(file, "utf8"), owner);
  assert.deepEqual(await readdir(directory), ["cache.lock"]);
});

test("空锁、非法owner、大锁与符号链接不被误删或当作活PID", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-invalid-lock-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cache.lock");
  let probes = 0;
  t.mock.method(process, "kill", () => { probes++; });
  for (const body of ["", "null", "{}", '{"pid":0,"token":"x"}', '{"pid":-1,"token":"x"}', '{"pid":9007199254740991,"token":"x"}', "x".repeat(5000)]) {
    await writeFile(file, body);
    await assert.rejects(withCacheLock(file, async () => assert.fail("无效锁不能进入")), (error) => error.code === "CACHE_LOCK_INVALID");
    assert.equal(await readFile(file, "utf8"), body);
  }
  await rm(file);
  const outside = join(directory, "other");
  await writeFile(outside, "keep");
  await symlink(outside, file);
  await assert.rejects(withCacheLock(file, async () => assert.fail("链接锁不能进入")), (error) => error.code === "CACHE_LOCK_INVALID");
  assert.equal(await readFile(outside, "utf8"), "keep");
  assert.equal((await lstat(file)).isSymbolicLink(), true);
  assert.equal(probes, 0);
});

test("主错误与释放错误同时保留，不用清理失败覆盖原始诊断", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-two-errors-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, "cache.lock");
  const primary = Object.assign(new Error("download failed"), { code: "DOWNLOAD_TEST", status: 503, eventId: "diagnostic-event" });
  const replacement = JSON.stringify({ pid: process.pid, token: "replacement" });
  await assert.rejects(withCacheLock(file, async () => {
    await writeFile(file, replacement);
    throw primary;
  }), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.equal(error.errors[0], primary);
    assert.equal(error.cause, primary);
    assert.equal(error.errors[1].code, "CACHE_LOCK_CHANGED");
    assert.equal(error.code, "DOWNLOAD_TEST");
    assert.equal(error.status, 503);
    assert.equal(error.eventId, "diagnostic-event");
    return true;
  });
  assert.equal(await readFile(file, "utf8"), replacement);
  assert.deepEqual(await readdir(directory), ["cache.lock"]);
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
