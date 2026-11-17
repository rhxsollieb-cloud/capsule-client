import { randomUUID } from "node:crypto";
import { test, expect, login, selectCap } from "./helpers.mjs";

async function document(app) {
  const name = `复制权限验证-${randomUUID()}.md`;
  const cap = await app.api.json("/api/capsules", "POST", {
    name, kind: "markdown", description: "复制权限隔离测试", body: "# 只读源正文\n\n原始内容必须保留。\n",
  });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  return cap;
}

async function setPermission(app, name, permission) {
  const access = await app.api.json(app.api.path(name, "access"));
  return app.api.json(app.api.path(name, "access"), "PUT", { revision: access.revision, permission });
}

test("管理员通过三档权限表单管理全部非管理员，不使用个人授权", async ({ page, app }) => {
  const cap = await document(app);
  await login(page, app);
  await selectCap(page, cap.name);
  await expect(page.locator("#content").getByRole("heading", { name: "只读源正文" })).toBeVisible();
  await page.locator("#library-menu").click();
  await page.getByRole("menuitem", { name: "账户与管理", exact: true }).click();
  const admin = page.getByRole("dialog", { name: "账户与知识库管理", exact: true });
  await admin.getByRole("button", { name: "胶囊权限", exact: true }).click();
  const permission = admin.getByRole("combobox", { name: "非管理员权限", exact: true });
  await expect(permission).toHaveValue("edit");
  await expect(permission.locator("option")).toHaveCount(3);
  await expect(admin.getByLabel("用户ID", { exact: true })).toHaveCount(0);
  let revision = (await app.api.json(app.api.path(cap.name, "access"))).revision;
  for (const value of ["read", "none", "edit"]) {
    await permission.selectOption(value);
    await admin.getByRole("button", { name: "保存 cap 权限", exact: true }).click();
    await expect.poll(async () => (await app.api.json(app.api.path(cap.name, "access"))).permission).toBe(value);
    const updated = await app.api.json(app.api.path(cap.name, "access"));
    expect(updated.revision).toBeGreaterThan(revision);
    revision = updated.revision;
    await expect(permission).toHaveValue(value);
    await expect(admin.getByRole("button", { name: "保存 cap 权限", exact: true })).toBeEnabled();
  }
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("普通员工可复制只读源并编辑独立副本，原文和权限不变", async ({ page, app }) => {
  const source = await document(app);
  await setPermission(app, source.name, "read");
  await login(page, app, app.editor);
  await selectCap(page, source.name);
  await expect(page.locator("#content").getByRole("heading", { name: "只读源正文" })).toBeVisible();
  await expect(page.getByRole("button", { name: "占用并编辑", exact: true })).toBeHidden();
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "复制为新 cap…", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.locator("#tree").getByRole("button", { name: `${source.name} · 节点操作`, exact: true }).click();
  await page.getByRole("menuitem", { name: "复制为新 cap…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "复制为新 cap", exact: true });
  await expect(dialog).toContainText("默认向普通员工开放读写");
  const name = `独立副本-${randomUUID()}.md`;
  await dialog.getByLabel("副本名称 · 全库唯一", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "复制", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#native-navigation").getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator("#content").getByRole("heading", { name: "只读源正文" })).toBeVisible();
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  await editor.fill("# 我的副本已更新\n\n普通员工可编辑自己的独立副本。\n");
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "我的副本已更新" })).toBeVisible();
  const [original, copy, access] = await Promise.all([
    app.api.json(app.api.path(source.name, "read", { entry: "README.md" })),
    app.api.json(app.api.path(name, "read", { entry: "README.md" })),
    app.api.json(app.api.path(name, "access")),
  ]);
  expect(original.body).toBe("# 只读源正文\n\n原始内容必须保留。\n");
  expect(original.commit).toBe(source.commit);
  expect(copy.body).toContain("# 我的副本已更新");
  expect(access.permission).toBe("edit");
  expect((await app.api.json(app.api.path(source.name, "access"))).permission).toBe("read");
});

test("复制响应丢失保留已建副本，禁止在结果未知时重复提交", async ({ page, app }) => {
  const source = await document(app);
  await login(page, app, app.editor);
  await selectCap(page, source.name);
  await expect(page.locator("#content").getByRole("heading", { name: "只读源正文" })).toBeVisible();
  let copies = 0;
  await page.route("**/ui/action", async (route) => {
    if (route.request().postDataJSON()?.action !== "copy") return route.continue();
    copies++;
    await route.fetch();
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "复制为新 cap…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "复制为新 cap", exact: true });
  const name = `未收到回执副本-${randomUUID()}.md`;
  await dialog.getByLabel("副本名称 · 全库唯一", { exact: true }).fill(name);
  await dialog.getByRole("button", { name: "复制", exact: true }).click();
  await expect(dialog).toContainText("复制结果尚未确认");
  await expect(dialog.getByRole("button", { name: "复制", exact: true })).toBeDisabled();
  expect(copies).toBe(1);
  expect((await app.api.json(app.api.path(name, "read", { entry: "README.md" }))).body).toContain("# 只读源正文");
  expect((await app.api.json(app.api.path(source.name))).commit).toBe(source.commit);
});
