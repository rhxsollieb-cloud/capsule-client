import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, login, selectCap } from "./helpers.mjs";

async function document(app, paragraphs = 16000) {
  const body = "# 规模阅读起点\n\n[跳到中文末章](#规模末章)\n\n[无此锚点](#不存在的规模锚点)\n\n"
    + Array.from({ length: paragraphs }, (_, index) => `第${index + 1}段。${"长书稿只应读取目标附近的内容。".repeat(3)}\n\n`).join("")
    + '<a id="规模末章"></a>\n\n# 规模阅读末章\n\n正文完整终点。\n';
  let cap = await app.api.json("/api/capsules", "POST", { name: `规模阅读-${randomUUID()}.md`, kind: "markdown" });
  await mkdir(app.home, { recursive: true });
  const file = join(app.home, "scale-source.md");
  await writeFile(file, body);
  cap = await app.api.upload(cap.name, "README.md", file, cap.token);
  await app.api.json("/api/mounts", "POST", { name: cap.name, path: "/" + cap.name });
  return { ...cap, body };
}

function requests(page, name) {
  const reads = [], stats = [], writes = [];
  page.on("request", (request) => {
    if (!request.url().endsWith("/ui/action")) return;
    const value = request.postDataJSON();
    if (value?.name !== name) return;
    if (value.action === "read") reads.push(value);
    if (value.action === "stat") stats.push(value);
    if (["save", "write", "save-details"].includes(value.action)) writes.push(value);
  });
  return { reads, stats, writes };
}

test("超过128页冷跳与中文锚点只取目标附近，来回翻页只重验不重下正文", async ({ page, app }) => {
  const cap = await document(app);
  const activity = requests(page, cap.name);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const content = page.locator("#content");
  const line = page.getByRole("spinbutton", { name: "跳转到行", exact: true });
  const next = page.getByRole("button", { name: "下一段", exact: true });
  const previous = page.getByRole("button", { name: "上一段", exact: true });
  await expect(next).toBeEnabled();
  const total = Number(await line.getAttribute("max"));
  expect(total).toBeGreaterThan(128 * 200);
  let baseline = activity.reads.length;
  await line.fill(String(total));
  await page.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(content.getByRole("heading", { name: "规模阅读末章", exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  expect(activity.reads.length - baseline).toBeLessThanOrEqual(4);
  const lastFrom = Number(await line.inputValue());
  await expect(previous).toBeEnabled();
  baseline = activity.reads.length;
  await previous.click();
  await expect.poll(async () => Number(await line.inputValue())).toBeLessThan(lastFrom);
  await expect(next).toBeEnabled();
  expect(Number(await line.inputValue())).toBeGreaterThan(lastFrom - 500);
  expect(activity.reads.length - baseline).toBeLessThanOrEqual(4);
  baseline = activity.reads.length;
  const stats = activity.stats.length;
  await next.click();
  await expect(line).toHaveValue(String(lastFrom));
  await expect(next).toBeDisabled();
  expect(activity.reads.length).toBe(baseline);
  expect(activity.stats.length).toBeGreaterThan(stats);

  await line.fill("1");
  await page.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(content.getByRole("heading", { name: "规模阅读起点", exact: true })).toBeVisible();
  baseline = activity.reads.length;
  await content.getByRole("link", { name: "跳到中文末章", exact: true }).click();
  await expect(content.getByRole("heading", { name: "规模阅读末章", exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  expect(activity.reads.length - baseline).toBeLessThanOrEqual(4);
  await line.fill("1");
  await page.getByRole("button", { name: "跳转", exact: true }).click();
  await expect(content.getByRole("heading", { name: "规模阅读起点", exact: true })).toBeVisible();
  baseline = activity.reads.length;
  await content.getByRole("link", { name: "跳到中文末章", exact: true }).click();
  await expect(content.getByRole("heading", { name: "规模阅读末章", exact: true })).toBeVisible();
  await expect(next).toBeDisabled();
  expect(activity.reads.length - baseline).toBe(1);
  expect(activity.writes).toEqual([]);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("缓存命中前重新鉴权，撤权后立即清除已显示正文而非离线翻回", async ({ page, app }) => {
  const cap = await document(app, 800);
  const activity = requests(page, cap.name);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const content = page.locator("#content");
  const next = page.getByRole("button", { name: "下一段", exact: true });
  const previous = page.getByRole("button", { name: "上一段", exact: true });
  await expect(next).toBeEnabled();
  await next.click();
  await expect(previous).toBeEnabled();
  const access = await app.api.json(app.api.path(cap.name, "access"));
  await app.api.json(app.api.path(cap.name, "access"), "PUT", { revision: access.revision, permission: "none" });
  const reads = activity.reads.length;
  await previous.click();
  await expect(content).toContainText("当前身份无法访问此正文");
  await expect(content.locator("article")).toHaveCount(0);
  await expect(previous).toBeDisabled();
  await expect(next).toBeDisabled();
  expect(activity.reads.length).toBe(reads);
  expect(activity.writes).toEqual([]);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("缺失锚点及下一段临时失败保留当前段落，重试不丢返回位置", async ({ page, app }) => {
  const cap = await document(app, 800);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const content = page.locator("#content");
  const range = content.locator(".reader-range");
  const next = page.getByRole("button", { name: "下一段", exact: true });
  const previous = page.getByRole("button", { name: "上一段", exact: true });
  await expect(next).toBeEnabled();
  const first = await range.textContent();
  await content.getByRole("link", { name: "无此锚点", exact: true }).click();
  await expect(content.getByRole("status")).toContainText("锚点");
  await expect(range).toHaveText(first);
  await expect(content.getByRole("heading", { name: "规模阅读起点", exact: true })).toBeVisible();
  let rejectOnce = true;
  await page.route("**/ui/action", (route) => {
    const value = route.request().postDataJSON();
    if (rejectOnce && value?.action === "read" && value.name === cap.name && value.from > 1) {
      rejectOnce = false;
      return route.fulfill({ status: 503, json: { error: "下一段暂时不可用" } });
    }
    return route.continue();
  });
  await next.click();
  await expect(content.getByRole("status")).toContainText("下一段暂时不可用");
  await expect(range).toHaveText(first);
  await expect(previous).toBeDisabled();
  await next.click();
  await expect(range).not.toHaveText(first);
  await expect(previous).toBeEnabled();
  await previous.click();
  await expect(range).toHaveText(first);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});

test("只读后台检查发现隐藏权限后无需翻页就清除当前正文", async ({ page, app }) => {
  const cap = await document(app, 800);
  await page.clock.install();
  await page.clock.setFixedTime(new Date());
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const content = page.locator("#content");
  await expect(content.getByRole("heading", { name: "规模阅读起点", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "下一段", exact: true })).toBeEnabled();
  const access = await app.api.json(app.api.path(cap.name, "access"));
  await app.api.json(app.api.path(cap.name, "access"), "PUT", { revision: access.revision, permission: "none" });
  await page.clock.fastForward(5000);
  await expect(content).toContainText("当前身份无法访问此正文");
  await expect(content.locator("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "下一段", exact: true })).toBeDisabled();
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
});
