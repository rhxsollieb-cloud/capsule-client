import { randomUUID } from "node:crypto";
import { test, expect, login, selectCap } from "./helpers.mjs";

async function longDocument(app) {
  const body = "# 阅读起点\n\n" + Array.from({ length: 360 }, (_, index) =>
    `第${index + 1}段。${"这一段用于核对长书稿的阅读位置、底部控件和翻页边界。".repeat(8)}\n\n`).join("")
    + "# 阅读终点\n\n这是完整正文的最后一段。\n";
  const cap = await app.api.json("/api/capsules", "POST", { name: `阅读导航-${randomUUID()}.md`, kind: "markdown", body });
  await app.api.json("/api/mounts", "POST", { name: cap.name, path: "/" + cap.name });
  return { ...cap, body };
}

async function settle(page) {
  await page.evaluate(() => new Promise((resolve) => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
}

function track(page, name) {
  const reads = [], writes = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/action")) return;
    const input = request.postDataJSON();
    if (input?.name !== name) return;
    if (input.action === "read") reads.push(input);
    if (["save", "save-details", "write", "edit", "update"].includes(input.action)) writes.push(input);
  });
  return { reads, writes };
}

async function expectCentralBottom(page) {
  const content = await page.locator("#content").boundingBox();
  const pager = page.locator("#content .reader-controls");
  await expect(pager).toBeVisible();
  const box = await pager.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(content.x - 1);
  expect(box.x + box.width).toBeLessThanOrEqual(content.x + content.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(content.y + content.height + 1);
  expect(content.y + content.height - box.y - box.height).toBeLessThanOrEqual(24);
}

test("长文分页悬浮在中央底部，鼠标与左右键翻页并保护首尾边界", async ({ page, app }) => {
  const cap = await longDocument(app);
  const { reads, writes } = track(page, cap.name);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const surface = page.locator("#content .reader-surface");
  const range = page.locator("#content .reader-range");
  const previous = page.getByRole("button", { name: "上一段", exact: true });
  const next = page.getByRole("button", { name: "下一段", exact: true });
  await expect(next).toBeEnabled();
  await expect(previous).toBeDisabled();
  const first = await range.textContent();
  for (const viewport of [{ width: 1280, height: 800 }, { width: 640, height: 560 }, { width: 480, height: 560 }]) {
    await page.setViewportSize(viewport);
    if (viewport.width === 480) await page.getByRole("button", { name: "收起知识库", exact: true }).click();
    await surface.evaluate((element) => { element.scrollTop = 0; });
    await settle(page);
    await expectCentralBottom(page);
    expect(await surface.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
    await surface.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await settle(page);
    await expectCentralBottom(page);
    const end = await surface.locator("article p").last().boundingBox();
    const pager = await page.locator("#content .reader-controls").boundingBox();
    expect(end.y + end.height).toBeLessThanOrEqual(pager.y + 1);
  }
  await surface.focus();
  const atStart = reads.length;
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  expect(reads.length).toBe(atStart);
  await expect(range).toHaveText(first);

  await next.click();
  await expect(range).not.toHaveText(first);
  await expect(previous).toBeEnabled();
  await surface.focus();
  await page.keyboard.press("ArrowLeft");
  await expect(range).toHaveText(first);
  await expect(previous).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(range).not.toHaveText(first);
  const line = page.getByRole("spinbutton", { name: "跳转到行", exact: true });
  await line.fill(await line.getAttribute("max"));
  await page.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(next).toBeDisabled();
  await expect(surface.getByRole("heading", { name: "阅读终点", exact: true })).toBeVisible();
  const last = await range.textContent();
  const atEnd = reads.length;
  await surface.focus();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  expect(reads.length).toBe(atEnd);
  await expect(range).toHaveText(last);
  expect(writes).toEqual([]);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("行号输入、过滤、侧栏、菜单和选字不误翻页，离开阅读器后快捷键失效", async ({ page, app }) => {
  const cap = await longDocument(app);
  const { reads, writes } = track(page, cap.name);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  await expect(page.getByRole("button", { name: "下一段", exact: true })).toBeEnabled();
  const range = page.locator("#content .reader-range");
  const surface = page.locator("#content .reader-surface");
  const first = await range.textContent();
  const before = reads.length;
  const line = page.getByRole("spinbutton", { name: "跳转到行", exact: true });
  await line.fill("20");
  await line.press("ArrowRight");
  await line.press("ArrowLeft");
  const filter = page.getByRole("searchbox", { name: "过滤知识库名称或简介", exact: true });
  await filter.focus();
  await filter.press("ArrowRight");
  await page.locator("#tree").getByRole("button", { name: cap.name, exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator("#native-navigation").getByRole("button", { name: "README.md", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.keyboard.press("ArrowRight");
  await settle(page);
  expect(reads.length).toBe(before);
  await expect(range).toHaveText(first);
  await page.keyboard.press("Escape");
  await surface.focus();
  await surface.locator("p").first().evaluate((element) => {
    const selection = globalThis.getSelection();
    const selected = globalThis.document.createRange();
    selected.selectNodeContents(element);
    selection.removeAllRanges(); selection.addRange(selected);
  });
  await page.keyboard.press("ArrowRight");
  await settle(page);
  expect(reads.length).toBe(before);
  await expect(range).toHaveText(first);
  await page.evaluate(() => globalThis.getSelection().removeAllRanges());

  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  await expect(page.locator("#content .paged-reader")).toHaveCount(0);
  await page.locator("#content article p").first().click();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowLeft");
  await settle(page);
  expect(reads.length).toBe(before);
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文", exact: true })).toBeVisible();
  expect(writes).toEqual([]);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});
