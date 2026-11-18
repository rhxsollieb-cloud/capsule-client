import { test, expect, login, selectCap } from "./helpers.mjs";

test("左侧节点与第二列文件都能显示真实正文", async ({ page, app }) => {
  await login(page, app);
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
  await selectCap(page, "资料包");
  const navigation = page.locator("#native-navigation");
  await navigation.getByRole("button", { name: "notes", exact: true }).click();
  await navigation.getByRole("button", { name: "清单.txt", exact: true }).click();
  await expect(page.locator("#content")).toContainText("内部文件正文");
  await expect(page.locator("#document-header")).toContainText("清单.txt");
});

test("复制路径使用该行的完整挂载，剪贴板受限时可手动复制", async ({ page, app }) => {
  const path = "/工作说明.md/示例图.png";
  await app.api.json("/api/mounts", "POST", { name: "示例图.png", path });
  await page.addInitScript(() => {
    Object.defineProperty(globalThis.navigator, "clipboard", { value: { async writeText(text) {
      if (globalThis.denyPathCopy) throw new Error("剪贴板权限受限");
      globalThis.copiedPath = text;
    } } });
  });
  await login(page, app, app.editor);
  await selectCap(page, "工作说明.md");
  const tree = page.locator("#tree");
  await tree.locator('[data-path="/工作说明.md"]').getByRole("button", { name: "展开", exact: true }).click();
  const row = tree.locator(`[data-path="${path}"]`);
  const copy = row.getByRole("button", { name: "复制路径", exact: true });
  await copy.press("Enter");
  await expect(page.locator("#toast")).toHaveText("已复制路径");
  expect(await page.evaluate(() => globalThis.copiedPath)).toBe(path);
  await expect(tree.locator(".tree-row.selected")).toHaveAttribute("data-path", "/工作说明.md");

  await page.evaluate(() => { globalThis.denyPathCopy = true; });
  await row.getByRole("button", { name: "示例图.png", exact: true }).click({ button: "right" });
  await page.getByRole("menuitem", { name: "复制路径", exact: true }).click();
  const value = page.getByRole("dialog", { name: "复制路径" }).getByRole("textbox", { name: "虚拟路径" });
  await expect(value).toHaveValue(path);
  await expect(value).toBeFocused();
  expect(await value.evaluate((input) => input.value.slice(input.selectionStart, input.selectionEnd))).toBe(path);
});

test("图片原件实际加载，数据库显示真实业务行", async ({ page, app }) => {
  await login(page, app);
  await selectCap(page, "示例图.png");
  const image = page.locator("#content img");
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await selectCap(page, "业务记录");
  await expect(page.locator("#content .tabulator-row")).toHaveCount(2);
  await expect(page.locator("#content .tabulator-table")).toContainText("测试联系人甲");
  await expect(page.locator("#content .tabulator-table")).toContainText("测试联系人乙");
});

test("快速切换时旧 cap 的迟到响应不覆盖后来选择", async ({ page, app }) => {
  await login(page, app);
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let started;
  const captured = new Promise((resolve) => { started = resolve; });
  await page.route("**/ui/action", async (route) => {
    const input = route.request().postDataJSON();
    if (input.action !== "stat" || input.name !== "资料包") return route.continue();
    const response = await route.fetch();
    started();
    await pending;
    await route.fulfill({ response });
  });
  await selectCap(page, "资料包");
  await captured;
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
  const delivered = page.waitForResponse((response) => response.url().endsWith("/ui/action") && response.request().postDataJSON()?.name === "资料包");
  release();
  await delivered;
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
  await expect(page.locator("#native-navigation").getByRole("heading", { name: "工作说明.md" })).toBeVisible();
});

test("正文读取失败明确展示错误，重新选择后可恢复", async ({ page, app }) => {
  await login(page, app);
  let rejectOnce = true;
  await page.route("**/ui/action", async (route) => {
    const input = route.request().postDataJSON();
    if (rejectOnce && input.action === "read" && input.name === "工作说明.md") {
      rejectOnce = false;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试读取失败" }) });
    }
    return route.continue();
  });
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content")).toContainText("测试读取失败");
  await selectCap(page, "资料包");
  await expect(page.locator("#content .file-list")).toBeVisible();
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
});

test("过滤、双列调宽和侧栏折叠都保留正在阅读的内容", async ({ page, app }) => {
  await login(page, app);
  await selectCap(page, "资料包");
  await expect(page.locator("#content .file-list")).toBeVisible();
  const filter = page.getByRole("searchbox", { name: "过滤知识库名称或简介", exact: true });
  await filter.fill("工作说明");
  await expect(page.locator("#tree .tree-select")).toHaveCount(1);
  await expect(page.locator("#document-header")).toContainText("资料包");
  await filter.press("Escape");
  await expect(page.locator("#tree").getByRole("button", { name: "资料包", exact: true })).toBeVisible();
  for (const label of ["调整知识库宽度", "调整内部内容列宽度"]) {
    const separator = page.getByRole("separator", { name: label, exact: true });
    const before = Number(await separator.getAttribute("aria-valuenow"));
    await separator.press("ArrowRight");
    await expect(separator).toHaveAttribute("aria-valuenow", String(before + 10));
  }
  await page.getByRole("button", { name: "收起知识库", exact: true }).click();
  await expect(page.locator("#knowledge-navigation")).toBeHidden();
  await expect(page.locator("#content .file-list")).toBeVisible();
  await page.getByRole("button", { name: "展开知识库", exact: true }).click();
  await expect(page.locator("#native-navigation")).toBeVisible();
  await expect(page.locator("#document-header")).toContainText("资料包");
});
