import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("CLI流式导入大Markdown与长Unicode图片路径，整目录只形成一次初始提交", { skip: missingServer, timeout: 90000 }, async (t) => {
  const { application, directory, clientHome } = await serverFixture(t);
  const source = join(directory, "book source");
  await mkdir(join(source, "assets"), { recursive: true });
  const image = "图".repeat(60) + ".png";
  const body = `# 完整书稿\n\n![原图](assets/${image})\n\n` + ("书稿正文".repeat(40) + "\n\n").repeat(3000);
  await writeFile(join(source, "README.md"), body);
  await writeFile(join(source, "assets", image), Buffer.from("original-image-bytes"));
  let imports = 0;
  const api = new ApiClient({ serverUrl: application.url, token: "integration-only-token", home: clientHome }, (url, init) => {
    if (new URL(url).pathname === "/api/capsules/import") imports++;
    return fetch(url, init);
  });
  const cap = await dispatch(parseArguments(["import", source, "完整书稿.md"]), api);
  assert.equal(imports, 1);
  assert.equal(cap.kind, "markdown");
  assert.equal((await api.json(api.path(cap.name, "history"))).items.length, 1);
  const page = await api.json(api.path(cap.name, "read", { entry: "README.md", from: 1, limit: 20 }));
  assert.match(page.body, /完整书稿/);
  assert.equal(page.lines.truncated, true);
  const original = await api.response(api.path(cap.name, "content", { entry: "README.md" }));
  assert.equal(await original.text(), body);
  const media = await api.response(api.path(cap.name, "content", { entry: "assets/" + image }));
  assert.equal(await media.text(), "original-image-bytes");
  assert.equal((await api.json(api.query("/api/mounts", { path: "/" }))).items.length, 0);
  await assert.rejects(dispatch(parseArguments(["import", source, cap.name]), api), (error) => error.status === 409);
  assert.equal((await api.json(api.path(cap.name))).token, cap.token);
});

test("CLI导入实际Skill目录时验证但不执行代码", { skip: missingServer, timeout: 90000 }, async (t) => {
  const { application, directory, clientHome } = await serverFixture(t);
  const api = new ApiClient({ serverUrl: application.url, token: "integration-only-token", home: clientHome });
  const template = await api.json("/api/capsules", "POST", { name: "Skill模板", kind: "code" });
  const skill = await api.json(api.path(template.name, "read", { entry: "SKILL.md" }));
  const source = join(directory, "skill");
  await mkdir(join(source, "scripts"), { recursive: true });
  await writeFile(join(source, "SKILL.md"), skill.body);
  await writeFile(join(source, "scripts", "cli.mjs"), 'throw new Error("导入不得执行此CLI");\n');
  const cap = await dispatch(parseArguments(["import", source, "已导入Skill", "--kind", "code"]), api);
  assert.equal(cap.kind, "code");
  assert.equal((await api.json(api.path(cap.name, "read", { entry: "scripts/cli.mjs" }))).body, 'throw new Error("导入不得执行此CLI");\n');
  assert.equal((await api.json(api.path(cap.name, "history"))).items.length, 1);
});
