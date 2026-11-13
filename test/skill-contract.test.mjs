import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { parseSkill as clientParse, SKILL_DOCUMENT, CLI_ENTRY, UI_ENTRY } from "../src/skills/format.mjs";
import { missingServer } from "./serverFixture.mjs";

test("独立仓库的Skill协议使用相同入口与frontmatter边界", { skip: missingServer }, async () => {
  const serverRoot = process.env.CAPSULE_SERVER_ROOT || resolve(import.meta.dirname, "../../capsule-server");
  const server = await import(pathToFileURL(resolve(serverRoot, "src/skills/format.mjs")).href);
  assert.deepEqual([SKILL_DOCUMENT, CLI_ENTRY, UI_ENTRY], [server.SKILL_DOCUMENT, server.CLI_ENTRY, server.UI_ENTRY]);
  const inputs = [
    "---\nname: example\ndescription: A concrete purpose.\n---\nRead this when needed.",
    "--- \t\r\nname: '  example-name  '\r\ndescription: >-\r\n  Read files and\r\n  report sizes.\r\nmetadata:\r\n  scope: local\r\n--- \t\r\n",
    "---\nname: test\nname: other\ndescription: purpose\n---\n",
    "---\nname: A_BAD_NAME\ndescription: purpose\n---\n",
    "---\nname: test\ndescription: '[TODO: fill this]'\n---\n",
    "---\nname: &id test\ndescription: *id\n---\n",
    "---\nname: test\ndescription: '<html>'\n---\n",
    "# No frontmatter", "\0", "---\nname: test\ndescription: x\n---\n" + "x".repeat(1024 * 1024),
  ];
  for (const input of inputs) {
    let client;
    let service;
    try { client = { accepted: true, ...clientParse(input) }; } catch { client = { accepted: false }; }
    try { const parsed = server.parseSkill(input); service = { accepted: true, name: parsed.name, description: parsed.description }; } catch { service = { accepted: false }; }
    assert.deepEqual(client, service);
  }
});
