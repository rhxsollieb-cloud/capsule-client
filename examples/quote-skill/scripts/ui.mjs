import { once } from "node:events";
import { readFileSync, writeSync } from "node:fs";
import { createServer } from "node:http";
import { openStore, problem } from "./store.mjs";

const files = new Map([
  ["/", [new URL("../assets/index.html", import.meta.url), "text/html; charset=utf-8"]],
  ["/app.mjs", [new URL("../assets/app.mjs", import.meta.url), "text/javascript; charset=utf-8"]],
  ["/style.css", [new URL("../assets/style.css", import.meta.url), "text/css; charset=utf-8"]],
]);

function json(response, status, value) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

async function input(request) {
  if (request.headers["content-type"]?.split(";")[0].trim() !== "application/json")
    throw problem("保存需要 application/json", 415);
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= 4096) chunks.push(chunk);
  }
  if (size > 4096) throw problem("保存内容过大", 413);
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw problem("保存内容不是有效 JSON"); }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some((key) => !["quantity", "unitPrice", "version"].includes(key)))
    throw problem("保存只接受 quantity、unitPrice 和 version");
  if (!Object.hasOwn(value, "version")) throw problem("保存需要已读取的 version");
  return value;
}

let store;
let server;
let closing = false;
function stop() {
  if (closing) return;
  closing = true;
  if (!server?.listening) { store?.close(); return; }
  server.close(() => store?.close());
  setTimeout(() => server.closeAllConnections(), 1500).unref();
}

try {
  const args = process.argv.slice(2);
  if (args.length) {
    if (args.length !== 1 || args[0] !== "--help") throw problem("界面入口不接受参数；使用 --help 查看启动方式");
    process.stdout.write(JSON.stringify({ usage: "CAPSULE_SKILL_STATE=/absolute/state node scripts/ui.mjs 3>/absolute/ready.json", ready: "通过 CAPSULE_SKILL_READY_FD（默认3）报告本机随机端口地址" }) + "\n");
  } else {
    const descriptor = Number(process.env.CAPSULE_SKILL_READY_FD || 3);
    if (!Number.isInteger(descriptor) || descriptor < 3) throw problem("CAPSULE_SKILL_READY_FD 需为不小于 3 的可写描述符");
    store = openStore();
    server = createServer(async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'");
      try {
        const authority = `127.0.0.1:${server.address().port}`;
        if (request.headers.host !== authority) throw problem("Host 不匹配本机界面地址", 403, "HOST_REJECTED");
        if (request.headers.origin !== undefined && request.headers.origin !== `http://${authority}`)
          throw problem("Origin 不匹配本机界面地址", 403, "ORIGIN_REJECTED");
        const url = new URL(request.url, `http://${authority}`);
        if (url.pathname === "/api/state" && request.method === "GET") return json(response, 200, store.read());
        if (url.pathname === "/api/state" && request.method === "POST") {
          const value = await input(request);
          return json(response, 200, store.set(value.quantity, value.unitPrice, value.version));
        }
        const file = files.get(url.pathname);
        if (!file) throw problem("地址不存在", 404);
        if (!["GET", "HEAD"].includes(request.method)) throw problem("不支持的请求方法", 405);
        const body = readFileSync(file[0]);
        response.writeHead(200, { "Content-Type": file[1] });
        response.end(request.method === "HEAD" ? undefined : body);
      } catch (error) { json(response, error.status || 500, { error: error.message, code: error.code || "QUOTE_FAILED" }); }
    });
    server.requestTimeout = 10000;
    server.headersTimeout = 10000;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    writeSync(descriptor, JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/` }) + "\n");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message, code: error.code || "QUOTE_UI_FAILED" }) + "\n");
  process.exitCode = 1;
  stop();
}
