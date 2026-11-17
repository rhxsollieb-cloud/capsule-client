import { assertNodeVersion } from "../config.mjs";
import { createUiApplication } from "./application.mjs";
import { Authentication } from "../operations/auth.mjs";

assertNodeVersion();
const authentication = new Authentication({ human: true });
const application = createUiApplication({
  config: authentication.config,
  authentication,
  port: Number(process.env.CAPSULE_UI_PORT ?? 5183),
  ...(process.env.CAPSULE_UI_UPLOAD_BYTES === undefined ? {} : {
    maxUploadBytes: Number(process.env.CAPSULE_UI_UPLOAD_BYTES),
  }),
});
await application.start();
process.stdout.write(`Capsule client ${application.url}\n`);
let closing;
function close() {
  closing ??= (async () => {
    try {
      await application.close();
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  })();
  return closing;
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", ...(process.platform === "win32" ? ["SIGBREAK"] : [])])
  process.on(signal, close);
