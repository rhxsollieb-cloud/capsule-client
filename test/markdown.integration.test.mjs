import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("Markdown经CLI使用README与自有附件，同步精确目录提交且保留原text", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { directory, cli } = await serverFixture(t);
  const body = join(directory, "source.md");
  await writeFile(body, "# 目录手册\n\n![参考](assets/参考.png)\n");
  const markdown = await cli("create", "目录手册.md", "--kind", "markdown", "--body", body);
  const ordinary = await cli("create", "平铺正文.md", "--kind", "text", "--body", body);
  assert.equal((await cli("read", markdown.name)).entry, "README.md");
  assert.equal((await stat(join(directory, "server", "capsules", markdown.name))).isDirectory(), true);
  assert.equal((await stat(join(directory, "server", "capsules", ordinary.name))).isFile(), true);
  const image = join(directory, "reference.png");
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]);
  await writeFile(image, bytes);
  const attached = await cli("put", markdown.name, "assets/参考.png", image, "--token", markdown.token);
  const synchronized = await cli("sync", markdown.name);
  assert.equal(synchronized.kind, "markdown");
  assert.equal(synchronized.commit, attached.commit);
  assert.equal(await readFile(join(synchronized.repository, "README.md"), "utf8"), await readFile(body, "utf8"));
  assert.deepEqual(await readFile(join(synchronized.repository, "assets", "参考.png")), bytes);
  assert.equal(existsSync(join(synchronized.repository, "cap.json")), false);
  assert.equal(existsSync(join(synchronized.repository, "说明.md")), false);
  await writeFile(body, "# 修订手册\n");
  const updated = await cli("write", markdown.name, "--body", body, "--token", attached.token);
  const next = await cli("sync", markdown.name);
  assert.equal(next.commit, updated.commit);
  assert.equal(await readFile(join(next.repository, "README.md"), "utf8"), "# 修订手册\n");
  assert.deepEqual(await readFile(join(next.repository, "assets", "参考.png")), bytes);
  assert.equal((await cli("stat", ordinary.name)).commit, ordinary.commit);
});
