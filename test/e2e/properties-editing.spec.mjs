import { randomUUID } from "node:crypto";
import { test, expect, login, selectCap } from "./helpers.mjs";

async function metadataDocument(app) {
  const name = `属性资料-${randomUUID()}.bin`;
  let cap = await app.api.json("/api/capsules", "POST", { name, kind: "file", description: "原始简述" });
  cap = await app.api.json(app.api.path(name, "details"), "PUT", {
    token: cap.token, description: "原始简述", body: "# 原始详述\n\n这是 **原始重点**。\n",
  });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  return cap;
}

async function openProperties(page, name) {
  await page.locator("#tree").getByRole("button", { name: `${name} · 属性`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "cap 属性", exact: true });
  await expect(dialog.getByLabel("名称", { exact: true })).toHaveValue(name);
  await expect(dialog.getByLabel("简述", { exact: true })).toBeEnabled();
  return dialog;
}

async function expectReleased(app, name) {
  await expect.poll(async () => (await app.api.json(app.api.path(name, "lease"))).leases.length).toBe(0);
}

test("节点简述与 Markdown 详述可编辑、预览、保存并在重开后持久显示", async ({ page, app }) => {
  const before = await metadataDocument(app);
  await login(page, app, app.editor);
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  const dialog = await openProperties(page, before.name);
  await expect(dialog.getByRole("heading", { name: "原始详述", exact: true })).toBeVisible();
  await expect(dialog.getByLabel("简述", { exact: true })).not.toBeEditable();
  await dialog.getByRole("button", { name: "占用并编辑说明", exact: true }).click();
  await expect(dialog.getByLabel("简述", { exact: true })).toBeEditable();
  await dialog.getByLabel("简述", { exact: true }).fill("已保存的属性简述");
  await dialog.getByRole("button", { name: "编辑详述", exact: true }).click();
  const body = "# 保存后详述\n\n这段内容包含 **保存重点**。\n\n- 第一项\n- 第二项\n";
  const details = dialog.getByRole("textbox", { name: "详述", exact: true });
  await expect(details).toBeEditable();
  await details.fill(body);
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "保存后详述", exact: true })).toBeVisible();
  await expect(dialog.locator(".property-body strong")).toHaveText("保存重点");
  await expect(dialog.locator(".property-body li")).toHaveText(["第一项", "第二项"]);
  await dialog.getByRole("button", { name: "保存说明", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("说明已保存");
  const saved = await app.api.json(app.api.path(before.name));
  expect(saved.commit).not.toBe(before.commit);
  expect(saved.description).toBe("已保存的属性简述");
  const record = await app.api.json(app.api.path(before.name, "details"));
  expect(record.body).toBe(body);
  expect(record.source.type).toBe("metadata");
  await expectReleased(app, before.name);
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭属性", exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.reload();
  const reopened = await openProperties(page, before.name);
  await expect(reopened.getByLabel("简述", { exact: true })).toHaveValue("已保存的属性简述");
  await expect(reopened.getByRole("heading", { name: "保存后详述", exact: true })).toBeVisible();
  await expect(reopened.locator(".property-body strong")).toHaveText("保存重点");
});

test("文字类属性的编辑正文进入中央编辑器，预览与保存后详述仍引用同一正文", async ({ page, app }) => {
  const name = `属性正文-${randomUUID()}.md`;
  const before = await app.api.json("/api/capsules", "POST", {
    name, kind: "markdown", description: "文字属性简述", body: "# 原始属性正文\n\n正文与详述是同一份内容。\n",
  });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  await login(page, app, app.editor);
  const dialog = await openProperties(page, name);
  await expect(dialog.getByRole("heading", { name: "原始属性正文", exact: true })).toBeVisible();
  await expect(dialog.getByText("详述即正文，不另存副本", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "编辑正文", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#content").getByRole("heading", { name: "原始属性正文", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  const body = "# 属性正文已更新\n\n这里保留 **正文重点**，详述不会另存一份。\n";
  await editor.fill(body);
  await page.getByRole("button", { name: "结束编辑并阅读", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "属性正文已更新", exact: true })).toBeVisible();
  await expect(page.locator("#content .markdown-body strong")).toHaveText("正文重点");
  await expectReleased(app, name);
  expect((await app.api.json(app.api.path(name))).commit).toBe(before.commit);
  expect((await app.api.json(app.api.path(name, "read", { entry: "README.md" }))).body).toBe("# 原始属性正文\n\n正文与详述是同一份内容。\n");
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  await expect(editor).toBeEditable();
  await expect(editor).toHaveValue(body);
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "属性正文已更新", exact: true })).toBeVisible();
  const saved = await app.api.json(app.api.path(name));
  expect(saved.commit).not.toBe(before.commit);
  const [text, details] = await Promise.all([
    app.api.json(app.api.path(name, "read", { entry: "README.md" })),
    app.api.json(app.api.path(name, "details")),
  ]);
  expect(text.body).toBe(body);
  expect(details.body).toBe(body);
  expect(details.commit).toBe(text.commit);
  expect(details.source).toMatchObject({ type: "content", entry: "README.md" });
  await expectReleased(app, name);
  const reopened = await openProperties(page, name);
  await expect(reopened.getByRole("heading", { name: "属性正文已更新", exact: true })).toBeVisible();
  await expect(reopened.locator(".property-body strong")).toHaveText("正文重点");
});

