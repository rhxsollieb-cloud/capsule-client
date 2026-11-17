import { randomUUID } from "node:crypto";
import { test, expect, login, selectCap } from "./helpers.mjs";

async function createDatabase(app, { secondTable = false } = {}) {
  const name = `表格编辑验证-${randomUUID()}`;
  const cap = await app.api.json("/api/capsules", "POST", {
    name, kind: "database", body: "# 独立数据库编辑测试\n",
  });
  const statements = [
    { sql: "CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL)" },
    { sql: "INSERT INTO contacts VALUES (?,?,?)", parameters: [1, "待核对客户", 2] },
    { sql: "INSERT INTO contacts VALUES (?,?,?)", parameters: [2, "第二位客户", 5] },
  ];
  if (secondTable) statements.push(
    { sql: "CREATE TABLE tasks (id INTEGER PRIMARY KEY, name TEXT NOT NULL, quantity INTEGER NOT NULL)" },
    { sql: "INSERT INTO tasks VALUES (?,?,?)", parameters: [1, "待安排任务", 3] },
  );
  const saved = await app.api.json(app.api.path(name, "write"), "POST", { token: cap.token, statements });
  await app.api.json("/api/mounts", "POST", { name, path: "/" + name });
  return saved;
}

const cell = (page, row, column) => page.locator("#content .tabulator-row").nth(row)
  .locator(`.tabulator-cell[tabulator-field="c${column}"]`);

async function openTable(page, name, rows) {
  await page.locator("#native-navigation").getByRole("button", { name, exact: true }).click();
  await expect(page.locator("#content .database-table-title")).toHaveText(name);
  await expect(page.locator("#content .tabulator-row")).toHaveCount(rows);
}

async function startEditing(page) {
  await page.getByRole("button", { name: "占用并编辑表格", exact: true }).click();
  await expect(page.getByRole("button", { name: "结束编辑", exact: true })).toBeEnabled();
}

async function changeCell(page, row, column, value) {
  const target = cell(page, row, column);
  await target.dblclick();
  const input = target.locator("input");
  await expect(input).toBeEditable();
  await input.fill(value);
  await input.press("Enter");
  await expect(target.locator("input")).toHaveCount(0);
  await expect(target).toHaveText(value);
}

async function rows(app, name, table = "contacts") {
  const result = await app.api.json(app.api.path(name, "query"), "POST", {
    sql: `SELECT id, name, quantity FROM ${table} ORDER BY id`, limit: 50, offset: 0,
  });
  return result.items;
}

async function expectReleased(app, name) {
  await expect.poll(async () => (await app.api.json(app.api.path(name, "lease"))).leases.length,
    { timeout: 5000, message: "结束编辑后应立即释放数据库占用" }).toBe(0);
}

test("SQLite 网格编辑文字和数字，保存后重新打开保留真实值", async ({ page, app }) => {
  const before = await createDatabase(app);
  await login(page, app, app.editor);
  await selectCap(page, before.name);
  await openTable(page, "contacts", 2);
  await expect(cell(page, 0, 1)).toHaveText("待核对客户");
  await startEditing(page);

  // Primary keys identify updates and must remain protected in the grid.
  await cell(page, 0, 0).dblclick();
  await expect(cell(page, 0, 0).locator("input")).toHaveCount(0);
  await changeCell(page, 0, 1, "已确认客户");
  await changeCell(page, 0, 2, "12");
  await expect(page.locator("#content .database-note")).toContainText("1 行未保存");
  await expect(rows(app, before.name)).resolves.toEqual([
    { id: 1, name: "待核对客户", quantity: 2 },
    { id: 2, name: "第二位客户", quantity: 5 },
  ]);

  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
  await expect(page.locator("#content .database-note")).toContainText("只读浏览");
  await expectReleased(app, before.name);
  const persisted = [
    { id: 1, name: "已确认客户", quantity: 12 },
    { id: 2, name: "第二位客户", quantity: 5 },
  ];
  expect(await rows(app, before.name)).toEqual(persisted);
  expect((await app.api.json(app.api.path(before.name))).commit).not.toBe(before.commit);

  await selectCap(page, "工作说明.md");
  await expect(page.locator("#content").getByRole("heading", { name: "测试知识正文" })).toBeVisible();
  await selectCap(page, before.name);
  await openTable(page, "contacts", 2);
  await expect(cell(page, 0, 1)).toHaveText("已确认客户");
  await expect(cell(page, 0, 2)).toHaveText("12");
  await expect(cell(page, 1, 1)).toHaveText("第二位客户");
  expect(await rows(app, before.name)).toEqual(persisted);
});

