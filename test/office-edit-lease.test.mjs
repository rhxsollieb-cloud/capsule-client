import assert from "node:assert/strict";
import test from "node:test";
import { OfficeView } from "../web/office.mjs";
import { testLease } from "./leaseFixture.mjs";

const settled = () => new Promise((resolve) => setImmediate(resolve));
test("Office默认mode view无占用，明确编辑才获取租约，恢复共同编辑房间保留脏状态", async (t) => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const element = () => ({ children: [], classList: { toggle() {} }, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, querySelectorAll: () => [], setAttribute() {},
  });
  const script = { src: "http://docs.invalid/web-apps/apps/api/documents/api.js", dataset: { ready: "true" } };
  const configurations = [];
  globalThis.document = { createElement: element, getElementById: () => script };
  globalThis.window = { DocsAPI: { DocEditor: class {
    constructor(_id, config) { configurations.push(config); queueMicrotask(() => config.events.onDocumentReady()); }
    destroyEditor() {}
  } } };
  t.after(() => { if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow; });
  const calls = [], acquires = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const input = JSON.parse(options.body); calls.push({ input, options });
    if (input.action === "office-status") return Response.json({ configured: true, available: true });
    if (input.action === "office-open") return Response.json({ id: input.mode + "-session", status: "open", saveVersion: 0,
      resumed: input.mode === "edit", editorUrl: "http://docs.invalid", config: { document: { permissions: { edit: input.mode === "edit" } }, editorConfig: { mode: input.mode } } });
    return Response.json({});
  });
  const cap = { name: "说明.docx", token: "read-token", commit: "read-commit", permissions: { edit: true, read: true } };
  const view = new OfficeView(element(), cap, undefined, { isCurrent: () => true, onError(error) { throw error; },
    createLease: (onChange) => {
      const lease = testLease(onChange, { held: false }), original = lease.acquire;
      lease.acquire = (...args) => { acquires.push(args); return original(...args); };
      return lease;
    },
  });
  t.after(() => view.destroy());
  await settled();
  assert.equal(view.readOnly, true); assert.equal(view.hasDirty(), false);
  assert.equal(acquires.length, 0);
  assert.equal(calls.find((call) => call.input.action === "office-open").input.mode, "view");
  assert.equal(calls.find((call) => call.input.action === "office-open").options.headers["X-Capsule-Lease"], undefined);
  assert.ok(view.controlsInfo().moreItems.some((item) => item.label === "占用并编辑Office"));
  await view.enterEditing();
  assert.equal(view.readOnly, false); assert.equal(view.hasDirty(), true);
  assert.ok(acquires.length >= 1);
  assert.equal(calls.filter((call) => call.input.action === "office-open").at(-1).input.mode, "edit");
  assert.equal(calls.filter((call) => call.input.action === "office-open").at(-1).options.headers["X-Capsule-Lease"], "test-edit-proof");
  assert.equal(configurations.length, 2);
  view.lease.release();
  assert.equal(view.stage.inert, true);
  assert.equal(view.controlsInfo().canSave, false);
});
