import { randomUUID } from "node:crypto";
import { test, expect, login, selectCap, createDocument } from "./helpers.mjs";

const editorOf = (page) => page.locator("#content textarea.text-editor");
const headingOf = (page, name) => page.locator("#content").getByRole("heading", { name, exact: true });

async function beginEditing(page) {
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  await expect(editorOf(page)).toBeEditable();
  return editorOf(page);
}

async function fileAction(page, name) {
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}

async function released(app, name) {
  await expect.poll(async () => (await app.api.json(app.api.path(name, "lease"))).leases.length, { timeout: 5000 }).toBe(0);
}

test("逐段输入中文、换行和缩进，用快捷键保存后刷新仍为同一正文", async ({ page, app }) => {
  const original = await createDocument(app);
  await login(page, app, app.editor);
  await selectCap(page, original.name);
  const editor = await beginEditing(page);
  await editor.press("ControlOrMeta+A");
  await editor.pressSequentially("# 周会记录");
  await editor.press("Enter");
  await editor.press("Enter");
  await editor.pressSequentially("本周完成：统一接口联调。");
  await editor.press("Enter");
  await editor.press("Tab");
  await editor.pressSequentially("下一步由张同事跟进。🙂");
  const expected = "# 周会记录\n\n本周完成：统一接口联调。\n  下一步由张同事跟进。🙂";
  await expect(editor).toHaveValue(expected);
  await editor.press("ControlOrMeta+S");
  await expect(headingOf(page, "周会记录")).toBeVisible();
  await released(app, original.name);
  const saved = await app.api.json(app.api.path(original.name));
  expect(saved.commit).not.toBe(original.commit);
  await page.reload();
  await selectCap(page, original.name);
  await expect(headingOf(page, "周会记录")).toBeVisible();
  expect((await app.api.json(app.api.path(original.name, "read", { entry: "README.md" }))).body).toBe(expected);
});

test("同一个资料包切换两份文件，未保存草稿保留且不会写入另一份文件", async ({ page, app }) => {
  const name = `会议资料-${randomUUID()}`;
  let cap = await app.api.json("/api/capsules", "POST", { name, kind: "files" });
  cap = await app.api.json(app.api.path(name, "write"), "POST", { token: cap.token, entry: "会议.md", body: "# 会议原文\n" });
  cap = await app.api.json(app.api.path(name, "write"), "POST", { token: cap.token, entry: "行动.md", body: "# 行动原文\n" });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  await login(page, app, app.editor);
  await selectCap(page, name);
  const navigation = page.locator("#native-navigation");
  await navigation.getByRole("button", { name: "会议.md", exact: true }).click();
  const editor = await beginEditing(page);
  await editor.fill("# 会议草稿\n\n此段尚未提交。\n");
  await navigation.getByRole("button", { name: "行动.md", exact: true }).click();
  await expect(headingOf(page, "行动原文")).toBeVisible();
  await released(app, name);
  expect((await app.api.json(app.api.path(name))).commit).toBe(cap.commit);
  await navigation.getByRole("button", { name: "会议.md", exact: true }).click();
  await expect(headingOf(page, "会议草稿")).toBeVisible();
  await beginEditing(page);
  await expect(editorOf(page)).toHaveValue("# 会议草稿\n\n此段尚未提交。\n");
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await released(app, name);
  await page.reload();
  await selectCap(page, name);
  await navigation.getByRole("button", { name: "会议.md", exact: true }).click();
  await expect(headingOf(page, "会议草稿")).toBeVisible();
  expect((await app.api.json(app.api.path(name, "read", { entry: "行动.md" }))).body).toBe("# 行动原文\n");
});

test("预览并放弃草稿会恢复服务端原文，不产生额外提交", async ({ page, app }) => {
  const original = await createDocument(app);
  await login(page, app);
  await selectCap(page, original.name);
  const editor = await beginEditing(page);
  await editor.fill("# 临时想法\n\n- 尚未确定的事项\n");
  await page.getByRole("button", { name: "结束编辑并阅读", exact: true }).click();
  await expect(headingOf(page, "临时想法")).toBeVisible();
  await released(app, original.name);
  await fileAction(page, "放弃草稿并重载");
  await expect(headingOf(page, "初始正文")).toBeVisible();
  await expect(page.locator("#document-header").getByRole("button", { name: "保存", exact: true })).toBeHidden();
  expect((await app.api.json(app.api.path(original.name))).commit).toBe(original.commit);
  await page.reload();
  await selectCap(page, original.name);
  await expect(headingOf(page, "初始正文")).toBeVisible();
});