test("关闭属性和切换知识节点不提交或串用草稿，重新打开可继续保存原草稿", async ({ page, app }) => {
  const first = await metadataDocument(app);
  const second = await metadataDocument(app);
  await login(page, app, app.editor);
  await selectCap(page, "工作说明.md");
  const dialog = await openProperties(page, first.name);
  await dialog.getByRole("button", { name: "占用并编辑说明", exact: true }).click();
  await expect(dialog.getByLabel("简述", { exact: true })).toBeEditable();
  await dialog.getByLabel("简述", { exact: true }).fill("关闭后仍保留的简述草稿");
  await dialog.getByRole("button", { name: "编辑详述", exact: true }).click();
  const body = "# 未提交的详述草稿\n\n关闭窗口不应自动保存，也不应把草稿交给另一个 cap。\n";
  await dialog.getByRole("textbox", { name: "详述", exact: true }).fill(body);
  await dialog.getByRole("button", { name: "阅读", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: "未提交的详述草稿", exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭属性", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expectReleased(app, first.name);
  const unchanged = await app.api.json(app.api.path(first.name));
  expect(unchanged.commit).toBe(first.commit);
  expect(unchanged.description).toBe("原始简述");
  expect((await app.api.json(app.api.path(first.name, "details"))).body).toContain("# 原始详述");
  await selectCap(page, "资料包");
  await expect(page.locator("#content .file-list")).toBeVisible();
  const another = await openProperties(page, second.name);
  await expect(another.getByLabel("简述", { exact: true })).toHaveValue("原始简述");
  await expect(another.getByRole("heading", { name: "原始详述", exact: true })).toBeVisible();
  await expect(another).not.toContainText("未提交的详述草稿");
  await another.getByRole("button", { name: "关闭属性", exact: true }).click();
  await expect(another).toBeHidden();
  const reopened = await openProperties(page, first.name);
  await expect(reopened.getByLabel("简述", { exact: true })).toHaveValue("关闭后仍保留的简述草稿");
  await expect(reopened.getByRole("heading", { name: "未提交的详述草稿", exact: true })).toBeVisible();
  await expect(reopened.getByRole("button", { name: "保存说明", exact: true })).toBeDisabled();
  await reopened.getByRole("button", { name: "占用并编辑说明", exact: true }).click();
  await expect(reopened.getByRole("button", { name: "保存说明", exact: true })).toBeEnabled();
  await reopened.getByRole("button", { name: "保存说明", exact: true }).click();
  await expect(reopened.getByRole("status")).toContainText("说明已保存");
  const saved = await app.api.json(app.api.path(first.name));
  expect(saved.commit).not.toBe(first.commit);
  expect(saved.description).toBe("关闭后仍保留的简述草稿");
  expect((await app.api.json(app.api.path(first.name, "details"))).body).toBe(body);
  expect((await app.api.json(app.api.path(second.name))).commit).toBe(second.commit);
  await expectReleased(app, first.name);
});

test("关闭属性期间同事提交新版，旧说明草稿会提示冲突且完整保留", async ({ page, app }) => {
  const before = await metadataDocument(app);
  await login(page, app, app.editor);
  const dialog = await openProperties(page, before.name);
  await dialog.getByRole("button", { name: "占用并编辑说明", exact: true }).click();
  await expect(dialog.getByLabel("简述", { exact: true })).toBeEditable();
  await dialog.getByLabel("简述", { exact: true }).fill("我的旧版简述草稿");
  await dialog.getByRole("button", { name: "编辑详述", exact: true }).click();
  const draft = "# 我的详述草稿\n\n旧基线不能覆盖同事。\n";
  await dialog.getByRole("textbox", { name: "详述", exact: true }).fill(draft);
  await dialog.getByRole("button", { name: "关闭属性", exact: true }).click();
  await expectReleased(app, before.name);
  const peer = await app.api.json(app.api.path(before.name, "details"), "PUT", {
    token: before.token, description: "同事已提交的简述", body: "# 同事的最新详述\n",
  });
  const reopened = await openProperties(page, before.name);
  await expect(reopened.getByRole("status")).toContainText("服务端已有新版本");
  await expect(reopened.getByLabel("简述", { exact: true })).toHaveValue("我的旧版简述草稿");
  await reopened.getByRole("button", { name: "占用并编辑说明", exact: true }).click();
  await reopened.getByRole("button", { name: "保存说明", exact: true }).click();
  await expect(reopened.getByRole("status")).toContainText("草稿和原基线已保留");
  await expectReleased(app, before.name);
  expect((await app.api.json(app.api.path(before.name))).commit).toBe(peer.commit);
  const record = await app.api.json(app.api.path(before.name, "details"));
  expect(record.description).toBe("同事已提交的简述");
  expect(record.body).toBe("# 同事的最新详述\n");
  await reopened.getByRole("button", { name: "编辑详述", exact: true }).click();
  await expect(reopened.getByRole("textbox", { name: "详述", exact: true })).toHaveValue(draft);
  await expect(reopened.getByLabel("简述", { exact: true })).toHaveValue("我的旧版简述草稿");
});
