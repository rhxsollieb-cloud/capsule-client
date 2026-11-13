import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execute = promisify(execFile);
const root = fileURLToPath(new URL("../examples/quote-skill/", import.meta.url));
const cli = join(root, "scripts", "cli.mjs");

function environment(directory) {
  const value = { ...process.env };
  if (directory) value.CAPSULE_SKILL_STATE = directory;
  else delete value.CAPSULE_SKILL_STATE;
  return value;
}

async function run(directory, ...args) {
  const result = await execute(process.execPath, [cli, ...args], { env: environment(directory) });
  return JSON.parse(result.stdout);
}

async function stateDirectory(t) {
  const directory = await mkdtemp(join(tmpdir(), "quote-skill-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

async function startUi(t, directory) {
  const child = spawn(process.execPath, [join(root, "scripts", "ui.mjs")], {
    env: { ...environment(directory), CAPSULE_SKILL_READY_FD: "3" },
    stdio: ["ignore", "ignore", "pipe", "pipe"],
  });
  let diagnostic = "";
  child.stderr.setEncoding("utf8").on("data", (chunk) => { diagnostic += chunk; });
  const closed = once(child, "close");
  t.after(async () => { if (child.exitCode === null) child.kill("SIGTERM"); await closed; });
  const ready = await new Promise((resolve, reject) => {
    let text = "";
    const timeout = setTimeout(() => reject(new Error(`界面启动超时：${diagnostic}`)), 5000);
    child.stdio[3].setEncoding("utf8").on("data", (chunk) => {
      text += chunk;
      if (!text.includes("\n")) return;
      clearTimeout(timeout);
      try { resolve(JSON.parse(text.split("\n")[0])); } catch (error) { reject(error); }
    });
    child.once("error", (error) => { clearTimeout(timeout); reject(error); });
    child.once("exit", () => { clearTimeout(timeout); reject(new Error(`界面提前退出：${diagnostic}`)); });
  });
  return ready.url;
}

test("独立报价 CLI 明确要求外部状态目录，精确计算并拒绝旧版本", async (t) => {
  const directory = await stateDirectory(t);
  assert.equal((await run(undefined, "--help")).name, "quote-skill");
  await assert.rejects(run(undefined, "state"), (error) => error.code !== 0 && error.stderr.includes("STATE_REQUIRED"));
  await assert.rejects(run(root, "state"), (error) => error.stderr.includes("STATE_LOCATION"));
  const initial = await run(directory, "state");
  const saved = await run(directory, "set", "3", "0.10", "--version", String(initial.version));
  assert.equal(saved.amount, "0.30");
  assert.equal(saved.unitPrice, "0.10");
  assert.equal(saved.version, initial.version + 1);
  await assert.rejects(run(directory, "set", "7", "12.50", "--version", String(initial.version)),
    (error) => error.stderr.includes("VERSION_CONFLICT"));
  await assert.rejects(run(directory, "set", "1.5", "10"));
  assert.deepEqual(await run(directory, "state"), saved);
  assert.ok((await readdir(directory)).includes("state.sqlite"));
});

test("随机本机界面与独立 CLI 共享 SQLite，旧 UI 写入不能覆盖新报价", async (t) => {
  const directory = await stateDirectory(t);
  const url = await startUi(t, directory);
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  const initial = await (await fetch(url + "api/state")).json();
  const fromCli = await run(directory, "set", "20", "99.95");
  assert.deepEqual(await (await fetch(url + "api/state")).json(), fromCli);
  const stale = await fetch(url + "api/state", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(url).origin },
    body: JSON.stringify({ quantity: 1, unitPrice: "1.00", version: initial.version }),
  });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, "VERSION_CONFLICT");
  assert.deepEqual(await run(directory, "state"), fromCli);
  const fresh = await fetch(url + "api/state", {
    method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(url).origin },
    body: JSON.stringify({ quantity: 5, unitPrice: "9.90", version: fromCli.version }),
  });
  assert.equal(fresh.status, 200);
  const fromUi = await fresh.json();
  assert.equal(fromUi.amount, "49.50");
  assert.deepEqual(await run(directory, "state"), fromUi);
  assert.equal((await fetch(url + "api/state", { headers: { Origin: "https://unrelated.example" } })).status, 403);
  const rejectedHost = await new Promise((resolve, reject) => {
    const request = httpRequest(url + "api/state", { headers: { Host: "unrelated.example" } }, (response) => {
      response.resume();
      response.once("end", () => resolve(response.statusCode));
    });
    request.once("error", reject);
    request.end();
  });
  assert.equal(rejectedHost, 403);
  for (const path of ["", "app.mjs", "style.css"]) assert.equal((await fetch(url + path)).status, 200);
});

test("界面轮询同步新报价，但保留未提交输入及保存期间继续输入", async (t) => {
  const previous = globalThis.document;
  const elements = new Map();
  for (const id of ["quote-form", "quantity", "unit-price", "amount", "status", "save", "notice", "message", "reload"])
    elements.set(id, {
      value: "", listeners: {},
      addEventListener(type, listener) { this.listeners[type] = listener; },
      emit(type) { return this.listeners[type]({ preventDefault() {} }); },
    });
  globalThis.document = { getElementById: (id) => elements.get(id) };
  t.after(() => { if (previous === undefined) delete globalThis.document; else globalThis.document = previous; });
  let poll;
  let pendingSave;
  let posted;
  let current = { quantity: 12, unitPrice: "199.00", amount: "2388.00", version: 1, updatedAt: new Date().toISOString() };
  t.mock.method(globalThis, "setInterval", (handler) => { poll = handler; return 0; });
  t.mock.method(globalThis, "fetch", async (_url, options = {}) => {
    if (options.method !== "POST") return Response.json(current);
    posted = JSON.parse(options.body);
    if (posted.version !== current.version) return Response.json({ error: "报价已更新" }, { status: 409 });
    return new Promise((resolve) => {
      pendingSave = () => {
        current = { ...current, ...posted, version: current.version + 1 };
        resolve(Response.json(current));
      };
    });
  });
  await import(new URL("../examples/quote-skill/assets/app.mjs", import.meta.url));
  const quantity = elements.get("quantity");
  const price = elements.get("unit-price");
  const form = elements.get("quote-form");
  current = { ...current, quantity: 4, unitPrice: "2.50", version: 2 };
  await poll();
  assert.equal(quantity.value, "4");
  assert.equal(price.value, "2.50");
  quantity.value = "7";
  quantity.emit("input");
  current = { ...current, quantity: 8, unitPrice: "3.00", version: 3 };
  await poll();
  assert.equal(quantity.value, "7");
  assert.equal(price.value, "2.50");
  assert.equal(elements.get("notice").hidden, false);
  await form.emit("submit");
  assert.equal(posted.version, 2);
  assert.equal(quantity.value, "7");
  assert.equal(current.quantity, 8);
  elements.get("reload").emit("click");
  assert.equal(quantity.value, "8");
  quantity.value = "9";
  quantity.emit("input");
  const saving = form.emit("submit");
  quantity.value = "10";
  quantity.emit("input");
  pendingSave();
  await saving;
  assert.equal(current.quantity, 9);
  assert.equal(quantity.value, "10");
  assert.equal(elements.get("status").textContent, "未保存");
  assert.equal(elements.get("save").disabled, false);
});
