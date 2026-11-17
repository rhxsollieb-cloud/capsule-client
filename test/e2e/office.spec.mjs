import { test, expect, login, selectCap } from "./helpers.mjs";

for (const name of ["测试文档.docx", "测试表格.xlsx"]) {
  test(`${name} 经真实接口加载 Office 集成页面（文档服务替身）`, async ({ page, app }) => {
    await login(page, app);
    await selectCap(page, name);
    const frame = page.frameLocator("#content .onlyoffice-stage iframe");
    await expect(frame.getByRole("heading", { name: "Office 测试替身" })).toBeVisible();
    await expect(frame.locator("#document-title")).toHaveText(name);
    await expect(page.locator("#document-header")).toContainText(name);
  });
}

test("文档服务脚本失败会显示可恢复的错误，重新打开可成功", async ({ page, app }) => {
  app.office.failScript = true;
  await login(page, app);
  await selectCap(page, "测试文档.docx");
  await expect(page.locator("#content .onlyoffice-notice")).toContainText("无法加载ONLYOFFICE编辑器");
  app.office.failScript = false;
  await page.getByRole("button", { name: "文件操作", exact: true }).click();
  await page.getByRole("menuitem", { name: "重新打开当前版本", exact: true }).click();
  await expect(page.frameLocator("#content .onlyoffice-stage iframe").getByRole("heading", { name: "Office 测试替身" })).toBeVisible();
});
