import { createReadStream, createWriteStream } from "node:fs";
import { link, lstat, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { protectedLeaseRequest } from "../operations/leases.mjs";

async function jsonPayload(response, mutating, redact) {
  try { return await response.json(); }
  catch (cause) {
    throw Object.assign(new Error(redact(`服务端响应不是有效JSON${mutating ? "；写入结果未确认，请查询实际状态，勿重复提交" : ""}`), { cause }), {
      status: 502, code: "INVALID_RESPONSE", ...(mutating ? { uncertain: true } : {}),
    });
  }
}

export class ApiClient {
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
  }
  path(name, operation = "", query = {}) {
    const suffix = operation ? "/" + operation : "";
    return this.query(`/api/capsules/${encodeURIComponent(name)}${suffix}`, query);
  }
  query(path, values = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values))
      if (value !== undefined) query.set(key, String(value));
    return path + (query.size ? "?" + query : "");
  }
  async response(path, init = {}, { allowNotModified = false } = {}) {
    const headers = new Headers(init.headers);
    if (this.leaseProof && protectedLeaseRequest(path, init.method || "GET")) headers.set("X-Capsule-Lease", this.leaseProof);
    if (this.config.token) headers.set("Authorization", `Bearer ${this.config.token}`);
    const mutating = !["GET", "HEAD"].includes(init.method || "GET");
    let response;
    try {
      response = await this.fetcher(this.config.serverUrl + path, {
        ...init,
        redirect: "manual",
        headers,
        signal: init.signal || AbortSignal.timeout(30000),
      });
    } catch (cause) {
      throw Object.assign(new Error(this.redact(`${cause.message}${mutating ? "；写入结果未确认，请先查询实际状态，勿重复提交" : ""}`), { cause }), {
        code: mutating ? "RESULT_UNKNOWN" : "NETWORK_ERROR", ...(mutating ? { uncertain: true } : {}),
      });
    }
    const notModified = response.status === 304 && allowNotModified === true && ["GET", "HEAD"].includes(init.method || "GET") && headers.has("If-None-Match");
    if (response.status >= 300 && response.status < 400 && !notModified) {
      await response.body?.cancel();
      throw Object.assign(new Error("服务端返回了重定向，客户端只访问已配置的根地址；写入结果请先查询核对，勿重复提交"), { status: 502, code: "SERVER_REDIRECT", ...(mutating ? { uncertain: true } : {}) });
    }
    if (!response.ok && !notModified) {
      let details;
      try {
        const payload = await response.json();
        details = payload && typeof payload === "object" ? payload : {};
      } catch {
        details = {};
      }
      const error = new Error(this.redact(String(details.error || `HTTP ${response.status}`)));
      error.status = response.status;
      if (typeof details.code === "string") error.code = details.code;
      if (typeof details.eventId === "string") error.eventId = details.eventId;
      if (typeof details.operationId === "string") error.operationId = details.operationId;
      if (Array.isArray(details.leases)) error.leases = details.leases;
      throw error;
    }
    return response;
  }
  redact(value) {
    for (const token of [this.config.token, this.leaseProof, this.config.leaseToken].filter(Boolean)) value = value.replaceAll(token, "[凭据已隐藏]");
    return value;
  }
  async json(path, method = "GET", body, headers = {}, { signal } = {}) {
    const response = await this.response(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
    return jsonPayload(response, !["GET", "HEAD"].includes(method), (value) => this.redact(value));
  }
  async upload(name, entry, file, token) {
    const info = await stat(file);
    if (!info.isFile()) throw new Error("上传来源必须是普通文件");
    const source = createReadStream(file);
    try {
      const response = await this.response(this.path(name, "content", { entry }), {
        method: "PUT",
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Length": String(info.size),
          "If-Match": token,
        },
        body: source,
        duplex: "half",
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      return await jsonPayload(response, true, (value) => this.redact(value));
    } finally {
      source.destroy();
    }
  }
  async putText(name, entry, body, token) {
    if (typeof body !== "string" || body.includes("\0")) throw new Error("正文需要不含空字符的UTF-8文本");
    const bytes = Buffer.from(body, "utf8");
    const response = await this.response(this.path(name, "content", { entry }), {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), "If-Match": token },
      body: bytes,
    });
    return jsonPayload(response, true, (value) => this.redact(value));
  }
  async download(path, file, { mode, openResponse } = {}) {
    if (openResponse !== undefined && typeof openResponse !== "function") throw new Error("下载内容提供者无效");
    const destination = resolve(file);
    try {
      await lstat(destination);
      throw Object.assign(new Error("下载目标已存在，未请求远端内容"), { code: "EEXIST" });
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const directory = await mkdtemp(join(dirname(destination), ".capsule-download-"));
    try {
      const response = openResponse ? await openResponse() : await this.response(path, {
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      if (!response.body) throw new Error("服务端未返回文件内容");
      const temporary = join(directory, "content");
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: "wx", ...(mode === undefined ? {} : { mode }) }),
      );
      const info = await stat(temporary);
      await link(temporary, destination);
      return { path: destination, size: info.size };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
