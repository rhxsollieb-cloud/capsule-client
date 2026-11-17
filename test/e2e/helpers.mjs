import { randomUUID } from "node:crypto";
import { test as base, expect } from "./fixture.mjs";

export { expect };
export const test = base.extend({
  browserErrors: [async ({ context }, use) => {
    const errors = [];
    const track = (page) => page.on("pageerror", (error) => errors.push(error.message));
    context.pages().forEach(track);
    context.on("page", track);
    await use(errors);
    expect(errors, "页面不应出现未处理的 JavaScript 异常").toEqual([]);
  }, { auto: true }],
});

export async function createDocument(app) {
  const name = `编辑验证-${randomUUID()}.md`;
  const cap = await app.api.json("/api/capsules", "POST", { name, kind: "markdown", body: "# 初始正文\n\n保存测试内容。\n" });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  return cap;
}

export async function login(page, app, account = app.admin) {
  await page.goto(app.url);
  const dialog = page.getByRole("dialog", { name: "连接与登录" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("知识库服务器", { exact: true }).fill(app.serverUrl);
  await dialog.getByText("Office 连接设置", { exact: true }).click();
  await dialog.getByLabel("Office 服务", { exact: true }).fill(app.officeUrl);
  await dialog.getByLabel("用户名", { exact: true }).fill(account.username);
  await dialog.getByLabel("密码", { exact: true }).fill(account.password);
  await dialog.getByRole("button", { name: "连接并登录", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "工作说明.md", exact: true })).toBeVisible();
}

export async function selectCap(page, name) {
  await page.locator("#tree").getByRole("button", { name, exact: true }).click();
}

export async function rotateSession(app, request) {
  const current = await (await request.get(app.url + "/ui/session")).json();
  const response = await request.post(app.url + "/ui/auth/login", {
    headers: { "X-Capsule-Session": current.csrfToken, Origin: app.url },
    data: { username: app.admin.username, password: app.admin.password },
  });
  expect(response.ok()).toBe(true);
}