test("保存失败后切走再回来草稿仍在，显式重试才提交", async ({ page, app }) => {
  const original = await createDocument(app);
  await login(page, app);
  await selectCap(page, original.name);
  const editor = await beginEditing(page);
  await editor.fill("# 待重试正文\n\n网络恢复后由用户明确保存。\n");
  let writes = 0;
  await page.route("**/ui/action", (route) => {
    const input = route.request().postDataJSON();
    if (input.action === "save" && input.name === original.name && ++writes === 1)
      return route.fulfill({ status: 503, json: { error: "测试网络暂不可用" } });
    return route.continue();
  });
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#document-header")).toContainText("保存失败");
  await released(app, original.name);
  expect((await app.api.json(app.api.path(original.name))).commit).toBe(original.commit);
  await selectCap(page, "工作说明.md");
  await expect(headingOf(page, "测试知识正文")).toBeVisible();
  await selectCap(page, original.name);
  await expect(headingOf(page, "待重试正文")).toBeVisible();
  expect(writes).toBe(1);
  await beginEditing(page);
  await expect(editorOf(page)).toHaveValue("# 待重试正文\n\n网络恢复后由用户明确保存。\n");
  await editorOf(page).press("ControlOrMeta+S");
  await expect(page.locator("#document-header").getByRole("button", { name: "保存失败", exact: true })).toBeHidden();
  await released(app, original.name);
  expect(writes).toBe(2);
  expect((await app.api.json(app.api.path(original.name, "read", { entry: "README.md" }))).body).toContain("网络恢复后由用户明确保存");
});

test("保存回执迟到时切换并编辑另一文档，不覆盖内容或释放新文档占用", async ({ page, app }) => {
  const first = await createDocument(app), second = await createDocument(app);
  await login(page, app);
  await selectCap(page, first.name);
  await (await beginEditing(page)).fill("# 第一份已保存\n");
  let acknowledge, saved;
  const acknowledgment = new Promise((resolve) => { acknowledge = resolve; });
  const committed = new Promise((resolve) => { saved = resolve; });
  await page.route("**/ui/action", async (route) => {
    const input = route.request().postDataJSON();
    if (input.action !== "save" || input.name !== first.name) return route.continue();
    const response = await route.fetch();
    saved();
    await acknowledgment;
    await route.fulfill({ response });
  });
  try {
    await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
    await committed;
    await selectCap(page, second.name);
    await (await beginEditing(page)).fill("# 第二份独立草稿\n");
    const completed = page.waitForResponse((response) => response.url().endsWith("/ui/action")
      && response.request().postDataJSON()?.action === "save" && response.request().postDataJSON()?.name === first.name);
    // This refresh is triggered by Workspace.saved after it consumes the old
    // response. Await it so the assertions also run after the save's finally.
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/ui/action")
      && response.request().postDataJSON()?.action === "ls" && response.request().postDataJSON()?.path === "/");
    acknowledge();
    await (await completed).finished();
    await (await refreshed).finished();
    await expect(editorOf(page)).toHaveValue("# 第二份独立草稿\n");
    await expect(editorOf(page)).toBeEditable();
    expect((await app.api.json(app.api.path(second.name, "lease"))).leases).toHaveLength(1);
    await editorOf(page).press("ControlOrMeta+S");
    await expect(headingOf(page, "第二份独立草稿")).toBeVisible();
    await released(app, second.name);
    expect((await app.api.json(app.api.path(first.name, "read", { entry: "README.md" }))).body).toBe("# 第一份已保存\n");
    expect((await app.api.json(app.api.path(second.name, "read", { entry: "README.md" }))).body).toBe("# 第二份独立草稿\n");
  } finally { acknowledge(); }
});

test("两名editor在独立客户端协作：占用提示、保存交接和读取最新版本", async ({ page, context, app }) => {
  const original = await createDocument(app);
  const colleagueAccount = { username: `peer-${randomUUID().slice(0, 8)}`, password: "Peer-test-password-2026!" };
  await app.api.json("/api/access/users", "POST", { ...colleagueAccount, name: "编辑同事乙", role: "editor" });
  const peer = await app.createPeer();
  const colleague = await context.newPage();
  try {
    await login(page, app, app.editor);
    await login(colleague, peer, colleagueAccount);
    await selectCap(page, original.name);
    await selectCap(colleague, original.name);
    await (await beginEditing(page)).fill("# 同事甲已完成\n\n交给下一位同事继续。\n");
    await colleague.getByRole("button", { name: "占用并编辑", exact: true }).click();
    await expect(colleague.locator("#content .editor-notice")).toContainText("测试编辑同事正在编辑，请等待释放");
    await expect(editorOf(colleague)).not.toBeEditable();
    await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
    await expect(headingOf(page, "同事甲已完成")).toBeVisible();
    await released(app, original.name);
    await fileAction(colleague, "检查更新");
    await expect(headingOf(colleague, "同事甲已完成")).toBeVisible();
    const editor = await beginEditing(colleague);
    await editor.press("ControlOrMeta+End");
    await editor.pressSequentially("\n同事乙补充确认。\n");
    await editor.press("ControlOrMeta+S");
    await released(app, original.name);
    await fileAction(page, "检查更新");
    await expect(page.locator("#content")).toContainText("同事乙补充确认");
    const final = await app.api.json(app.api.path(original.name, "read", { entry: "README.md" }));
    expect(final.body).toContain("同事甲已完成");
    expect(final.body).toContain("同事乙补充确认");
  } finally { await colleague.close(); }
});
