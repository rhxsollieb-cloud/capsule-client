import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, login, selectCap } from "./helpers.mjs";

test("慢首段不会被后台轮询反复重启，切换文件立即取消旧读取", async ({ page, app }) => {
  const caps = [];
  for (let index = 0; index < 2; index++) {
    const cap = await app.api.json("/api/capsules", "POST", { name: `慢读取-${randomUUID()}.md`, kind: "markdown",
      body: "# 慢读取仍能完成\n\n" + "一个完整段落。\n\n".repeat(400) });
    await app.api.json("/api/mounts", "POST", { name: cap.name, path: "/" + cap.name });
    caps.push(cap);
  }
  const waiting = new Map();
  const reads = [];
  const failed = [];
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/ui/action") && request.postDataJSON()?.action === "read") failed.push(request.postDataJSON().name);
  });
  await page.route("**/ui/action", async (route) => {
    const input = route.request().postDataJSON();
    if (input?.action !== "read" || !caps.some((cap) => cap.name === input.name)) return route.continue();
    reads.push(input.name);
    await new Promise((resolve) => waiting.set(input.name, resolve));
    try { await route.continue(); } catch { /* The canceled browser request need not continue. */ }
  });
  await page.clock.install();
  await page.clock.setFixedTime(new Date());
  await login(page, app, app.editor);
  await selectCap(page, caps[0].name);
  await expect.poll(() => reads.length).toBe(1);
  for (let index = 0; index < 3; index++) {
    const refreshed = page.waitForResponse((response) => response.url().endsWith("/ui/action")
      && response.request().postDataJSON()?.action === "stat" && response.request().postDataJSON()?.name === caps[0].name);
    await page.clock.fastForward(6000);
    await (await refreshed).finished();
  }
  expect(reads).toEqual([caps[0].name]);
  expect(failed).toEqual([]);
  waiting.get(caps[0].name)();
  await expect(page.locator("#content").getByRole("heading", { name: "慢读取仍能完成", exact: true })).toBeVisible();
  await selectCap(page, caps[1].name);
  await expect.poll(() => reads.length).toBe(2);
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  await expect.poll(() => failed).toContain(caps[1].name);
  waiting.get(caps[1].name)();
  expect(reads).toEqual(caps.map((cap) => cap.name));
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
});

test("单行巨型HTML表格不会生成海量DOM或改写正文", async ({ page, app }) => {
  const cap = await app.api.json("/api/capsules", "POST", { name: `复杂表格-${randomUUID()}.md`, kind: "markdown",
    body: "# 大表格\n\n<table>" + "<tr><td>单元格</td></tr>".repeat(9000) + "</table>\n" });
  await app.api.json("/api/mounts", "POST", { name: cap.name, path: "/" + cap.name });
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  await expect(page.locator("#content .markdown-limit")).toContainText("已停止渲染");
  await expect(page.locator("#content td")).toHaveCount(0);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("离开图片原件视图会清除旧图源，旧DOM引用不能继续保留传输", async ({ page, app }) => {
  await login(page, app, app.editor);
  await selectCap(page, "示例图.png");
  const image = page.locator("#content img");
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  await image.evaluate((element) => { globalThis.__oldImage = element; });
  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  expect(await page.evaluate(() => globalThis.__oldImage.getAttribute("src"))).toBeNull();
});

test("旧正文延迟图片遇到新cap版本会拒绝混搭，检查更新后可恢复", async ({ page, app }) => {
  let cap = await app.api.json("/api/capsules", "POST", { name: `媒体版本-${randomUUID()}.md`, kind: "markdown",
    body: "# 带图正文\n\n![版本图片](assets/figure.png)\n" });
  await mkdir(app.home, { recursive: true });
  const file = join(app.home, "version-source.png");
  await writeFile(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVrkAAAAASUVORK5CYII=", "base64"));
  cap = await app.api.upload(cap.name, "assets/figure.png", file, cap.token);
  await app.api.json("/api/mounts", "POST", { name: cap.name, path: "/" + cap.name });
  let release;
  await page.route((url) => url.pathname === "/ui/content" && url.searchParams.get("name") === cap.name,
    async (route) => {
      if (new URL(route.request().url()).searchParams.get("version") === cap.token)
        await new Promise((resolve) => { release = resolve; });
      await route.continue();
    });
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  await expect.poll(() => Boolean(release)).toBe(true);
  const current = await app.api.json(app.api.path(cap.name), "PATCH", { token: cap.token, description: "同事已提交新版本" });
  const rejected = page.waitForResponse((response) => new URL(response.url()).pathname === "/ui/content"
    && new URL(response.url()).searchParams.get("version") === cap.token);
  release();
  expect((await rejected).status()).toBe(409);
  await expect(page.locator("#content .markdown-media-caption")).toContainText("附件暂时无法加载");
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "检查更新", exact: true }).click();
  const image = page.locator("#content img");
  await expect.poll(() => image.evaluate((element) => element.complete && element.naturalWidth > 0)).toBe(true);
  expect(new URL(await image.getAttribute("src"), app.url).searchParams.get("version")).toBe(current.token);
});
