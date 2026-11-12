import { createHmac } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

export const officeSecret = "isolated-office-engine-test-secret";

export function callbackJwt(value) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ payload: value, exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  const signature = createHmac("sha256", officeSecret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

export async function officeEngineFixture(t) {
  const files = new Map();
  const commands = [];
  const engine = createServer(async (request, response) => {
    const url = new URL(request.url, "http://localhost");
    if (url.pathname === "/healthcheck") return response.end("true");
    if (["/command", "/coauthoring/CommandService.ashx"].includes(url.pathname)) {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const command = JSON.parse(Buffer.concat(chunks));
      commands.push(command);
      response.setHeader("Content-Type", "application/json");
      return response.end(JSON.stringify({ error: 0, key: command.key }));
    }
    if (files.has(url.pathname)) {
      const file = files.get(url.pathname);
      response.writeHead(200, { "Content-Length": file.length, "Content-Type": "application/octet-stream" });
      return response.end(file);
    }
    response.writeHead(404).end();
  });
  engine.listen(0, "127.0.0.1");
  await once(engine, "listening");
  t.after(() => new Promise((resolve) => engine.close(resolve)));
  return { url: `http://127.0.0.1:${engine.address().port}`, files, commands };
}
