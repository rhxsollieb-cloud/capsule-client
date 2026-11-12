import { configuration, assertNodeVersion } from "../config.mjs";
import { createUiApplication } from "./application.mjs";

assertNodeVersion();
const application = createUiApplication({
  config: configuration(),
  port: Number(process.env.CAPSULE_UI_PORT ?? 5183),
  ...(process.env.CAPSULE_UI_UPLOAD_BYTES === undefined ? {} : {
    maxUploadBytes: Number(process.env.CAPSULE_UI_UPLOAD_BYTES),
  }),
});
await application.start();
process.stdout.write(`Capsule client ${application.url}\n`);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    try {
      await application.close();
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  });
