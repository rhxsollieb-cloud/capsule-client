import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { configuration } from "../src/config.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { openOfficeSession, sessionPath } from "../src/office/sessions.mjs";
import { createUiApplication } from "../src/ui/application.mjs";

test("Office会话由共享客户端校验token、ID及固定编辑器来源", async () => {
  assert.throws(() => parseArguments(["office-open", "原件.docx"]), /token/);
  assert.deepEqual(parseArguments(["office-open", "原件.docx", "--token", "old"]).positional, ["原件.docx"]);
  assert.throws(() => sessionPath("../wrong"), /ID/);
  assert.throws(() => configuration({ CAPSULE_ONLYOFFICE_URL: "https://user:secret@docs.example" }), /凭据/);
  assert.throws(() => configuration({ CAPSULE_ONLYOFFICE_URL: "https://docs.example/api.js" }), /根地址/);
  const calls = [];
  const api = { config: { officeEditorUrl: "https://docs.example" }, json: async (...args) => {
    calls.push(args);
    return { editorUrl: "https://other.example", config: {} };
  } };
  await assert.rejects(openOfficeSession(api, { name: "原件.docx", token: "old" }), { status: 409 });
  assert.deepEqual(calls[0], ["/api/office/sessions", "POST", { name: "原件.docx", entry: undefined, token: "old" }]);
});

test("Office桥接固定源CSP、会话校验与恢复下载沿用已有读取保护", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-office-ui-"));
  const webRoot = join(directory, "web");
  await mkdir(webRoot);
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Office</title>");
  const id = "00000000-0000-0000-0000-000000000001";
  const calls = [];
  const config = { home: directory, serverUrl: "http://backend.invalid", token: "private-backend-auth", officeEditorUrl: "https://docs.example" };
  const api = new ApiClient(config, async (url, init) => {
    calls.push({ url, init });
    assert.equal(init.headers.get("Authorization"), "Bearer private-backend-auth");
    if (url.endsWith("/recovery")) return new Response("saved-office-bytes", { headers: { "Content-Disposition": 'attachment; filename="recovery.docx"' } });
    if (url.endsWith("/api/office/status")) return Response.json({ configured: true, available: true, editorUrl: "https://docs.example" });
    if (url.endsWith("/api/office/sessions")) return Response.json({ id, editorUrl: "https://docs.example", config: { token: "editor-config-ticket" }, status: "open", saveVersion: 0 });
    if (url.endsWith("/save")) return Response.json({ id, status: "saving", saveVersion: 0 });
    return Response.json({ id, status: "saved", saveVersion: 1 });
  });
  const ui = createUiApplication({ config, api, webRoot, port: 0 });
  await ui.start();
  t.after(async () => { await ui.close(); await rm(directory, { recursive: true, force: true }); });
  const page = await fetch(ui.url);
  const csp = page.headers.get("Content-Security-Policy");
  assert.match(csp, /script-src 'self' https:\/\/docs.example;/);
  assert.deepEqual(csp.match(/frame-src ([^;]+);/)[1].split(" "), ["https://docs.example", "http://127.0.0.1:*", "http://localhost:*"]);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(csp.replace(/frame-src [^;]+;/, ""), /\*/);
  const session = await (await fetch(ui.url + "/ui/session")).json();
  const action = async (body, headers = {}) => fetch(ui.url + "/ui/action", { method: "POST", headers: { "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken, ...headers }, body: JSON.stringify(body) });
  assert.equal((await action({ action: "office-open", name: "原件.docx", token: "old" }, { "X-Capsule-Session": "wrong" })).status, 403);
  const opened = await action({ action: "office-open", name: "原件.docx", token: "old" });
  assert.equal(opened.status, 200);
  const result = await opened.json();
  assert.equal(result.id, id);
  assert.equal(JSON.stringify(result).includes(config.token), false);
  assert.equal((await action({ action: "office-save", id })).status, 200);
  assert.equal((await action({ action: "office-session", id })).status, 200);
  const restored = await fetch(ui.url + "/ui/office/recovery?" + new URLSearchParams({ id }));
  assert.equal(await restored.text(), "saved-office-bytes");
  assert.match(restored.headers.get("Content-Disposition"), /^attachment/);
  const before = calls.length;
  assert.equal((await fetch(ui.url + "/ui/office/recovery?" + new URLSearchParams({ id }), { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal(calls.length, before);
});
