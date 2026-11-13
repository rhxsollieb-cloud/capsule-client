import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("CLI完整文字替换、跨类型详述及位置组织共用真实服务端", { skip: missingServer, timeout: 60000 }, async (t) => {
  const { directory, cli } = await serverFixture(t);
  const bodyFile = join(directory, "body.txt");
  const original = Array.from({ length: 10000 }, (_, i) => `普通行${i}`).join("\n") + "\n旧目标\n最后一行";
  await writeFile(bodyFile, original);
  const document = await cli("create", "正文.txt", "--body", bodyFile);
  const edited = await cli("edit", document.name, "--old-text", "旧目标", "--new-text", "新目标", "--token", document.token);
  assert.equal(edited.replacements, 1);
  const download = join(directory, "完整下载.txt");
  await cli("get", document.name, download);
  assert.equal(await readFile(download, "utf8"), original.replace("旧目标", "新目标"));
  const found = await cli("search", "/", "--kind", "text", "--text", "新目标");
  const match = found.items.find((item) => item.name === document.name);
  assert.ok(match.matches.some((item) => item.line === 10001 && item.text.includes("新目标")));
  assert.ok(found.scanned && Number.isInteger(found.scanned.total));

  const detailsFile = join(directory, "details.txt");
  await writeFile(detailsFile, "旧详述");
  for (const [name, kind] of [["图片.png", "image"], ["记录库", "database"]]) {
    const created = await cli("create", name, "--kind", kind);
    const described = await cli("write-details", name, "--file", detailsFile, "--token", created.token);
    await cli("edit", name, "--old-text", "旧详述", "--new-text", "新详述", "--token", described.token);
    assert.equal((await cli("details", name)).body, "新详述");
  }
  const db = await cli("stat", "记录库");
  await cli("edit", db.name, "说明.md", "--old-text", "新详述", "--new-text", "显式文件详述", "--token", db.token);
  assert.equal((await cli("details", db.name)).body, "显式文件详述");
  const schema = await cli("query", db.name, "--sql", "SELECT name FROM sqlite_schema WHERE name='_cap_files'");
  assert.equal(schema.items[0].name, "_cap_files");

  for (const name of ["主题.md", "归档.md"]) {
    await cli("create", name, "--kind", "markdown");
    await cli("mount", name, "/" + name);
  }
  await cli("mount", document.name, "/主题.md/" + document.name);
  await cli("mount", document.name, "/归档.md/" + document.name);
  const before = await cli("where", document.name);
  assert.equal(before.items.length, 2);
  const state = await cli("organize", "--inspect");
  const planFile = join(directory, "plan.json");
  await writeFile(planFile, JSON.stringify({ version: 1, baseline: state.baseline, operations: [
    { operation: "unmount", path: "/归档.md/" + document.name },
    { operation: "move", path: "/主题.md/" + document.name, to: "/归档.md/" + document.name },
  ] }));
  const dry = await cli("organize", "--plan", planFile, "--dry-run");
  assert.equal(dry.dryRun, true);
  assert.equal((await cli("where", document.name)).items.length, 2);
  const applied = await cli("organize", "--plan", planFile);
  assert.equal(typeof applied.receipt, "string");
  const receipt = await cli("organize", "--receipt", applied.receipt, "--limit", "1");
  assert.equal(receipt.receipt, applied.receipt);
  const after = await cli("where", document.name);
  assert.deepEqual(after.items.map((item) => item.path), ["/归档.md/" + document.name]);
  assert.equal((await cli("stat", document.name)).commit, edited.commit);
  assert.ok(await cli("overview"));
});
