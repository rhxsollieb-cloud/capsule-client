import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const clientRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const serverRoot = process.env.CAPSULE_SERVER_ROOT
  ? resolve(process.env.CAPSULE_SERVER_ROOT)
  : resolve(clientRoot, "../capsule-server");
const applicationPath = join(serverRoot, "src/application.mjs");

export const missingServer = existsSync(applicationPath)
  ? false
  : "缺少服务端源码，请设置 CAPSULE_SERVER_ROOT 执行跨项目集成检查";

export async function serverFixture(t, { token = "integration-only-token", office } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "capsule-contract-v3-"));
  const clientHome = join(directory, "client");
  const { createApplication } = await import(pathToFileURL(applicationPath).href);
  const application = createApplication({
    home: join(directory, "server"),
    host: "127.0.0.1",
    port: 0,
    token,
    ...(office ? { office } : {}),
  });
  t.after(async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });
  await application.start();
  const environment = {
    ...process.env,
    CAPSULE_SERVER_URL: application.url,
    CAPSULE_TOKEN: token,
    CAPSULE_CLIENT_HOME: clientHome,
    ...(office ? { CAPSULE_ONLYOFFICE_URL: office.url } : {}),
  };
  const cli = async (...args) => {
    const result = await execute(process.execPath, [join(clientRoot, "src/cli.mjs"), ...args], {
      env: environment,
      timeout: 90000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return JSON.parse(result.stdout);
  };
  return { directory, clientHome, application, cli };
}
