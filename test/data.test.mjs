import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dispatch } from "../src/cli.mjs";
import { parseArguments } from "../src/commands/arguments.mjs";

function client(calls) {
  return {
    path: (name, operation = "", query = {}) => ({ name, operation, query }),
    json: async (path, method = "GET", body) => {
      calls.push({ path, method, body });
      return { path, method, body };
    },
    query: (path, values) => ({ path, values }),
  };
}

test("类别和统一查询参数在CLI入口正确传递", async () => {
  const calls = [];
  const api = client(calls);
  await dispatch(parseArguments(["create", "记录", "--kind", "database"]), api);
  assert.equal(calls[0].body.kind, "database");
  await dispatch(parseArguments([
    "query", "记录", "--sql", "SELECT ? AS value", "--params", "[7]", "--limit", "2",
  ]), api);
  assert.deepEqual(calls[1].body, { sql: "SELECT ? AS value", parameters: [7], limit: 2 });
  await dispatch(parseArguments(["query", "代码", "--text", "function", "--entry", "main.mjs"]), api);
  assert.deepEqual(calls[2].body, { text: "function", entry: "main.mjs" });
  assert.throws(() => parseArguments(["create", "日志", "--kind", "log"]), /类别/u);
  assert.throws(() => parseArguments(["query", "数据", "--sql", "SELECT 1", "--text", "x"]), /不能同时/u);
  await assert.rejects(
    dispatch(parseArguments(["query", "记录", "--sql", "SELECT 1", "--params", "null"]), api),
    /数组或参数对象/u,
  );
});

test("SQLite批量写和文本写共用write接口并要求当前token", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "capsule-data-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = join(directory, "statements.json");
  const body = join(directory, "body.md");
  const statements = [{ sql: "CREATE TABLE notes (body TEXT)" }, { sql: "INSERT INTO notes VALUES (?)", parameters: ["内容"] }];
  await writeFile(plan, JSON.stringify(statements));
  await writeFile(body, "正文内容");
  const calls = [];
  const api = client(calls);
  await dispatch(parseArguments(["write", "数据", "--file", plan, "--token", "current"]), api);
  assert.equal(calls[0].path.operation, "write");
  assert.deepEqual(calls[0].body, { token: "current", statements });
  await dispatch(parseArguments(["write", "正文", "--entry", "说明.md", "--body", body, "--token", "next"]), api);
  assert.deepEqual(calls[1].body, { token: "next", entry: "说明.md", body: "正文内容" });
  assert.throws(() => parseArguments(["write", "数据", "--sql", "SELECT 1"]), /token/u);
  assert.throws(() => parseArguments(["write", "数据", "--sql", "SELECT 1", "--file", plan, "--token", "x"]), /中的一项/u);
});

test("run分隔符之后的help和log-cap原样交给工具", () => {
  const parsed = parseArguments(["run", "工具", "--log-cap", "数据库", "--", "--help", "--log-cap", "原参数"]);
  assert.equal(parsed.values["log-cap"], "数据库");
  assert.deepEqual(parsed.runtimeArgs, ["--help", "--log-cap", "原参数"]);
});