test("Escape 取消单元格和放弃当前表修改都不写入 SQLite", async ({ page, app }) => {
  const before = await createDatabase(app);
  await login(page, app, app.editor);
  await selectCap(page, before.name);
  await openTable(page, "contacts", 2);
  await startEditing(page);
  const target = cell(page, 0, 1);
  await target.dblclick();
  await target.locator("input").fill("尚未确认的输入");
  await target.locator("input").press("Escape");
  await expect(target.locator("input")).toHaveCount(0);
  await expect(target).toHaveText("待核对客户");
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
  await expect(page.locator("#content .database-note")).not.toContainText("未保存");

  await changeCell(page, 0, 1, "需要放弃的草稿");
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "放弃当前表修改", exact: true }).click();
  await expect(cell(page, 0, 1)).toHaveText("待核对客户");
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
  await expect(page.locator("#content .database-note")).toContainText("只读浏览");
  await expectReleased(app, before.name);
  expect(await rows(app, before.name)).toEqual([
    { id: 1, name: "待核对客户", quantity: 2 },
    { id: 2, name: "第二位客户", quantity: 5 },
  ]);
  expect((await app.api.json(app.api.path(before.name))).commit).toBe(before.commit);
});

test("切换数据表独立保留草稿，放弃一表不会影响另一表保存", async ({ page, app }) => {
  const before = await createDatabase(app, { secondTable: true });
  await login(page, app, app.editor);
  await selectCap(page, before.name);
  await openTable(page, "contacts", 2);
  await startEditing(page);
  await changeCell(page, 0, 1, "客户表未保存草稿");

  await openTable(page, "tasks", 1);
  await expect(cell(page, 0, 1)).toHaveText("待安排任务");
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
  await expectReleased(app, before.name);
  await startEditing(page);
  await changeCell(page, 0, 1, "已安排任务");

  await openTable(page, "contacts", 2);
  await expect(cell(page, 0, 1)).toHaveText("客户表未保存草稿");
  await expect(page.locator("#content .database-note")).toContainText("1 行未保存");
  await expectReleased(app, before.name);
  expect((await rows(app, before.name))[0].name).toBe("待核对客户");
  expect((await rows(app, before.name, "tasks"))[0].name).toBe("待安排任务");
  await page.getByRole("button", { name: "放弃当前表修改", exact: true }).click();
  await expect(cell(page, 0, 1)).toHaveText("待核对客户");
  await expect(page.locator("#content .database-note")).not.toContainText("未保存");
  await openTable(page, "tasks", 1);
  await expect(cell(page, 0, 1)).toHaveText("已安排任务");
  await expect(page.locator("#content .database-note")).toContainText("1 行未保存");
  await startEditing(page);
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await expect(page.locator("#content .database-note")).toContainText("只读浏览");
  await expectReleased(app, before.name);
  expect(await rows(app, before.name, "tasks")).toEqual([{ id: 1, name: "已安排任务", quantity: 3 }]);
  expect((await rows(app, before.name))[0].name).toBe("待核对客户");
  await openTable(page, "contacts", 2);
  await expect(cell(page, 0, 1)).toHaveText("待核对客户");
  await expect(page.getByRole("button", { name: "保存修改", exact: true })).toBeDisabled();
});
