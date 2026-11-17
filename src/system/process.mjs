import { spawn } from "node:child_process";

export function execute(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      signal: options.signal,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    const collect = (chunks, chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > (options.maxOutput || 8 * 1024 * 1024)) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on("data", (chunk) => collect(stdout, chunk));
    child.stderr.on("data", (chunk) => collect(stderr, chunk));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        exitCode: code ?? 1,
        signal,
      };
      if (outputBytes > (options.maxOutput || 8 * 1024 * 1024))
        return reject(new Error("命令输出超过限制，进程已停止"));
      if (result.exitCode && options.check !== false) {
        reject(
          Object.assign(new Error(
            `${command} 执行失败（${result.exitCode}）：${result.stderr.trim()}`,
          ), { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, signal: result.signal }),
        );
        return;
      }
      resolve(result);
    });
  });
}

export async function git(args, cwd) {
  // Only this process may mutate a managed repository while its capsule/cache lock is held.
  // Detached auto-maintenance would outlive fetch and race the following full integrity check.
  const result = await execute("git", [
    "-c", "maintenance.auto=false", "-c", "maintenance.autoDetach=false",
    "-c", "gc.auto=0", "-c", "gc.autoDetach=false", ...args,
  ], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout.trim();
}
