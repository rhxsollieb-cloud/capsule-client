import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseOffice } from "../src/preview/office.mjs";
import { writeOffice } from "../src/office/write.mjs";
import { prefixedExcelBuffer } from "./officeFixture.mjs";

const fingerprint = (buffer) => createHash("sha256").update(buffer).digest("hex");

test("合法SpreadsheetML命名空间前缀由SheetJS兼容预览，原件保持不变", async () => {
  const source = prefixedExcelBuffer();
  const before = fingerprint(source);
  const preview = await parseOffice(source, "excel");
  assert.equal(preview.writeSupported, false);
  assert.deepEqual(preview.sheets[0].rows, [["项目", "金额"], ["摄影", "1200"]]);
  assert.equal(preview.truncated, false);
  assert.equal(fingerprint(source), before);
});

test("兼容只读原件不经SheetJS重新导出，不上传、不改变token或字节", async () => {
  const source = prefixedExcelBuffer();
  const before = fingerprint(source);
  let uploads = 0;
  const api = new ApiClient({ serverUrl: "http://backend.invalid" }, async (url, init) => {
    if (init.method === "PUT") uploads++;
    if (new URL(url).pathname.endsWith("/content")) return new Response(source);
    return Response.json({ name: "前缀.xlsx", commit: "original-commit", token: "original-token" });
  });
  await assert.rejects(writeOffice(api, "前缀.xlsx", {
    token: "original-token",
    changes: { cells: [{ sheet: "预算", cell: "B2", value: 2400 }] },
  }), { status: 415 });
  assert.equal(uploads, 0);
  assert.equal(fingerprint(source), before);
});
