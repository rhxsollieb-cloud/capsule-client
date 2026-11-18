import test from "node:test";
import assert from "node:assert/strict";
import { SkillView } from "../web/skill.mjs";
import { Workspace } from "../web/workspace.mjs";

const cap = (name = "工具", commit = "commit-1") => ({ name, commit, kind: "code", token: `${commit}-token` });
const registered = { state: "registered", registered: true, hasUI: true, commit: "commit-1" };
const running = { ...registered, state: "running", session: { url: "http://127.0.0.1:12345/" } };
const settled = () => new Promise((resolve) => setImmediate(resolve));
const command = (view, label) => view.controlsInfo().moreItems.find((item) => item.label === label);

function fixture(t, respond) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  const element = (tag) => {
    const value = {
      tag, children: [], listeners: {}, attributes: {}, className: "",
      append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      querySelectorAll() { return []; },
      contains(target) { return target === this || this.children.some((child) => child.contains(target)); },
      setAttribute(name, content) { this.attributes[name] = content; },
      addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); },
      click() { return Promise.all((this.listeners.click || []).map((listener) => listener({ preventDefault() {} }))); },
    };
    value.classList = {
      contains: (name) => value.className.split(/\s+/).includes(name),
      toggle(name, include) {
        const names = new Set(value.className.split(/\s+/).filter(Boolean));
        if (include ?? !names.has(name)) names.add(name); else names.delete(name);
        value.className = [...names].join(" ");
      },
    };
    return value;
  };
  Object.defineProperty(globalThis, "document", { value: { createElement: element }, configurable: true, writable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, "document", previous); else delete globalThis.document; });
  t.mock.method(SkillView.prototype, "loadManual", async () => {});
  const calls = [], errors = [], ran = [], opened = [];
  t.mock.method(globalThis, "fetch", (_url, options) => {
    const input = JSON.parse(options.body);
    calls.push(input);
    return Promise.resolve(respond(input)).then((value) => value instanceof Response ? value : Response.json(value));
  });
  const container = element("div");
  const options = { isCurrent: () => true, onError: (error) => errors.push(error), onRun: (value) => ran.push(value), onOpenEntry: (entry) => opened.push(entry), onSaved() {} };
  return { container, options, calls, errors, ran, opened };
}

test("选中含前端的Skill自动启动，手动关闭后当前视图保持关闭，状态轮询保留活跃iframe与CLI入口", async (t) => {
  let status = registered;
  const { container, options, calls, ran, opened } = fixture(t, (input) => {
    if (input.action === "skill-start") status = running;
    if (input.action === "skill-stop") status = { ...registered, state: "stopped" };
    return status;
  });
  const view = new SkillView(container, cap(), options);
  await settled();
  assert.deepEqual(calls.map((input) => input.action), ["skill-status","skill-start","skill-status"]);
  assert.ok(command(view, "关闭协作页面"));
  assert.deepEqual(view.wrapper.children, [view.notice, view.stage]);
  assert.equal(view.notice.classList.contains("hidden"), true);
  assert.equal(view.controlsInfo().state, "clean");
  await command(view, "运行 Skill CLI").action();
  await command(view, "查看 SKILL.md").action();
  assert.deepEqual(ran, [view.cap]);
  assert.deepEqual(opened, ["SKILL.md"]);
  await settled();
  const frame = view.stage.children[0];
  assert.equal(frame.tag, "iframe");
  assert.equal(frame.src, running.session.url);
  await view.refresh(cap("工具", "new-server-commit"));
  assert.equal(view.stage.children[0], frame);
  assert.equal(view.controlsInfo().state, "clean");
  assert.equal(calls.filter((input) => input.action === "skill-start").length, 1);
  await command(view, "关闭协作页面").action();
  await settled();
  assert.equal(view.stage.children.includes(frame), false);
  assert.equal(calls.filter((input) => input.action === "skill-stop").length, 1);
  view.destroy();
  await view.refresh();
  assert.equal(calls.filter((input) => input.action === "skill-stop").length, 1);
});

test("启动前的迟到status不能卸载新协作iframe", async (t) => {
  let status = { ...registered, hasUI: false }, delayNext = false, release;
  const { container, options } = fixture(t, (input) => {
    if (input.action === "skill-start") { status = running; return status; }
    if (input.action === "skill-status" && delayNext) { delayNext = false; return new Promise((resolve) => { release = resolve; }); }
    return status;
  });
  const view = new SkillView(container, cap(), options);
  await settled();
  delayNext = true;
  const previous = view.refresh();
  await view.perform("skill-start");
  await settled();
  const frame = view.stage.children[0];
  assert.equal(frame.tag, "iframe");
  release(registered);
  await previous;
  assert.equal(view.stage.children[0], frame);
  assert.equal(view.status.state, "running");
});

