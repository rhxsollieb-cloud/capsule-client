import { link, lstat, mkdir, open, rm, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

const lockError = (message, code) => Object.assign(new Error(message), { status: 409, code });

async function ownerAt(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
    throw lockError(`缓存锁结构无效，请核对同步任务后处理：${file}`, "CACHE_LOCK_INVALID");
  const handle = await open(file, "r");
  try {
    const bytes = Buffer.alloc(4097);
    const { bytesRead } = await handle.read(bytes);
    let owner;
    try { owner = bytesRead <= 4096 ? JSON.parse(bytes.subarray(0, bytesRead).toString("utf8")) : null; }
    catch { /* An old or interrupted lock is preserved for explicit inspection. */ }
    if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid <= 0 || owner.pid > 2147483647 || typeof owner.token !== "string" || !owner.token)
      throw lockError(`缓存锁状态不完整，请核对运行中的客户端后处理：${file}`, "CACHE_LOCK_INVALID");
    return { ...owner, info: await handle.stat() };
  } finally { await handle.close(); }
}

function alive(owner, file) {
  try { process.kill(owner.pid, 0); }
  catch (error) {
    if (error.code === "EPERM") return;
    if (error.code !== "ESRCH") throw error;
    // A dead PID does not prove that its orphan Git process has stopped writing.
    throw lockError(`缓存锁所属进程已退出，请先核对残留同步/Git任务后移除锁：${file}`, "CACHE_LOCK_STALE");
  }
}

async function release(file, identity, info) {
  let current;
  try { current = await ownerAt(file); }
  catch (cause) { throw Object.assign(lockError(`缓存锁身份无法核对，已保留现场：${file}`, "CACHE_LOCK_CHANGED"), { cause }); }
  if (current.token !== identity.token || current.pid !== identity.pid || current.info.dev !== info.dev || current.info.ino !== info.ino)
    throw lockError(`缓存锁身份已变化，请核对同步状态：${file}`, "CACHE_LOCK_CHANGED");
  await unlink(file);
}

export async function withCacheLock(file, operation, { timeoutMs = 30000, pollMs = 50, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || !Number.isFinite(pollMs) || pollMs <= 0)
    throw new Error("缓存锁等待范围无效");
  signal?.throwIfAborted();
  await mkdir(dirname(file), { recursive: true });
  const identity = { pid: process.pid, token: randomUUID() };
  const claim = file + "." + identity.token + ".claim";
  const handle = await open(claim, "wx");
  let info, acquired = false, result, primaryError;
  try {
    try { await handle.writeFile(JSON.stringify(identity)); await handle.sync(); info = await handle.stat(); }
    finally { await handle.close(); }
    const deadline = performance.now() + timeoutMs;
    let attempted = false;
    while (!acquired) {
      signal?.throwIfAborted();
      if (attempted && performance.now() >= deadline)
        throw lockError(`这个胶囊正在同步或读取缓存，等待超时，请稍后查询重试：${file}`, "CACHE_BUSY");
      attempted = true;
      try { await link(claim, file); acquired = true; }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        let owner;
        try { owner = await ownerAt(file); }
        catch (failure) { if (failure.code === "ENOENT") continue; throw failure; }
        alive(owner, file);
        const remaining = deadline - performance.now();
        if (remaining <= 0) throw lockError(`这个胶囊正在同步或读取缓存，等待超时，请稍后查询重试：${file}`, "CACHE_BUSY");
        await delay(Math.min(pollMs, remaining), undefined, { signal });
      }
    }
    signal?.throwIfAborted();
    result = await operation();
  } catch (error) { primaryError = error; }
  let releaseError;
  if (acquired) try { await release(file, identity, info); } catch (error) { releaseError = error; }
  try { await rm(claim, { force: true }); }
  catch (error) { releaseError = releaseError ? new AggregateError([releaseError, error], "缓存锁及claim清理失败") : error; }
  if (primaryError && releaseError) throw Object.assign(new AggregateError([primaryError, releaseError],
    `缓存操作失败且释放锁失败：${primaryError.message}；${releaseError.message}`, { cause: primaryError }), {
    code: primaryError.code || "CACHE_LOCK_RELEASE_FAILED", status: primaryError.status || 409,
    ...(primaryError.eventId ? { eventId: primaryError.eventId } : {}),
  });
  if (primaryError || releaseError) throw primaryError || releaseError;
  return result;
}
