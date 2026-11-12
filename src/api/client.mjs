import { createReadStream, createWriteStream } from "node:fs";
import { link, mkdtemp, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

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
  async response(path, init = {}) {
    const headers = new Headers(init.headers);
    if (this.config.token) headers.set("Authorization", `Bearer ${this.config.token}`);
    const response = await this.fetcher(this.config.serverUrl + path, {
      ...init,
      headers,
      signal: init.signal || AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      let details;
      try {
        details = (await response.json()).error;
      } catch {
        details = `HTTP ${response.status}`;
      }
      const error = new Error(this.redact(String(details || `HTTP ${response.status}`)));
      error.status = response.status;
      throw error;
    }
    return response;
  }
  redact(value) {
    return this.config.token
      ? value.replaceAll(this.config.token, "[凭据已隐藏]")
      : value;
  }
  async json(path, method = "GET", body, headers = {}) {
    const response = await this.response(path, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return response.json();
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
      return await response.json();
    } finally {
      source.destroy();
    }
  }
  async download(path, file) {
    const destination = resolve(file);
    const directory = await mkdtemp(join(dirname(destination), ".capsule-download-"));
    try {
      const response = await this.response(path, {
        signal: AbortSignal.timeout(30 * 60 * 1000),
      });
      if (!response.body) throw new Error("服务端未返回文件内容");
      const temporary = join(directory, "content");
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(temporary, { flags: "wx" }),
      );
      const info = await stat(temporary);
      await link(temporary, destination);
      return { path: destination, size: info.size };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
