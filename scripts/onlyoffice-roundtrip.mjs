import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";
import { createApplication } from "../../capsule-server/src/application.mjs";
import { ApiClient } from "../src/api/client.mjs";
import { previewOffice } from "../src/preview/office.mjs";

const editorUrl = process.env.CAPSULE_ONLYOFFICE_URL || "http://127.0.0.1:8081";
const secret = process.env.CAPSULE_ONLYOFFICE_JWT_SECRET;
if (!secret || secret.length < 32) throw new Error("需要本机ONLYOFFICE运行环境和共享密钥");
const directory = await mkdtemp(join(tmpdir(), "capsule-onlyoffice-live-"));

function sign(value) {
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ ...value, exp: Math.floor(Date.now() / 1000) + 600 })).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

async function availablePort() {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function convert(url, filetype, outputtype) {
  const source = new URL(url);
  if (source.origin === new URL(editorUrl).origin && source.pathname.startsWith("/cache/files/"))
    url = new URL(source.pathname + source.search, "http://127.0.0.1").href;
  const input = { async: false, url, filetype, outputtype, key: randomUUID(), title: `roundtrip.${outputtype}` };
  const response = await fetch(editorUrl + "/converter", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...input, token: sign(input) }),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  assert.equal(result.endConvert, true, JSON.stringify(result));
  assert.ok(result.fileUrl);
  return result.fileUrl;
}

let app;
try {
  assert.equal(await (await fetch(editorUrl + "/healthcheck")).text(), "true");
  const port = await availablePort();
  const accessToken = randomBytes(32).toString("hex");
  app = createApplication({
    home: join(directory, "server"), port,
    token: accessToken,
    office: { url: editorUrl, jwtSecret: secret, serverUrl: `http://host.lima.internal:${port}` },
  });
  await app.start();
  const api = new ApiClient({ home: join(directory, "client"), serverUrl: app.url, token: accessToken });
  const docx = await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("ONLYOFFICE document round-trip")] }] }));
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Budget");
  sheet.getCell("A1").value = "ONLYOFFICE spreadsheet round-trip";
  sheet.getCell("B2").value = 6350;
  const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
  for (const [name, kind, bytes, intermediate] of [["Roundtrip.docx", "word", docx, "odt"], ["Roundtrip.xlsx", "excel", xlsx, "ods"]]) {
    const created = await api.json("/api/capsules", "POST", { name, kind });
    const file = join(directory, name);
    await writeFile(file, bytes);
    const original = await api.upload(name, undefined, file, created.token);
    const opened = await api.json("/api/office/sessions", "POST", { name, token: original.token });
    const extension = name.split(".").at(-1);
    process.stdout.write(`Converting ${extension} through ${intermediate} with the real document service…\n`);
    const exchanged = await convert(opened.config.document.url, extension, intermediate);
    const output = await convert(exchanged, intermediate, extension);
    const payload = { key: opened.config.document.key, status: 2, url: output, filetype: extension };
    const callback = new URL(opened.config.editorConfig.callbackUrl);
    const response = await fetch(new URL(callback.pathname + callback.search, app.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${sign({ payload })}` },
      body: JSON.stringify(payload),
    });
    const receipt = await response.json();
    assert.equal(receipt.error, 0, JSON.stringify(receipt));
    const saved = await api.json(api.path(name));
    assert.notEqual(saved.commit, original.commit);
    const preview = await previewOffice(api, name);
    if (kind === "word") assert.ok(preview.blocks.some((block) => block.text?.includes("document round-trip")));
    else assert.equal(preview.sheets[0].rows[1][1], "6350");
    const queued = await app.queue.enqueueRevert(name, { commit: original.commit, token: saved.token });
    const deadline = Date.now() + 15000;
    let event;
    do {
      event = app.queue.get(queued.id);
      if (!["pending", "running"].includes(event.status)) break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    } while (Date.now() < deadline);
    assert.equal(event.status, "succeeded", JSON.stringify(event));
    process.stdout.write(`${extension}: real conversion, cap commit and queued revert passed.\n`);
  }
} finally {
  await app?.close();
  await rm(directory, { recursive: true, force: true });
}