test("切换cap卸载旧视图后，晚到status不能覆盖新cap或隐式停服务", async (t) => {
  let release, current = "旧工具";
  const { container, options, calls } = fixture(t, (input) => input.name === "旧工具" ? new Promise((resolve) => { release = resolve; }) : { ...running, session: { url: "http://127.0.0.1:12346/" } });
  const previous = new SkillView(container, cap("旧工具"), { ...options, isCurrent: () => current === "旧工具" });
  current = "新工具";
  previous.destroy();
  const next = new SkillView(container, cap("新工具"), { ...options, isCurrent: () => current === "新工具" });
  await settled();
  const wrapper = container.children[0], frame = next.stage.children[0];
  release(running);
  await settled();
  assert.equal(container.children[0], wrapper);
  assert.equal(next.stage.children[0], frame);
  assert.equal(previous.status, undefined);
  assert.equal(calls.some((input) => ["skill-start", "skill-stop"].includes(input.action)), false);
});

test("Workspace背景load和stat轮询保留Skill闭包、iframe和新版本提示", async (t) => {
  let updated = false;
  const { container, calls, options } = fixture(t, (input) => input.action === "stat" ? cap("工具", "commit-2") : { ...running, updateAvailable: updated });
  const workspace = Object.assign(Object.create(Workspace.prototype), {
    cap: cap(), content: container, mode: "skill", selection: 1, viewRequest: 0,
    onError: options.onError, onRun: options.onRun, inspector: { show() {} }, navigation: { update() {} }, chrome() {},
  });
  await workspace.load();
  await settled();
  const view = workspace.skillView, frame = view.stage.children[0];
  await workspace.load({ background: true });
  await settled();
  assert.equal(view.active(), true);
  assert.equal(workspace.skillView, view);
  assert.equal(view.stage.children[0], frame);
  updated = true;
  await workspace.refresh();
  await settled();
  assert.equal(workspace.skillView, view);
  assert.equal(view.stage.children[0], frame);
  assert.equal(view.status.updateAvailable, true);
  assert.match(view.notice.textContent, /服务端已有新提交/);
  assert.equal(calls.filter((input) => input.action === "skill-status").length, 3);
  assert.equal(calls.some((input) => ["skill-start", "skill-stop"].includes(input.action)), false);
});

test("仅CLI的正常Skill不占额外栏，路径与运行信息由标题菜单按需提供", async (t) => {
  const cli = { command: "node", entry: "scripts/cli.mjs", cwd: "/local/work", state: "/local/state" };
  const { container, options } = fixture(t, () => ({ ...registered, hasUI: false, cli }));
  let changes = 0;
  const view = new SkillView(container, cap(), { ...options, onControlsChanged: () => { changes++; } });
  await settled();
  const controls = view.controlsInfo();
  assert.equal(controls.state, "clean");
  assert.equal(view.notice.classList.contains("hidden"), true);
  assert.deepEqual(view.wrapper.children, [view.notice, view.stage]);
  assert.equal(command(view, "启动协作页面"), undefined);
  assert.equal(command(view, "关闭协作页面"), undefined);
  assert.match(command(view, "CLI 与本机状态").information.values.join("\n"), /CAPSULE_SKILL_STATE=\/local\/state/);
  assert.ok(changes > 0);
});

test("标题菜单反映操作忙碌和异常，过期入口不能操作后来选择", async (t) => {
  let finish;
  const { container, options, calls } = fixture(t, (input) => input.action === "skill-start" ? new Promise((resolve) => { finish = resolve; }) : registered);
  let current = true;
  const view = new SkillView(container, cap(), { ...options, isCurrent: () => current });
  await settled();
  const run = command(view, "运行 Skill CLI"), start = command(view, "启动协作页面");
  assert.equal(start.disabled, true);
  assert.equal(view.controlsInfo().state, "loading");
  assert.equal(view.controlsInfo().statusText, "启动中");
  assert.equal(command(view, "启动协作页面").disabled, true);
  await start.action();
  assert.equal(calls.filter((input) => input.action === "skill-start").length, 1);
  current = false;
  finish(running);
  await settled();
  await run.action();
  await start.action();
  assert.equal(calls.filter((input) => input.action === "skill-start").length, 1);
  assert.equal(view.controlsInfo(), null);
});

test("首次选择未注册Skill使用最新入口，启动失败只尝试一次并给出手动入口", async t => {
  const latest = {state:"unregistered", registered:false, latestHasUI:true};
  const {container,options,calls} = fixture(t, input => input.action === "skill-start"
    ? Response.json({error:"缺少本机依赖"},{status:409}) : latest);
  const view = new SkillView(container,cap(),options);
  await settled();
  await view.refresh();
  assert.equal(calls.filter(x=>x.action==="skill-start").length,1);
  assert.match(view.notice.textContent,/缺少本机依赖/);
  assert.ok(command(view,"启动协作页面"));
});

test("另一个本机工作台持有页面时直接嵌入，收起与轮询都不会重启", async t => {
  const peer = {...running,peer:true,session:{...running.session,ownerPort:5185}};
  const {container,options,calls} = fixture(t, () => peer);
  const view = new SkillView(container,cap(),options);
  await settled();
  assert.equal(view.stage.children[0].src,running.session.url);
  await command(view,"收起协作页面").action();
  await view.refresh();
  assert.equal(view.stage.children.length,0);
  await command(view,"显示协作页面").action();
  assert.equal(view.stage.children[0].src,running.session.url);
  assert.ok(calls.every(x=>x.action==="skill-status"));
});
