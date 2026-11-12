import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { excelBuffer, wordBuffer } from "./officeFixture.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("Office原件经统一接口上传，CLI和工作台读取同一提交的预览", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { directory, application, clientHome, cli } = await serverFixture(t);
  const config = {
    serverUrl: application.url,
    token: "integration-only-token",
    home: clientHome,
  };
  const api = new ApiClient(config);
  const ui = createUiApplication({ config, port: 0 });
  t.after(() => ui.close());
  await ui.start();
  const session = await (await fetch(ui.url + "/ui/session")).json();
  const preview = async (fields, status = 200) => {
    const response = await fetch(ui.url + "/ui/action", {
      method: "POST",
      headers: {
        Origin: ui.url,
        "Content-Type": "application/json",
        "X-Capsule-Session": session.csrfToken,
      },
      body: JSON.stringify({ action: "preview", ...fields }),
    });
    const result = await response.json();
    assert.equal(response.status, status, JSON.stringify(result));
    return result;
  };

  const documentFile = join(directory, "说明.docx");
  await writeFile(documentFile, wordBuffer());
  const document = await cli("create", "说明.docx", "--kind", "word");
  const uploaded = await api.upload(document.name, undefined, documentFile, document.token);
  const commandResult = await cli("preview", document.name);
  const uiResult = await preview({ name: document.name });
  assert.deepEqual(uiResult, commandResult);
  assert.equal(uiResult.commit, uploaded.commit);
  assert.equal(uiResult.blocks[0].text, "拍摄说明");
  assert.match(uiResult.blocks[1].text, /<script>/);
  assert.equal((await cli("stat", document.name)).token, uploaded.token);

  const sheetFile = join(directory, "预算.xlsx");
  await writeFile(sheetFile, excelBuffer());
  const collection = await cli("create", "资料包", "--kind", "files");
  const sheet = await api.upload(collection.name, "office/预算.xlsx", sheetFile, collection.token);
  const sheetResult = await preview({ name: collection.name, entry: "office/预算.xlsx" });
  assert.deepEqual(sheetResult, await cli("preview", collection.name, "office/预算.xlsx"));
  assert.equal(sheetResult.commit, sheet.commit);
  assert.deepEqual(sheetResult.sheets[0].rows[1], ["摄影", "1200", "2400", "=1+1"]);

  const invalid = await cli("create", "损坏.docx", "--kind", "word");
  assert.match((await preview({ name: invalid.name }, 422)).error, /ZIP/);
  assert.match((await preview({ name: "旧版.xls" }, 415)).error, /docx.*xlsx/);
});
