import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { test, expect, login, selectCap } from "./helpers.mjs";
import { readProtocolDocument, writeProtocolDocument } from "./office-document.mjs";

const frame = (page) => page.frameLocator("#content .onlyoffice-stage iframe");
const editor = (page) => frame(page).getByLabel("Office 协议替身正文", { exact: true });

async function fileAction(page, name) {
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function createOfficeDocument(app, testInfo) {
  const name = `Office协议验证-${randomUUID()}.docx`;
  const created = await app.api.json("/api/capsules", "POST", { name, kind: "word" });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  const file = testInfo.outputPath("initial.docx");
  await writeFile(file, await writeProtocolDocument("docx", "Office 协议替身初始正文"));
  return app.api.upload(name, undefined, file, created.token);
}

async function openEditing(page, app, cap) {
  await login(page, app);
  await selectCap(page, cap.name);
  await expect(editor(page)).toHaveAttribute("readonly", "");
  await fileAction(page, "占用并编辑Office");
  await expect(editor(page)).toBeEditable();
  await page.locator("#content .onlyoffice-stage iframe").evaluate((element) => element.dataset.testIdentity = "preserved-edit-frame");
}

async function fillCollected(page, body) {
  await editor(page).fill(body);
  await expect(frame(page).locator("#input-status")).toHaveText("输入已收集");
  await expect(page.locator("#document-header .document-status")).toHaveAttribute("aria-label", "未保存");
}

async function currentBody(app, name) {
  const response = await app.api.response(app.api.path(name, "content"));
  return readProtocolDocument("docx", Buffer.from(await response.arrayBuffer()));
}

async function expectReleased(app, name) {
  await expect.poll(async () => (await app.api.json(app.api.path(name, "lease"))).leases.length, { timeout: 5000 }).toBe(0);
}

test.afterEach(async ({ app }) => {
  expect(app.office.callbackErrors, "Office 协议替身不应有服务或回调错误").toEqual([]);
});

test("Office 协议替身：编辑后等待签名回调才提交版本，并快速释放占用", async ({ page, app }, testInfo) => {
  const cap = await createOfficeDocument(app, testInfo);
  const body = "Office 协议替身保存后的正文\n实际 DOCX 原件通过统一接口提交。";
  await openEditing(page, app, cap);
  await fillCollected(page, body);
  app.office.holdSaves = true;
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(() => app.office.pendingSaves.length).toBe(1);
  await expect(page.locator("#document-header")).toContainText("保存中");
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
  await app.office.flushSave();
  await expect.poll(async () => (await app.api.json(app.api.path(cap.name))).commit).not.toBe(cap.commit);
  await expect(page.locator("#document-header .document-status")).toHaveClass(/state-clean/);
  await expect(page.locator("#document-header .document-status")).toBeHidden();
  await expect(page.locator("#document-header")).not.toContainText("保存中");
  expect(await currentBody(app, cap.name)).toBe(body);
  await expectReleased(app, cap.name);
  await expect(page.locator("#content .onlyoffice-stage iframe")).toHaveAttribute("data-test-identity", "preserved-edit-frame");
  expect(app.office.commands).toHaveLength(1);
  expect(app.office.commands[0].c).toBe("forcesave");
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
});

test("Office 协议替身：保存被拒绝时取消离开保留编辑器与未保存正文", async ({ page, app }, testInfo) => {
  const cap = await createOfficeDocument(app, testInfo);
  const body = "Office 协议替身未提交草稿，取消切换后必须保留。";
  await openEditing(page, app, cap);
  await fillCollected(page, body);
  app.office.commandError = 2;
  let confirmation = "";
  page.once("dialog", async (dialog) => { confirmation = dialog.message(); await dialog.dismiss(); });
  await selectCap(page, "工作说明.md");
  await expect.poll(() => confirmation).toContain("仍要关闭当前Office编辑会话并切换吗");
  await expect(page.locator("#document-header")).toContainText(cap.name);
  await expect(page.locator("#document-header")).toContainText("保存失败");
  await expect(editor(page)).toHaveValue(body);
  await expect(page.locator("#content .onlyoffice-stage iframe")).toHaveAttribute("data-test-identity", "preserved-edit-frame");
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
  expect(await currentBody(app, cap.name)).toBe("Office 协议替身初始正文");
  await expectReleased(app, cap.name);
});

test("Office 协议替身：释放后同事提交不被迟到回调覆盖，冲突原件可下载恢复", async ({ page, app }, testInfo) => {
  const cap = await createOfficeDocument(app, testInfo);
  const body = "Office 协议替身的未提交草稿，应进入冲突恢复原件。";
  await openEditing(page, app, cap);
  await fillCollected(page, body);
  const document = [...app.office.documents.values()].find((item) => item.title === cap.name && item.mode === "edit");
  expect(document).toBeDefined();
  await fileAction(page, "结束编辑并释放占用");
  await expectReleased(app, cap.name);
  const peerBody = "同事在占用释放后提交的 DOCX 正文，必须保留。";
  const peerFile = testInfo.outputPath("peer.docx");
  await writeFile(peerFile, await writeProtocolDocument("docx", peerBody));
  const peer = await app.api.upload(cap.name, undefined, peerFile, cap.token);
  await app.office.sendFinal(document.key);
  await expect(page.locator("#document-header")).toContainText("版本冲突", { timeout: 15000 });
  await expect(page.locator("#content").getByRole("link", { name: "下载冲突恢复原件", exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: "下载恢复原件", exact: true }).click();
  const download = await downloadPromise;
  const recoveryFile = testInfo.outputPath("recovery.docx");
  await download.saveAs(recoveryFile);
  expect(await readProtocolDocument("docx", await readFile(recoveryFile))).toBe(body);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(peer.commit);
  expect(await currentBody(app, cap.name)).toBe(peerBody);
  await expect(editor(page)).toHaveValue(body);
  await expect(page.locator("#content .onlyoffice-stage iframe")).toHaveAttribute("data-test-identity", "preserved-edit-frame");
});
