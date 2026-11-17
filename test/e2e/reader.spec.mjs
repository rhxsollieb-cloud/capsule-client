import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, expect, login, selectCap } from "./helpers.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVrkAAAAASUVORK5CYII=", "base64");

async function book(app, body) {
  const name = `全文阅读-${randomUUID()}.md`;
  let cap = await app.api.json("/api/capsules", "POST", { name, kind: "markdown" });
  await mkdir(app.home, { recursive: true });
  const textFile = join(app.home, "reader-source.md");
  const imageFile = join(app.home, "reader-source.png");
  await writeFile(textFile, body);
  await writeFile(imageFile, png);
  cap = await app.api.upload(name, "README.md", textFile, cap.token);
  cap = await app.api.upload(name, "assets/first.png", imageFile, cap.token);
  cap = await app.api.upload(name, "assets/last.png", imageFile, cap.token);
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  return cap;
}

test("超过1MiB的完整书稿按段阅读真实配图，跨页目录可到末章且不会保存半本", async ({ page, app }) => {
  const table = ["<table><tbody>", ...Array.from({ length: 260 }, (_, index) => `<tr><td>完整表格第${index + 1}行</td></tr>`), "</tbody></table>"].join("\n");
  const paragraphs = Array.from({ length: 2200 }, (_, index) => `第${index + 1}段。${"叙事与镜头设计".repeat(30)}。\n\n`).join("");
  const body = `# 书稿第一章\n\n[跳到末章](#last-chapter)\n\n![首章配图](assets/first.png)\n\n${table}\n\n# 书稿第二章\n\n${paragraphs}<a id="last-chapter"></a>\n\n# 书稿末章\n\n![末章配图](assets/last.png)\n\n全文终点。\n`;
  expect(Buffer.byteLength(body)).toBeGreaterThan(1024 * 1024);
  const cap = await book(app, body);
  const requests = [];
  const saves = [];
  page.on("request", (request) => {
    if (request.url().includes("/ui/content")) requests.push(request.url());
    if (request.url().endsWith("/ui/action") && ["save", "save-details", "write"].includes(request.postDataJSON()?.action)) saves.push(request.postDataJSON());
  });
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const content = page.locator("#content");
  await expect(content.getByRole("heading", { name: "书稿第一章", exact: true })).toBeVisible();
  await expect(content.locator("table tr")).toHaveCount(260);
  await expect(content.locator("img")).toHaveCount(1);
  await expect.poll(() => content.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  expect(requests.some((url) => new URL(url).searchParams.get("entry") === "assets/last.png")).toBe(false);
  await expect(page.getByRole("button", { name: "占用并编辑", exact: true })).toBeHidden();
  await content.getByRole("button", { name: "下一段", exact: true }).click();
  await expect(content.getByRole("heading", { name: "书稿第二章", exact: true })).toBeVisible();
  await expect(content.locator("table")).toHaveCount(0);
  await content.getByRole("button", { name: "上一段", exact: true }).click();
  await expect(content.locator("table tr")).toHaveCount(260);
  await content.getByRole("link", { name: "跳到末章", exact: true }).click();
  await expect(content.getByRole("heading", { name: "书稿末章", exact: true })).toBeVisible();
  const last = content.getByRole("img", { name: "末章配图", exact: true });
  await expect(last).toBeVisible();
  await expect.poll(() => last.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(content).toContainText("全文终点。");
  await expect(content.locator("img")).toHaveCount(1);
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "完整载入以编辑", exact: true }).click();
  await expect(content.getByRole("status")).toContainText("全文超过在线编辑提交大小");
  await expect(content.locator("textarea.text-editor")).toHaveCount(0);
  expect(saves).toEqual([]);
  expect((await app.api.json(app.api.path(cap.name))).commit).toBe(cap.commit);
  const original = await app.api.response(app.api.path(cap.name, "content", { entry: "README.md" }));
  expect(await original.text()).toBe(body);
});

test("书稿安全HTML表格与锚点正常呈现，raw脚本和外源媒体不进入页面", async ({ page, app }) => {
  const body = '# 安全书稿\n\n<table onclick="window.__bookUnsafe=1"><tr><td>安全表格内容</td></tr></table>\n\n<a id="inside-book"></a>\n\n[书内锚点](#inside-book)\n\n<img src="https://example.invalid/leak.png" onerror="window.__bookUnsafe=1">\n\n<script>window.__bookUnsafe=1</script>\n\n<iframe src="https://example.invalid/frame"></iframe>\n\n<form action="https://example.invalid/post"><input></form>\n\n![受管配图](assets/first.png)\n';
  const cap = await book(app, body);
  const external = [];
  page.on("request", (request) => { if (request.url().startsWith("https://example.invalid/")) external.push(request.url()); });
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  const article = page.locator("#content article");
  await expect(article.locator("table")).toHaveCount(1);
  await expect(article.locator("td")).toHaveText("安全表格内容");
  await expect(article.locator('a[id="inside-book"]')).toHaveCount(1);
  await expect(article.locator("script, iframe, form, input, [onclick], [onerror]")).toHaveCount(0);
  await expect(article.locator("img")).toHaveCount(1);
  await expect.poll(() => article.locator("img").evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await article.getByRole("link", { name: "书内锚点", exact: true }).click();
  expect(await page.evaluate(() => globalThis.__bookUnsafe)).toBeUndefined();
  expect(external).toEqual([]);
});

test("分页的小文档明确完整载入后才能编辑，保存保留末段正文", async ({ page, app }) => {
  const body = "# 分段文档\n\n" + Array.from({ length: 300 }, (_, index) => `第${index + 1}段需要完整保留。\n\n`).join("") + "# 末段标记\n\n正文末尾不能丢失。\n";
  const cap = await book(app, body);
  await login(page, app, app.editor);
  await selectCap(page, cap.name);
  await expect(page.locator("#content .paged-reader")).toBeVisible();
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "完整载入以编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  await expect(editor).toHaveValue(body);
  const updated = body.replace("# 分段文档", "# 完整编辑后的文档");
  await editor.fill(updated);
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "完整编辑后的文档", exact: true })).toBeVisible();
  await expect(page.locator("#content").getByRole("heading", { name: "末段标记", exact: true })).toBeVisible();
  const record = await app.api.json(app.api.path(cap.name, "read", { entry: "README.md", limit: 10000 }));
  expect(record.body).toBe(updated);
  expect(record.lines.truncated).toBe(false);
});
