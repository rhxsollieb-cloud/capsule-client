import { test as base, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ApiClient } from "../../src/api/client.mjs";
import { seedFrontend } from "./seed.mjs";
import { officeTestSecret, startOfficeServer } from "./office-server.mjs";
import { createWorkbench } from "./workbench.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const serverRoot = resolve(process.env.CAPSULE_SERVER_ROOT || join(root, "..", "capsule-server"));

export const test = base.extend({
  backend: [async ({}, use) => {
    const applicationPath = join(serverRoot, "src", "application.mjs");
    if (!existsSync(applicationPath)) throw new Error("前端端到端测试需要 capsule-server 源码；请放在客户端同级或设置 CAPSULE_SERVER_ROOT，不会跳过此检查");
    const directory = await mkdtemp(join(tmpdir(), "Capsule 前端 E2E-"));
    const office = await startOfficeServer();
    let application;
    try {
      const { createApplication } = await import(pathToFileURL(applicationPath).href);
      const token = randomBytes(32).toString("base64url");
      application = createApplication({ home: join(directory, "server"), host: "127.0.0.1", port: 0, token,
        office: { url: office.url, jwtSecret: officeTestSecret } });
      await application.start();
      const api = new ApiClient({ serverUrl: application.url, token, home: join(directory, "seed-client"), officeEditorUrl: office.url });
      const accounts = await seedFrontend(api, directory);
      await use({ serverUrl: application.url, api, office, accounts });
    } finally {
      try { await application?.close(); }
      finally { await office.close(); await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
    }
  }, { scope: "worker" }],
  app: async ({ backend }, use) => {
    await backend.office.reset();
    backend.office.failScript = false; backend.office.scriptDelayMs = 0; backend.office.requests.length = 0;
    const clients = [];
    const createPeer = async () => {
      const client = await createWorkbench(backend);
      clients.push(client);
      return client;
    };
    try {
      await use({ ...await createPeer(), createPeer });
    } finally {
      const results = await Promise.allSettled(clients.reverse().map((client) => client.close()));
      const failed = results.filter((result) => result.status === "rejected");
      if (failed.length) throw new AggregateError(failed.map((result) => result.reason), "测试工作台清理失败");
    }
  },
});

export { expect };
