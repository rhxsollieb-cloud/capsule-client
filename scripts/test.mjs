import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "test");
const files = (await readdir(directory))
  .filter((name) => name.endsWith(".test.mjs"))
  .sort()
  .map((name) => join(directory, name));

if (!files.length) throw new Error("未找到客户端测试，不能视为检查成功");

const child = spawn(process.execPath, [
  "--test",
  "--test-reporter=" + new URL("../test/quiet-reporter.mjs", import.meta.url).href,
  ...process.argv.slice(2),
  ...files,
], { cwd: root, stdio: "inherit", windowsHide: true });

child.on("error", (error) => {
  console.error("无法启动客户端测试：" + error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  if (signal) console.error("客户端测试被信号终止：" + signal);
  process.exitCode = code ?? 1;
});
