import assert from "node:assert/strict";
import test from "node:test";
import { contentUrl, initialize, readText, rebindSessionUrls } from "../web/api.mjs";
import { restoreConnectionContent, singleConnection } from "../web/connection-recovery.mjs";
import { Workspace } from "../web/workspace.mjs";

test("多个会话失效共用一次重连，完成或失败后允许新的重连", async () => {
  let calls = 0, complete;
  const reconnect = singleConnection(() => {
    calls++;
    return new Promise((resolve, reject) => { complete = { resolve, reject }; });
  });
  const first = reconnect(), second = reconnect();
  assert.equal(first, second);
  await Promise.resolve();
  assert.equal(calls, 1);
  complete.resolve("connected");
  assert.deepEqual(await Promise.all([first, second]), ["connected", "connected"]);
  const failing = reconnect();
  await Promise.resolve();
  assert.equal(calls, 2);
  complete.reject(new Error("offline"));
  await assert.rejects(failing, /offline/);
  const next = reconnect();
  await Promise.resolve();
  assert.equal(calls, 3);
  complete.resolve("recovered");
  assert.equal(await next, "recovered");
});

test("左侧选择遇旧本机会话后，重连恢复原文件并读取正文，不重放写入", async (t) => {
  const previous = globalThis.document;
  const element = () => ({ querySelectorAll: () => [], replaceChildren() {}, append() {} });
  globalThis.document = { createElement: element };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  const cap = { name: "恢复的文件.txt", kind: "text", token: "version-token", commit: "same-commit" };
  const item = { ...cap, path: "/恢复的文件.txt" };
  const calls = [], errors = [];
  let expected = "original-session", session = expected;
  t.mock.method(globalThis, "fetch", async (url, init) => {
    if (url === "/ui/session") return Response.json({ csrfToken: session });
    const input = JSON.parse(init.body); calls.push(input.action);
    if (init.headers["X-Capsule-Session"] !== expected)
      return Response.json({ error: "本地会话已失效，请刷新界面" }, { status: 403 });
    if (input.action === "stat") return Response.json(cap);
    if (input.action === "read") return Response.json({ ...cap, body: "正文已经恢复", lines: { from: 1, to: 1, total: 1, nextLine: null, truncated: false } });
    assert.fail("恢复不能执行业务写入：" + input.action);
  });
  await initialize();
  expected = session = "replacement-session";
  let rendered;
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    selection: 0, viewRequest: 0, databaseDrafts: new Map(),
    editor: { drafts: new Map(), close() {} },
    content: element(), header: { update() {} }, activity: { clear() {} },
    navigation: { hide() {}, show() {} }, inspector: { show() {}, context() {} },
    chrome() {}, onError: (error) => errors.push(error),
    async load() {
      const record = await readText(this.cap.name, undefined, () => true);
      rendered = record.body; this.displayedCommit = record.commit;
    },
  });
  await workspace.select(item);
  assert.equal(errors[0].status, 403);
  assert.equal(workspace.cap, null);
  assert.equal(workspace.item, item);
  const connection = await initialize();
  assert.equal(connection.sessionChanged, true);
  assert.equal(await restoreConnectionContent({ workspace, tree: { selected: item }, sessionChanged: connection.sessionChanged }), true);
  assert.equal(workspace.cap.name, cap.name);
  assert.equal(rendered, "正文已经恢复");
  assert.deepEqual(calls, ["stat", "stat", "read"]);
});

test("重连只刷新同源本机媒体和下载的会话地址，正文表格和脏Office保持原实例", async (t) => {
  let session = "old-media-session";
  t.mock.method(globalThis, "fetch", async () => Response.json({ csrfToken: session }));
  await initialize();
  function element(attributes) {
    return { attributes: { ...attributes }, getAttribute(name) { return this.attributes[name] ?? null; },
      setAttribute(name, value) { this.attributes[name] = value; } };
  }
  const image = element({ src: contentUrl("照片.jpg") });
  const attachment = element({ href: "/ui/content?name=手册.md&entry=assets%2Fdata.csv&download=1&session=old" });
  const recovery = element({ href: "/ui/office/recovery?id=office&session=old" });
  const backup = element({ href: "http://127.0.0.1:5185/ui/admin/backup-content?id=backup&session=old" });
  const officeFrame = element({ src: "https://docs.example/editor?session=old" });
  const skillFrame = element({ src: "http://127.0.0.1:5900/ui/content?session=old" });
  const page = { querySelectorAll: () => [image, attachment, recovery, backup, officeFrame, skillFrame] };
  session = "new-media-session";
  assert.equal((await initialize()).sessionChanged, true);
  const textDraft = { body: "未提交正文", dirty: true }, tableDraft = { dirty: true };
  const office = { hasDirty: () => true, destroy() { assert.fail("不能销毁脏Office"); } };
  const editor = { current: { input: { value: textDraft.body } }, drafts: new Map([["draft", textDraft]]) };
  const workspace = { cap: { name: "Office.docx" }, office, editor, databaseDrafts: new Map([["table", tableDraft]]),
    async refresh() {}, chrome() {}, select() { assert.fail("已有内容不能被重选覆盖"); } };
  let officeNotice;
  await restoreConnectionContent({ workspace, tree: {}, sessionChanged: true,
    rebind: () => assert.equal(rebindSessionUrls(page, "http://127.0.0.1:5185/"), 4),
    onOfficeSessionChanged: (value) => { officeNotice = value; },
  });
  for (const value of [image.attributes.src, attachment.attributes.href, recovery.attributes.href, backup.attributes.href])
    assert.equal(new URL(value, "http://127.0.0.1:5185").searchParams.get("session"), session);
  assert.equal(officeFrame.attributes.src, "https://docs.example/editor?session=old");
  assert.equal(skillFrame.attributes.src, "http://127.0.0.1:5900/ui/content?session=old");
  assert.equal(workspace.editor, editor); assert.equal(workspace.editor.drafts.get("draft"), textDraft);
  assert.equal(workspace.databaseDrafts.get("table"), tableDraft);
  assert.equal(workspace.office, office); assert.equal(officeNotice, office);
  assert.equal(rebindSessionUrls(page, "http://127.0.0.1:5185/"), 0);
});

test("恢复失败仍保留当前选择的错误页面，不回退成未选择的概览", async () => {
  const item = { name: "暂时不可用.txt" };
  const workspace = { cap: null, item, async select(value) { assert.equal(value, item); }, refresh() { assert.fail("失败选择不能额外重复请求"); } };
  assert.equal(await restoreConnectionContent({ workspace, tree: { selected: item } }), true);
  assert.equal(await restoreConnectionContent({ workspace: { cap: null }, tree: { selected: null } }), false);
});
