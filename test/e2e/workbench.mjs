import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Authentication } from "../../src/operations/auth.mjs";
import { createUiApplication } from "../../src/ui/application.mjs";

// Each workstation has its own identity store and local bridge, as two coworkers
// would. Only their isolated test knowledge server is shared.
export async function createWorkbench(backend) {
  const directory = await mkdtemp(join(tmpdir(), "Capsule 工作台 E2E-"));
  const home = join(directory, "client"), configHome = join(directory, "connection");
  let ui;
  try {
    await mkdir(home, { recursive: true });
    const env = { CAPSULE_SERVER_URL: backend.serverUrl, CAPSULE_ONLYOFFICE_URL: backend.office.url,
      CAPSULE_CONFIG_HOME: configHome, CAPSULE_CLIENT_HOME: home };
    const authentication = new Authentication({ env, human: true });
    ui = createUiApplication({ config: authentication.config, authentication, port: 0 });
    await ui.start();
    authentication.config.clientUrl = ui.url;
    authentication.env.CAPSULE_CLIENT_URL = ui.url;
    return {
      url: ui.url, serverUrl: backend.serverUrl, officeUrl: backend.office.url,
      admin: backend.accounts.admin, editor: backend.accounts.editor, api: backend.api,
      configHome, home, office: backend.office,
      async close() {
        try { await ui.close(); }
        finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
      },
    };
  } catch (error) {
    try { await ui?.close(); }
    finally { await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    throw error;
  }
}
