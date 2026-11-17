import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApiClient } from "../src/api/client.mjs";
import { SkillManager } from "../src/skills/manager.mjs";
import { readRegistration } from "../src/skills/registry.mjs";
import { runCapsule } from "../src/runtime/run.mjs";
import { createUiApplication } from "../src/ui/application.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

const cliSource = `import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
const file = join(process.env.CAPSULE_SKILL_STATE, "value.txt");
const [command, value] = process.argv.slice(2);
if (command === "set") await writeFile(file, value);
process.stdout.write(await readFile(file, "utf8"));
`;
const uiSource = `import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { writeSync } from "node:fs";
import { join } from "node:path";
const state = process.env.CAPSULE_SKILL_STATE;
await writeFile(join(state, "ui-started.txt"), String(process.pid));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/set") await writeFile(join(state, "value.txt"), url.searchParams.get("value"));
    response.end(await readFile(join(state, "value.txt"), "utf8").catch(() => "empty"));
  } catch (error) { response.writeHead(500); response.end(error.message); }
});
server.listen(0, "127.0.0.1", () => {
  writeSync(Number(process.env.CAPSULE_SKILL_READY_FD), JSON.stringify({ url: "http://127.0.0.1:" + server.address().port + "/" }) + "\\n");
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

async function skillFixture(t) {
  const fixture = await serverFixture(t);
  const config = { serverUrl: fixture.application.url, token: "integration-only-token", home: fixture.clientHome };
  const api = new ApiClient(config);
  const manager = new SkillManager(api);
  let cap = await fixture.application.capsules.create({ name: "状态工具", kind: "code", description: "供CLI和本机界面共享状态" });
  cap = await fixture.application.capsules.write(cap.name, { token: cap.token, entry: "scripts/cli.mjs", body: cliSource });
  cap = await fixture.application.capsules.write(cap.name, { token: cap.token, entry: "scripts/ui.mjs", body: uiSource });
  return { ...fixture, config, api, manager, cap };
}

async function unreachable(url) {
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }));
}

test("真实注册不执行UI，独立CLI与本机UI共享状态，停止和客户端关闭均回收进程", {
  skip: missingServer, timeout: 60000,
}, async (t) => {
  const { application, config, api, manager, cap } = await skillFixture(t);
  const ui = createUiApplication({ config, api, skills: manager, port: 0 });
  try {
    await ui.start();
    const session = await fetch(ui.url + "/ui/session").then((response) => response.json());
    async function action(actionName, expected = 200) {
      const response = await fetch(ui.url + "/ui/action", {
        method: "POST", headers: { Origin: ui.url, "Content-Type": "application/json", "X-Capsule-Session": session.csrfToken },
        body: JSON.stringify({ action: actionName, name: cap.name }),
      });
      const result = await response.json();
      assert.equal(response.status, expected, JSON.stringify(result));
      return result;
    }
    const registered = await action("skill-register");
    assert.equal(registered.registered, true);
    assert.equal(registered.hasUI, true);
    const record = await readRegistration(config, cap.name);
    assert.equal(existsSync(join(record.state, "ui-started.txt")), false);
    const fromCli = await runCapsule(api, cap.name, ["set", "written-by-cli"]);
    assert.equal(fromCli.exitCode, 0);
    assert.equal(fromCli.stdout, "written-by-cli");
    const running = await action("skill-start");
    assert.equal(running.state, "running");
    assert.equal(await fetch(running.session.url).then((response) => response.text()), "written-by-cli");
    const pid = Number(await readFile(join(record.state, "ui-started.txt"), "utf8"));
    assert.doesNotThrow(() => process.kill(pid, 0));
    await fetch(new URL("set?value=written-by-ui", running.session.url)).then((response) => response.text());
    const fromUi = await runCapsule(api, cap.name, ["get"]);
    assert.equal(fromUi.stdout, "written-by-ui");
    const changed = await application.capsules.update(cap.name, { token: cap.token, description: "服务端已有新版" });
    const refused = await action("skill-register", 409);
    assert.equal(refused.code, "SKILL_UPDATE_PENDING");
    assert.equal((await readRegistration(config, cap.name)).commit, cap.commit);
    const active = await action("skill-status");
    assert.equal(active.updateAvailable, true);
    assert.equal(active.session.url, running.session.url);
    assert.equal(await fetch(running.session.url).then((response) => response.text()), "written-by-ui");
    const stopped = await action("skill-stop");
    assert.equal(stopped.state, "stopped");
    await unreachable(running.session.url);
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const restarted = await action("skill-start");
    assert.equal(restarted.commit, changed.commit);
    assert.equal(await fetch(restarted.session.url).then((response) => response.text()), "written-by-ui");
    const nextPid = Number(await readFile(join(record.state, "ui-started.txt"), "utf8"));
    await ui.close();
    await unreachable(restarted.session.url);
    assert.throws(() => process.kill(nextPid, 0), { code: "ESRCH" });
  } finally { await ui.close(); }
});

test("本机受管work被修改时拒绝启动且保留原文件与注册", {
  skip: missingServer, timeout: 30000,
}, async (t) => {
  const { application, config, manager, cap } = await skillFixture(t);
  try {
    await manager.register(cap.name);
    const record = await readRegistration(config, cap.name);
    const entry = join(record.work, "scripts/cli.mjs");
    const local = "// local edit must remain\n" + await readFile(entry, "utf8");
    await writeFile(entry, local);
    await assert.rejects(manager.start(cap.name), /受管代码有修改/);
    assert.equal(await readFile(entry, "utf8"), local);
    assert.equal((await readRegistration(config, cap.name)).commit, record.commit);
    assert.equal(existsSync(join(record.state, "ui-started.txt")), false);
    await application.capsules.update(cap.name, { token: cap.token, description: "服务端新版本也不能掩盖本地修改" });
    await assert.rejects(manager.start(cap.name), /受管代码有修改/);
    assert.equal(await readFile(entry, "utf8"), local);
    assert.equal((await readRegistration(config, cap.name)).commit, record.commit);
  } finally { await manager.close(); }
});

test("共享home的两个客户端竞争启动同一Skill，只有一个UI并在关闭后迅速释放生命周期锁", {
  skip: missingServer, timeout: 60000,
}, async (t) => {
  const { api, config, manager, cap } = await skillFixture(t);
  const second = new SkillManager(api);
  try {
    const results = await Promise.allSettled([manager.start(cap.name), second.start(cap.name)]);
    assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
    const refusal = results.find((item) => item.status === "rejected").reason;
    assert.ok(["SKILL_BUSY", "SKILL_SESSION_UNKNOWN"].includes(refusal.code));
    const winner = results[0].status === "fulfilled" ? manager : second;
    const other = winner === manager ? second : manager;
    const session = winner.sessions.get(cap.name);
    assert.equal((await readRegistration(config, cap.name)).lastSession.id, session.id);
    await winner.stop(cap.name);
    await unreachable(session.url);
    const restarted = await other.start(cap.name);
    assert.equal(restarted.state, "running");
    assert.notEqual(restarted.session.id, session.id);
  } finally { await Promise.all([manager.close(), second.close()]); }
});


test("snapshot与work同时被修改不能冒充已登记提交", {
  skip: missingServer, timeout: 30000,
}, async (t) => {
  const { config, manager, cap } = await skillFixture(t);
  try {
    await manager.register(cap.name);
    const record = await readRegistration(config, cap.name);
    const local = "// changed in both copies\n" + cliSource;
    await writeFile(join(record.work, "scripts/cli.mjs"), local);
    await writeFile(join(record.snapshot, "scripts/cli.mjs"), local);
    await assert.rejects(manager.start(cap.name), /快照含未提交改动/);
    assert.equal(await readFile(join(record.work, "scripts/cli.mjs"), "utf8"), local);
    assert.equal(existsSync(join(record.state, "ui-started.txt")), false);
  } finally { await manager.close(); }
});

test("启动后的登记失败仍终止已创建UI进程，保留可查询诊断", {
  skip: missingServer, timeout: 30000,
}, async (t) => {
  const { withClientDatabase } = await import("../src/storage/database.mjs");
  const { config, manager, cap } = await skillFixture(t);
  await manager.register(cap.name);
  await withClientDatabase(config.home, (database) => database.exec(`
    CREATE TRIGGER fail_ui_start BEFORE UPDATE ON skill_registrations
    WHEN json_extract(NEW.record_json,'$.lastSession.state')='starting'
    BEGIN SELECT RAISE(ABORT,'injected registration failure'); END;
  `));
  try {
    await assert.rejects(manager.start(cap.name), { code: "SKILL_UI_FAILED" });
    const session = manager.sessions.get(cap.name);
    await session.exited;
    assert.match(session.error, /injected registration failure/);
    assert.throws(() => process.kill(session.child.pid, 0), { code: "ESRCH" });
    assert.equal((await manager.status(cap.name)).session.error, session.error);
    await withClientDatabase(config.home, (database) => database.exec("DROP TRIGGER fail_ui_start"));
    assert.equal((await manager.start(cap.name)).state, "running");
  } finally { await manager.close(); }
});
