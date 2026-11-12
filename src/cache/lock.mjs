import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";

export async function withCacheLock(file, operation) {
  await mkdir(dirname(file), { recursive: true });
  const identity = { pid: process.pid, token: randomUUID() };
  let handle;
  try {
    handle = await open(file, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new Error("缓存锁状态不完整，请核对运行中的客户端后清理该锁");
    }
    try {
      process.kill(owner.pid, 0);
    } catch (failure) {
      if (failure.code !== "ESRCH") throw failure;
      throw new Error(
        `缓存锁所属进程已退出，请核对相关同步任务后移除锁：${file}`,
      );
    }
    throw new Error("这个胶囊正在同步，请稍后重试");
  }
  try {
    await handle.writeFile(JSON.stringify(identity));
    return await operation();
  } finally {
    await handle.close();
    const current = JSON.parse(await readFile(file, "utf8"));
    if (current.token !== identity.token)
      throw new Error(`缓存锁身份已变化，请核对同步状态：${file}`);
    await unlink(file);
  }
}
