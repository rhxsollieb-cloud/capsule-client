import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { applyEdits, prepareEdits } from "../src/operations/edit-plan.mjs";
import { patchText, readPatchPlan, validatePatchItems } from "../src/operations/text-patch.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

test("四条CLI命令完成父节点改名、移树和多处原文修改", { skip: missingServer, timeout: 30000 }, async (t) => {
  const { directory, application, cli } = await serverFixture(t);
  const workflow = "创作工作流.md", previous = "创作产品信息.md", name = "产品信息.md";
  const oldPath = `/${workflow}/${previous}`, path = "/" + name;
  const original = "\uFEFF# 创作产品信息\r\n\r\n保留原件格式\r\n";
  const navigation = `# V1\r\n见子目录。\r\n\r\n链接：\r\n${oldPath}/产品A.txt\r\n`;
  await application.capsules.create({ name: workflow, kind: "markdown", body: navigation });
  const parent = await application.capsules.create({ name: previous, kind: "markdown", body: original });
  const child = await application.capsules.create({ name: "产品A.txt", body: "原始产品资料" });
  application.mounts.mount({ name: workflow, path: "/" + workflow });
  application.mounts.mount({ name: previous, path: oldPath });
  application.mounts.mount({ name: child.name, path: `${oldPath}/${child.name}` });
  const renamePlan = join(directory, "改名计划.json"), editPlan = join(directory, "正文计划.json"), manifest = join(directory, "更新清单.json");
  await writeFile(manifest, JSON.stringify([
    { name, replacements: [{ oldText: "# 创作产品信息", newText: "# 产品信息" }] },
    { name: workflow, entry: "README.md", replacements: [
      { oldText: "见子目录。", newText: "见顶层共用资料。", expected: 1 },
      { oldText: `链接：\n${oldPath}`, newText: `链接：\n${path}` },
    ] },
  ]));

  await cli("rename", oldPath, name, "--into", "/", "--dry-run", "--out", renamePlan);
  const renamed = await cli("rename", "--plan", renamePlan);
  await cli("edit", "--prepare", manifest, "--out", editPlan);
  const edited = await cli("edit", "--plan", editPlan);

  assert.equal(renamed.path, path);
  assert.deepEqual(renamed.movedPositions.map(({ path }) => path), [path, `${path}/${child.name}`]);
  assert.equal(application.mounts.position(path).items.length, 2);
  assert.equal(application.queue.get(renamed.eventId).status, "succeeded");
  assert.equal((await application.capsules.stat(name, { commit: parent.commit })).name, previous);
  assert.equal((await application.capsules.stat(child.name)).commit, child.commit);
  assert.equal(edited.status, "succeeded");
  assert.deepEqual(edited.items.map(({ status, matches }) => [status, matches.map((item) => item.matches)]), [["applied", [1]], ["applied", [1, 1]]]);
  for (const [checkName, expected] of [[name, original.replace("# 创作产品信息", "# 产品信息")],
    [workflow, navigation.replace("见子目录。", "见顶层共用资料。").replace(oldPath, path)]]) {
    const raw = join(directory, `${checkName}.out`);
    await cli("get", checkName, "README.md", raw);
    assert.deepEqual(await readFile(raw), Buffer.from(expected));
  }
  assert.equal((await application.capsules.history(name, { limit: 10 })).total, 3);
  assert.equal((await application.capsules.history(workflow, { limit: 10 })).total, 2);
});

test("任何原版本在提交前失效时，整份正文计划停在写入前并返回回执", { skip: missingServer, timeout: 30000 }, async (t) => {
  const { directory, application, cli } = await serverFixture(t);
  const first = await application.capsules.create({ name: "第一.txt", body: "原文" });
  const second = await application.capsules.create({ name: "第二.txt", body: "原文" });
  const manifest = join(directory, "内容.json"), plan = join(directory, "预演.json"), receipt = join(directory, "回执.json");
  await writeFile(manifest, JSON.stringify([first, second].map(({ name }) => ({ name, replacements: [{ oldText: "原文", newText: "计划结果" }] }))));
  await cli("edit", "--prepare", manifest, "--out", plan);
  await application.capsules.write(second.name, { token: second.token, body: "其他同事的修改" });
  await assert.rejects(cli("edit", "--plan", plan, "--out", receipt), { code: 1 });
  const result = JSON.parse(await readFile(receipt, "utf8"));
  assert.equal(result.error.code, "VERSION_CONFLICT");
  assert.deepEqual(result.items.map((item) => item.status), ["skipped", "failed"]);
  assert.equal((await application.capsules.stat(first.name)).token, first.token);
  assert.equal((await application.capsules.read(second.name)).body, "其他同事的修改");
});

test("正文计划按照原文匹配，拒绝重叠、错误匹配数和重复cap", () => {
  const first = { oldText: "条目", newText: "资料", expected: 1 };
  assert.equal(patchText("条目条目", [first]).blockedBy, "MATCH_COUNT_CHANGED");
  assert.equal(patchText("起始条目", [first, { oldText: "始条", newText: "目录", expected: 1 }]).blockedBy, "OVERLAPPING_MATCHES");
  assert.equal(patchText("条目与资料", [first, { oldText: "资料", newText: "记录", expected: 1 }]).body, "资料与记录");
  assert.throws(() => validatePatchItems(["A.txt", "a.txt"].map((name) => ({ name, replacements: [first] }))), /一个原件/);
});

test("正文计划防止篡改，提交时遇到新占用会报告已完成和未写入项目", async () => {
  const originalCommit = "1".repeat(40), originalToken = "2".repeat(64);
  const receipt = { commit: "3".repeat(40), token: "4".repeat(64), eventId: "event-a" };
  const writes = [];
  const api = {
    path: (name) => name,
    json: async (name) => ({ name, kind: "text", commit: originalCommit, token: originalToken }),
    response: async () => new Response("旧", { headers: { "X-Capsule-Commit": originalCommit, "X-Capsule-Token": originalToken } }),
    putText: async (name, _entry, _body, token) => {
      assert.equal(token, originalToken);
      writes.push(name);
      if (name === "二.txt") throw Object.assign(new Error("正在编辑"), { code: "EDIT_BUSY", status: 423 });
      return { name, ...receipt };
    },
  };
  const items = validatePatchItems(["一.txt", "二.txt", "三.txt"].map((name) => ({ name, replacements: [{ oldText: "旧", newText: "新" }] })));
  const prepared = await prepareEdits(api, items);
  const tampered = structuredClone(prepared);
  tampered.plan.items[0].replacements[0].newText = "其它";
  assert.throws(() => readPatchPlan(tampered), /已被修改/);
  const result = await applyEdits(api, readPatchPlan(prepared));
  assert.deepEqual(writes, ["一.txt", "二.txt"]);
  assert.deepEqual(result.items.map(({ status }) => status), ["applied", "failed", "skipped"]);
  assert.equal(result.items[0].eventId, receipt.eventId);
  assert.equal(result.error.code, "EDIT_BUSY");
});
