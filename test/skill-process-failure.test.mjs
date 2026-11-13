import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { SkillManager } from "../src/skills/manager.mjs";
import { withClientDatabase } from "../src/storage/database.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

const unavailableUi = `import { createServer } from "node:http";
import { writeSync } from "node:fs";
const server = createServer((_request, response) => { response.writeHead(503); response.end("not ready"); });
server.listen(0, "127.0.0.1", () => writeSync(3, JSON.stringify({ url: "http://127.0.0.1:" + server.address().port + "/" }) + "\\n"));
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;

test("UI就绪失败后优雅退出仍保留failed，退出登记SQL失败追加诊断并隐藏凭据", {
  skip: missingServer, timeout: 30000,
}, async (t) => {
  const fixture = await serverFixture(t);
  let cap = await fixture.application.capsules.create({ name: "失败诊断工具", kind: "code" });
  cap = await fixture.application.capsules.write(cap.name, { token: cap.token, entry: "scripts/ui.mjs", body: unavailableUi });
  const config = { serverUrl: fixture.application.url, token: "integration-only-token", home: fixture.clientHome };
  const manager = new SkillManager(new ApiClient(config));
  try {
    await manager.register(cap.name);
    await withClientDatabase(config.home, (database) => database.exec(`
      CREATE TRIGGER reject_exit_save BEFORE UPDATE ON skill_registrations
      WHEN json_extract(NEW.record_json,'$.lastSession.state') IN ('stopped','failed')
      BEGIN SELECT RAISE(ABORT,'exit registration SQL failure integration-only-token'); END;
    `));
    await assert.rejects(manager.start(cap.name), (error) => {
      assert.equal(error.code, "SKILL_UI_FAILED");
      assert.match(error.message, /HTTP 503/);
      assert.match(error.message, /exit registration SQL failure/);
      assert.equal(error.message.includes(config.token), false);
      return true;
    });
    const session = manager.sessions.get(cap.name);
    await session.exited;
    assert.equal(session.state, "failed");
    assert.match(session.error, /HTTP 503/);
    assert.match(session.error, /exit registration SQL failure/);
    assert.equal(session.error.includes(config.token), false);
    assert.throws(() => process.kill(session.child.pid, 0), { code: "ESRCH" });
    const status = await manager.status(cap.name);
    assert.equal(status.state, "failed");
    assert.equal(status.session.error, session.error);
  } finally { await manager.close(); }
});
