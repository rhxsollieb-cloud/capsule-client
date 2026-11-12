import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { createUiApplication } from "../src/ui/application.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("工作台与CLI共用版本保护、回撤队列及原件接口", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { directory, application, clientHome, cli } = await serverFixture(t);
  const ui = await createUiApplication({
    port: 0,
    config: {
      serverUrl: application.url,
      token: "integration-only-token",
      home: clientHome,
    },
  });
  t.after(() => ui.close());
  await ui.start();
  const response = await fetch(`${ui.url}/`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Capsule/);
  const session = await (await fetch(`${ui.url}/ui/session`)).json();
  assert.equal(session.serverUrl, application.url);
  assert.ok(session.csrfToken);
  assert.equal(JSON.stringify(session).includes("integration-only-token"), false);
  const headers = {
    Origin: ui.url,
    "Content-Type": "application/json",
    "X-Capsule-Session": session.csrfToken,
  };
  const action = async (name, fields = {}, expected = 200) => {
    const result = await fetch(`${ui.url}/ui/action`, {
      method: "POST",
      headers,
      body: JSON.stringify({ action: name, ...fields }),
    });
    const payload = await result.json();
    assert.equal(result.status, expected, JSON.stringify(payload));
    return payload;
  };

  assert.equal((await action("health")).apiVersion, 3);
  const created = await action("create", {
    name: "交互.txt", kind: "text", body: "原始正文", description: "界面与Agent共用",
  });
  await action("mount", { name: created.name, path: "/交互.txt" });
  const draft = await action("read", { name: created.name });
  assert.equal(draft.body, "原始正文");
  const source = join(directory, "cli.txt");
  await writeFile(source, "CLI最新正文");
  const changed = await cli("put", created.name, source, "--token", draft.token);
  await action("save", {
    name: created.name, body: "旧草稿", token: draft.token,
  }, 409);
  assert.equal((await action("read", { name: created.name })).body, "CLI最新正文");

  const pending = await action("revert", {
    name: created.name, commit: created.commit, token: changed.token,
  });
  let event = pending;
  const deadline = Date.now() + 10000;
  while (["pending", "running"].includes(event.status) && Date.now() < deadline) {
    await setTimeout(20);
    event = await action("event", { id: pending.id });
  }
  assert.equal(event.status, "succeeded", JSON.stringify(event));
  assert.equal((await action("read", { name: created.name })).body, "原始正文");

  const image = await action("create", { name: "原件.png", kind: "image" });
  const bytes = Buffer.from([0, 255, 128, 23, 10]);
  const upload = await fetch(`${ui.url}/ui/upload?name=${encodeURIComponent(image.name)}`, {
    method: "PUT",
    headers: {
      Origin: ui.url,
      "X-Capsule-Session": session.csrfToken,
      "If-Match": image.token,
    },
    body: bytes,
  });
  assert.equal(upload.status, 200, await upload.text());
  const ranged = await fetch(`${ui.url}/ui/content?name=${encodeURIComponent(image.name)}`, {
    headers: { Range: "bytes=1-3" },
  });
  assert.equal(ranged.status, 206);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), bytes.subarray(1, 4));
  assert.equal(ranged.headers.get("content-range"), "bytes 1-3/5");
  const rejected = await fetch(`${ui.url}/ui/action`, {
    method: "POST",
    headers: { Origin: "https://example.invalid", "Content-Type": "application/json" },
    body: JSON.stringify({ action: "create", name: "拒绝.txt" }),
  });
  assert.equal(rejected.status, 403);
});
