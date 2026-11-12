import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import test from "node:test";
import { Document, Packer, Paragraph } from "docx";
import { createUiApplication } from "../src/ui/application.mjs";
import { callbackJwt, officeEngineFixture, officeSecret } from "./officeEngineFixture.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

const documentBytes = (text) => Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph(text)] }] }));

test("ONLYOFFICE共享入口保存原件、保留key、版本冲突恢复与cap整体回撤", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const engine = await officeEngineFixture(t);
  const { application, directory, clientHome, cli } = await serverFixture(t, {
    office: { url: engine.url, jwtSecret: officeSecret },
  });
  const ui = createUiApplication({ port: 0, config: {
    serverUrl: application.url, token: "integration-only-token", home: clientHome, officeEditorUrl: engine.url,
  } });
  await ui.start();
  t.after(() => ui.close());
  const session = await (await fetch(ui.url + "/ui/session")).json();
  const action = async (action, fields = {}, expected = 200) => {
    const response = await fetch(ui.url + "/ui/action", {
      method: "POST",
      headers: { Origin: ui.url, "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken },
      body: JSON.stringify({ action, ...fields }),
    });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return result;
  };
  const callback = async (opened, file, requestId, status = 6) => {
    const payload = { key: opened.config.document.key, status, url: engine.url + file, filetype: "docx", forcesavetype: 0, ...(requestId ? { userdata: requestId } : {}) };
    const response = await fetch(opened.config.editorConfig.callbackUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + callbackJwt(payload) },
      body: JSON.stringify(payload),
    });
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.equal(receipt.error, 0, JSON.stringify(receipt));
    return receipt;
  };
  const original = await documentBytes("原始正文");
  const source = join(directory, "原始.docx");
  await writeFile(source, original);
  const created = await cli("create", "网页编辑.docx", "--kind", "word");
  const initial = await cli("put", created.name, source, "--token", created.token);
  const opened = await action("office-open", { name: created.name, token: initial.token });
  assert.equal(opened.editorUrl, engine.url);
  assert.ok(opened.config.token);
  assert.equal(JSON.stringify(opened).includes(officeSecret), false);
  const downloaded = await fetch(opened.config.document.url);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), original);
  const page = await fetch(ui.url);
  const csp = page.headers.get("Content-Security-Policy");
  assert.ok(csp.includes(engine.url));
  assert.equal(csp.includes("unsafe-inline"), false);

  const changed = await documentBytes("网页编辑后的完整正文");
  engine.files.set("/cache/files/edited/output.docx", changed);
  const request = await action("office-save", { id: opened.id });
  assert.ok(engine.commands.length > 0);
  await callback(opened, "/cache/files/edited/output.docx", request.requestId);
  const saved = await action("office-session", { id: opened.id });
  assert.equal(saved.status, "saved");
  assert.equal(saved.saveVersion, 1);
  assert.notEqual(saved.token, initial.token);
  assert.equal((await action("preview", { name: created.name })).blocks[0].text, "网页编辑后的完整正文");
  await callback(opened, "/cache/files/edited/output.docx", request.requestId);
  assert.equal((await action("office-session", { id: opened.id })).saveVersion, 1);
  const nextRequest = await action("office-save", { id: opened.id });
  assert.ok(engine.commands.every((command) => command.key === opened.config.document.key));

  await writeFile(source, await documentBytes("CLI最新正文"));
  const external = await cli("put", created.name, source, "--token", saved.token);
  const unsaved = await documentBytes("旧Office会话修改");
  engine.files.set("/cache/files/conflict/output.docx", unsaved);
  await callback(opened, "/cache/files/conflict/output.docx", nextRequest.requestId);
  const conflict = await action("office-session", { id: opened.id });
  assert.equal(conflict.status, "conflict");
  assert.equal(conflict.recoveryAvailable, true);
  assert.equal((await cli("stat", created.name)).commit, external.commit);
  const recovered = await fetch(ui.url + "/ui/office/recovery?" + new URLSearchParams({ id: opened.id }));
  assert.equal(recovered.status, 200);
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), unsaved);

  const reverted = await cli("revert", created.name, initial.commit, "--token", external.token);
  assert.equal(reverted.status, "succeeded");
  assert.equal((await action("preview", { name: created.name })).blocks[0].text, "原始正文");
  // Allow command promises and keep-alive work to settle before fixture teardown.
  await setTimeout(10);
});
