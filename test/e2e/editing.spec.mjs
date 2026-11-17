import { test, expect, login, selectCap, createDocument } from "./helpers.mjs";

test("占用、编辑、保存和释放的完整前端流程有效", async ({ page, app }) => {
  const before = await createDocument(app);
  await login(page, app);
  await selectCap(page, before.name);
  await expect(page.locator("#content").getByRole("heading", { name: "初始正文" })).toBeVisible();
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  await editor.fill("# 保存后正文\n\nPlaywright通过真实统一接口保存。\n");
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "保存后正文" })).toBeVisible();
  const saved = await app.api.json(app.api.path(before.name));
  expect(saved.commit).not.toBe(before.commit);
  const content = await app.api.json(app.api.path(before.name, "read", { entry: "README.md" }));
  expect(content.body).toContain("Playwright通过真实统一接口保存");
  await expect.poll(async () => (await app.api.json(app.api.path(before.name, "lease"))).leases.length, { timeout: 5000 }).toBe(0);
});

test("旧版本草稿保存返回冲突，保留草稿且不覆盖同事内容", async ({ page, app }) => {
  const before = await createDocument(app);
  await login(page, app);
  const baselineResponse = page.waitForResponse((response) => response.url().endsWith("/ui/action")
    && response.request().postDataJSON()?.action === "stat" && response.request().postDataJSON()?.name === before.name);
  await selectCap(page, before.name);
  await expect(page.locator("#content").getByRole("heading", { name: "初始正文" })).toBeVisible();
  const baseline = await (await baselineResponse).json();
  // Model a peer commit before this tab learns the new metadata. Saving still
  // reaches the real server; background polling cannot replace the old baseline.
  await page.route("**/ui/action", (route) => {
    const input = route.request().postDataJSON();
    return input.action === "stat" && input.name === before.name
      ? route.fulfill({ json: baseline }) : route.continue();
  });
  await app.api.putText(before.name, "README.md", "# 同事已提交\n\n应当保留这个版本。\n", before.token);
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  await editor.fill("# 我的旧基线草稿\n\n不能覆盖同事。\n");
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content")).toContainText("草稿");
  await expect(page.locator("#document-header")).toContainText("版本冲突");
  await expect(editor).toHaveValue("# 我的旧基线草稿\n\n不能覆盖同事。\n");
  const content = await app.api.json(app.api.path(before.name, "read", { entry: "README.md" }));
  expect(content.body).toContain("同事已提交");
  expect(content.body).not.toContain("我的旧基线草稿");
});

test("两个标签页同时编辑显示占用，结束编辑后无需等待过期即可接手", async ({ page, context, app }) => {
  const cap = await createDocument(app);
  await login(page, app);
  await selectCap(page, cap.name);
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  await expect(page.locator("#content textarea.text-editor")).toBeEditable();
  const colleague = await context.newPage();
  try {
    await colleague.goto(app.url);
    await selectCap(colleague, cap.name);
    await colleague.getByRole("button", { name: "占用并编辑", exact: true }).click();
    await expect(colleague.locator("#content .editor-notice")).toContainText("测试管理员正在编辑，请等待释放");
    await expect(colleague.locator("#content textarea.text-editor")).not.toBeEditable();
    await page.getByRole("button", { name: "结束编辑并阅读", exact: true }).click();
    await expect.poll(async () => (await app.api.json(app.api.path(cap.name, "lease"))).leases.length, { timeout: 5000 }).toBe(0);
    await colleague.getByRole("button", { name: "占用并编辑", exact: true }).click();
    await expect(colleague.locator("#content textarea.text-editor")).toBeEditable({ timeout: 5000 });
    await colleague.getByRole("button", { name: "结束编辑并阅读", exact: true }).click();
    await expect.poll(async () => (await app.api.json(app.api.path(cap.name, "lease"))).leases.length, { timeout: 5000 }).toBe(0);
  } finally { await colleague.close(); }
});

test("版本回撤通过事件队列生成新提交并恢复正文", async ({ page, app }) => {
  const original = await createDocument(app);
  const newer = await app.api.putText(original.name, "README.md", "# 后来的正文\n\n这个版本应保留在历史中。\n", original.token);
  await login(page, app);
  await selectCap(page, original.name);
  await expect(page.locator("#content").getByRole("heading", { name: "后来的正文" })).toBeVisible();
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "版本历史与回撤", exact: true }).click();
  const row = page.locator("#content .history-row").filter({ has: page.locator(`[title="${original.commit}"]`) });
  await row.getByRole("button", { name: "回撤", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "回撤到此版本" });
  await dialog.getByRole("button", { name: /^回撤到 / }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#toast")).toContainText("已回撤并保存新版本");
  const restored = await app.api.json(app.api.path(original.name));
  expect(restored.commit).not.toBe(original.commit);
  expect(restored.commit).not.toBe(newer.commit);
  await selectCap(page, original.name);
  await expect(page.locator("#content").getByRole("heading", { name: "初始正文" })).toBeVisible();
});
