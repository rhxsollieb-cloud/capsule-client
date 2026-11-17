import { createHmac, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { readProtocolDocument, writeProtocolDocument } from "./office-document.mjs";

export const officeTestSecret = "isolated-frontend-office-test-secret";
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const scriptValue = (value) => JSON.stringify(value).replace(/</g, "\\u003c");

function loopback(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Office substitute only contacts isolated loopback services");
  return url.href;
}

async function jsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function callbackToken(payload) {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify({ payload, iat: now, exp: now + 300 })).toString("base64url");
  return `${head}.${body}.${createHmac("sha256", officeTestSecret).update(`${head}.${body}`).digest("base64url")}`;
}

// Explicit Office protocol substitute. It verifies integration and persisted
// artifacts, not real ONLYOFFICE rendering, typing, or format compatibility.
export async function startOfficeServer() {
  const state = { requests: [], commands: [], documents: new Map(), files: new Map(), pendingSaves: [], callbackErrors: [] };
  const tasks = new Set();
  let epoch = 0;
  const track = (task) => {
    tasks.add(task);
    task.catch((error) => state.callbackErrors.push(error.message)).finally(() => tasks.delete(task));
    return task;
  };
  const deliver = async (snapshot, status) => {
    const output = `/cache/files/${randomUUID()}/output.${snapshot.fileType}`;
    state.files.set(output, await writeProtocolDocument(snapshot.fileType, snapshot.body));
    const payload = { key: snapshot.key, status, url: state.url + output, filetype: snapshot.fileType,
      ...(status === 6 ? { forcesavetype: 0, userdata: snapshot.userdata } : {}) };
    const response = await fetch(loopback(snapshot.callbackUrl), { method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${callbackToken(payload)}` }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok || result.error !== 0) throw new Error(`Office substitute callback failed: HTTP ${response.status}, ${JSON.stringify(result)}`);
    return result;
  };
  state.flushSave = async (id = state.pendingSaves[0]?.id) => {
    const index = state.pendingSaves.findIndex((pending) => pending.id === id);
    if (index < 0) throw new Error("No pending Office substitute save");
    return track(deliver(state.pendingSaves.splice(index, 1)[0], 6));
  };
  state.sendFinal = async (key) => {
    const document = state.documents.get(key);
    if (!document) throw new Error("Office substitute document is missing");
    return track(deliver({ ...document }, 2));
  };
  state.reset = async () => {
    epoch++;
    await Promise.allSettled([...tasks]);
    state.failScript = false; state.scriptDelayMs = 0; state.holdSaves = false; state.commandError = 0;
    for (const key of ["requests", "commands", "pendingSaves", "callbackErrors"]) state[key].length = 0;
    state.documents.clear(); state.files.clear();
  };
  await state.reset();

  const route = async (request, response) => {
    const generation = epoch;
    const path = new URL(request.url, state.url);
    state.requests.push({ path: path.pathname, method: request.method });
    if (path.pathname === "/healthcheck") return response.end("true");
    if (["/command", "/coauthoring/CommandService.ashx"].includes(path.pathname)) {
      const command = await jsonBody(request);
      if (generation !== epoch) return response.writeHead(410).end();
      state.commands.push({ c: command.c, key: command.key, userdata: command.userdata });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: state.commandError, key: command.key }));
      if (!state.commandError) {
        const document = state.documents.get(command.key);
        if (!document) throw new Error("Save command has no Office substitute document");
        const snapshot = { ...document, id: randomUUID(), userdata: command.userdata };
        if (state.holdSaves) state.pendingSaves.push(snapshot);
        else track(deliver(snapshot, 6));
      }
      return;
    }
    if (state.files.has(path.pathname)) {
      response.writeHead(200, { "Content-Type": "application/octet-stream" });
      return response.end(state.files.get(path.pathname));
    }
    if (path.pathname === "/fixture/edit") {
      const input = await jsonBody(request);
      if (generation !== epoch) return response.writeHead(410).end();
      const document = state.documents.get(input.key);
      if (!document || document.mode !== "edit") throw new Error("Office substitute document is not editable");
      document.body = String(input.body);
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ collected: true }));
    }
    if (path.pathname === "/web-apps/apps/api/documents/api.js") {
      if (state.scriptDelayMs) await delay(state.scriptDelayMs);
      if (response.destroyed || generation !== epoch) return response.end();
      if (state.failScript) return response.writeHead(503).end("Office script unavailable in this test");
      response.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(`
window.DocsAPI = { DocEditor: class {
  constructor(id, config) {
    const target = document.getElementById(id);
    if (!target) throw new Error('Office fixture mount is missing');
    const frame = this.frame = document.createElement('iframe');
    frame.title = 'Office 测试替身';
    const source = new URL('/fixture/editor', ${scriptValue(state.url)});
    for (const [name, value] of Object.entries({title:config.document.title, type:config.document.fileType,
      key:config.document.key, source:config.document.url, callback:config.editorConfig.callbackUrl, mode:config.editorConfig.mode})) source.searchParams.set(name, value || '');
    frame.src = source.href;
    this.listener = (event) => {
      if (event.origin !== ${scriptValue(state.url)} || event.source !== frame.contentWindow || event.data?.protocol !== 'capsule-office-test') return;
      if (event.data.event === 'ready') config.events?.onDocumentReady?.();
      if (event.data.event === 'changed') config.events?.onDocumentStateChange?.({data:event.data.dirty});
    };
    window.addEventListener('message', this.listener);
    target.replaceWith(frame);
  }
  destroyEditor() { window.removeEventListener('message', this.listener); this.frame.remove(); }
}};
`);
    }
    if (path.pathname === "/fixture/editor") {
      const key = path.searchParams.get("key");
      const fileType = path.searchParams.get("type");
      const sourceUrl = loopback(path.searchParams.get("source"));
      const callbackUrl = loopback(path.searchParams.get("callback"));
      let document = state.documents.get(key);
      if (!document) {
        const source = await fetch(sourceUrl, { redirect: "error", signal: AbortSignal.timeout(10000) });
        if (!source.ok) throw new Error(`Office substitute source failed: HTTP ${source.status}`);
        const body = await readProtocolDocument(fileType, Buffer.from(await source.arrayBuffer()));
        if (generation !== epoch) return response.writeHead(410).end();
        document = { key, body, fileType, title: path.searchParams.get("title") };
        state.documents.set(key, document);
      }
      Object.assign(document, { mode: path.searchParams.get("mode"), sourceUrl, callbackUrl });
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      return response.end(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Office 测试替身</title><body>
<h1>Office 测试替身</h1><p>Office 协议替身：仅验证调用、保存和恢复，不代表真实文档编辑引擎。</p>
<p id="document-title">${escape(document.title)}</p><p id="document-type">${escape(fileType)}</p>
<label for="body">Office 协议替身正文</label><textarea id="body" ${document.mode === "edit" ? "" : "readonly"}>${escape(document.body)}</textarea>
<p id="input-status">输入已收集</p><script>
const send = (event, dirty) => parent.postMessage({protocol:'capsule-office-test',event,dirty}, '*');
const body = document.querySelector('#body'); let generation = 0;
body.addEventListener('input', async () => {
  const own = ++generation; send('changed', true); document.querySelector('#input-status').textContent = '正在收集输入';
  try {
    const response = await fetch('/fixture/edit', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({key:${scriptValue(key)},body:body.value})});
    if (!response.ok) throw new Error('Office substitute input collection failed');
    if (own === generation) { send('changed', false); document.querySelector('#input-status').textContent = '输入已收集'; }
  } catch (error) { document.querySelector('#input-status').textContent = error.message; }
});
send('ready');
</script></body></html>`);
    }
    response.writeHead(404).end();
  };
  const server = createServer((request, response) => {
    route(request, response).catch((error) => {
      state.callbackErrors.push(error.message);
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain" });
      if (!response.writableEnded) response.end(error.message);
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  state.url = `http://127.0.0.1:${server.address().port}`;
  state.close = async () => {
    await Promise.allSettled([...tasks]);
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
  return state;
}
