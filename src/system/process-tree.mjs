import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";

const executeFile = promisify(execFile);

export async function signalProcessTree(child, value) {
  if (!Number.isSafeInteger(child?.pid) || child.pid <= 0) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, value); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    return;
  }
  // An exited entry's PID may already belong to another program. Never reuse it.
  if (child.exitCode !== null || child.signalCode !== null) return;
  const command = join(process.env.SystemRoot || process.env.WINDIR || "C:\\Windows", "System32", "taskkill.exe");
  try {
    await executeFile(command, ["/PID", String(child.pid), "/T", "/F"], {
      shell: false, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024,
    });
  } catch (error) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    throw Object.assign(new Error(`Skill 进程树未能停止：${error.stderr?.trim() || error.message}`), {
      code: "SKILL_PROCESS_STOP_FAILED", cause: error,
    });
  }
}
