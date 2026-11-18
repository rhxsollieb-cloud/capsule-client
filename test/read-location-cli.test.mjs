import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../src/commands/arguments.mjs";
import { dispatch } from "../src/commands/dispatch.mjs";
import { performAction } from "../src/ui/actions.mjs";
import { ApiClient } from "../src/api/client.mjs";

test("CLI和前端用同一read定位参数，百万行之外可续读", async () => {
  const calls = [];
  const api = new ApiClient({ serverUrl: "http://example.invalid" }, async (url, init) => {
    calls.push({ url: new URL(url), signal: init.signal }); return Response.json({ body: "目标" });
  });
  await dispatch(parseArguments(["read", "书稿.md", "--around", "2000000"]), api);
  const signal = new AbortController().signal;
  await performAction(api, { action: "read", name: "书稿.md", anchor: "chapter-100" }, { signal });
  await dispatch(parseArguments(["details", "书稿.md", "--around", "2000000"]), api);
  await performAction(api, { action: "details", name: "书稿.md", anchor: "chapter-100" }, { signal });
  assert.equal(calls[0].url.searchParams.get("around"), "2000000");
  assert.equal(calls[1].url.searchParams.get("anchor"), "chapter-100");
  assert.equal(calls[1].signal, signal);
  assert.equal(calls[2].url.searchParams.get("around"), "2000000");
  assert.equal(calls[3].url.searchParams.get("anchor"), "chapter-100");
  assert.equal(parseArguments(["read", "书稿.md", "--from", "2000000"]).values.from, 2000000);
  for (const values of [["--from", "1", "--around", "3"], ["--anchor", "x", "--around", "3"], ["--anchor", ""]])
    assert.throws(() => parseArguments(["read", "书稿.md", ...values]));
});
