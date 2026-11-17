import { test, expect, login, selectCap, rotateSession } from "./helpers.mjs";

test("密码错误不会登录，正确登录可刷新复用会话且浏览器不取得服务端令牌", async ({ page, app }) => {
  await page.goto(app.url);
  const dialog = page.getByRole("dialog", { name: "连接与登录" });
  await dialog.getByLabel("知识库服务器", { exact: true }).fill(app.serverUrl);
  await dialog.getByText("Office 连接设置", { exact: true }).click();
  await dialog.getByLabel("Office 服务", { exact: true }).fill(app.officeUrl);
  await dialog.getByLabel("用户名", { exact: true }).fill(app.admin.username);
  await dialog.getByLabel("密码", { exact: true }).fill("incorrect-test-password");
  await dialog.getByRole("button", { name: "连接并登录", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("用户名或密码不正确");
  await expect(dialog.getByLabel("密码", { exact: true })).toHaveValue("");
  await dialog.getByLabel("密码", { exact: true }).fill(app.admin.password);
  await dialog.getByRole("button", { name: "连接并登录", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("button", { name: "工作说明.md", exact: true })).toBeVisible();
  await expect(dialog).toBeHidden();
  const status = await (await page.request.get(app.url + "/ui/auth/status")).json();
  expect(status.authenticated).toBe(true);
  expect(status).not.toHaveProperty("token");
  expect(status).not.toHaveProperty("password");
});

test("editor 可读写普通 cap，保护 cap 不在列表或界面中泄露", async ({ page, app }) => {
  await login(page, app, app.editor);
  await expect(page.locator("#tree").getByRole("button", { name: "受保护.md", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建 cap", exact: true })).toBeEnabled();
  await selectCap(page, "工作说明.md");
  await expect(page.getByRole("button", { name: "占用并编辑", exact: true })).toBeVisible();
  const session = await (await page.request.get(app.url + "/ui/session")).json();
  const denied = await page.request.post(app.url + "/ui/action", {
    headers: { "X-Capsule-Session": session.csrfToken, Origin: app.url },
    data: { action: "stat", name: "受保护.md" },
  });
  expect(denied.status()).toBe(404);
});

test("会话轮换后第一次点击会自动重连并恢复文件，无需再次点击", async ({ page, app }) => {
  await login(page, app);
  await rotateSession(app, page.request);
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
  await expect(page.locator("#tree .selected")).toContainText("工作说明.md");
});

test("同账户会话刷新重绑已显示媒体，图片不残留旧凭证链接", async ({ page, app }) => {
  await login(page, app);
  await selectCap(page, "示例图.png");
  const image = page.locator("#content img");
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  const before = await image.getAttribute("src");
  await rotateSession(app, page.request);
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "检查更新", exact: true }).click();
  await expect(image).not.toHaveAttribute("src", before);
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  const stale = await page.request.get(app.url + before);
  expect(stale.status()).toBe(403);
});
