import { randomUUID } from "node:crypto";
import { dispatch } from "../../src/commands/dispatch.mjs";
import { parseArguments } from "../../src/commands/arguments.mjs";
import { test, expect, login, selectCap } from "./helpers.mjs";

test("CLI新增Skill挂载自动进入已展开目录，未变不重绘并保留人类草稿", async ({ page, app }) => {
  const parent = await app.api.json("/api/capsules", "POST", { name: `同步目录-${randomUUID()}.md`, kind: "markdown", body: "# 同步目录\n" });
  const content = await app.api.json("/api/capsules", "POST", { name: `人类草稿-${randomUUID()}.md`, kind: "markdown", body: "# 原始稿件\n\n尚未提交修改。\n" });
  const skill = await app.api.json("/api/capsules", "POST", { name: `外部新Skill-${randomUUID()}`, kind: "code" });
  await app.api.json("/api/mounts", "POST", { name: parent.name, path: "/" + parent.name });
  const contentPath = `/${parent.name}/${content.name}`;
  await app.api.json("/api/mounts", "POST", { name: content.name, path: contentPath });
  await page.clock.install();
  await page.clock.setFixedTime(new Date());
  await login(page, app, app.editor);
  const parentRow = page.locator("#tree .tree-row").filter({ has: page.getByRole("button", { name: parent.name, exact: true }) });
  await parentRow.getByRole("button", { name: "展开", exact: true }).click();
  await selectCap(page, content.name);
  await page.getByRole("button", { name: "占用并编辑", exact: true }).click();
  const editor = page.locator("#content textarea.text-editor");
  await expect(editor).toBeEditable();
  const draft = "# 我正在编辑的稿件\n\nCLI重新组织目录不能丢失这份草稿。\n";
  await editor.fill(draft);
  await editor.evaluate((element) => { globalThis.__treeEditor = element; });
  await page.evaluate(() => {
    globalThis.__treeMutations = 0;
    const observer = new globalThis.MutationObserver((records) => { globalThis.__treeMutations += records.length; });
    observer.observe(globalThis.document.getElementById("tree"), { childList: true, subtree: true });
    globalThis.__treeObserver = observer;
  });
  const advancePolling = async () => {
    // Let real lease renewals settle between simulated timer advances. Server
    // time remains real; no wall-clock expiry is bypassed or waited out.
    for (let step = 0; step < 6; step++) {
      const renewed = page.waitForResponse((response) => response.url().endsWith("/ui/action")
        && response.request().postDataJSON()?.action === "lease-renew"
        && response.request().postDataJSON()?.name === content.name);
      await page.clock.fastForward(5000);
      await renewed;
    }
  };
  const unchanged = page.waitForResponse((response) => response.url().endsWith("/ui/action")
    && response.request().postDataJSON()?.action === "ls" && response.request().postDataJSON()?.path === "/" + parent.name);
  await advancePolling();
  await unchanged;
  await expect.poll(() => page.evaluate(() => globalThis.__treeMutations)).toBe(0);
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeEditable();
  expect(await editor.evaluate((element) => element === globalThis.__treeEditor)).toBe(true);

  await dispatch(parseArguments(["mount", skill.name, `/${parent.name}/${skill.name}`]), app.api);
  await advancePolling();
  await expect(page.locator("#tree").getByRole("button", { name: skill.name, exact: true })).toBeVisible();
  await expect(parentRow.getByRole("button", { name: "折叠", exact: true })).toBeVisible();
  await expect(page.locator("#tree .tree-row.selected")).toHaveAttribute("data-path", contentPath);
  await expect(editor).toHaveValue(draft);
  await expect(editor).toBeEditable();
  expect(await editor.evaluate((element) => element === globalThis.__treeEditor)).toBe(true);
  expect((await app.api.json(app.api.path(content.name))).commit).toBe(content.commit);
  await page.locator("#document-header").getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.locator("#content").getByRole("heading", { name: "我正在编辑的稿件", exact: true })).toBeVisible();
  expect((await app.api.json(app.api.path(content.name, "read", { entry: "README.md" }))).body).toBe(draft);
  await page.evaluate(() => globalThis.__treeObserver.disconnect());
});
