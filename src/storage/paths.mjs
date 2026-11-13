import { createHash } from "node:crypto";
import { capsuleName } from "../system/paths.mjs";
import { join } from "node:path";

export function clientPaths(config) {
  return {
    home: config.home,
    database: join(config.home, "client.sqlite"),
    cache: join(config.home, "cache"),
    runs: join(config.home, "runs"),
    skills: join(config.home, "skills"),
    serverUrl: config.serverUrl,
    clientUrl: config.clientUrl || "http://127.0.0.1:5183",
  };
}

export function skillPaths(config, name) {
  const key = createHash("sha256").update(config.serverUrl + "\0" + capsuleName(name)).digest("hex");
  const directory = join(config.home, "skills", key);
  return { directory, state: join(directory, "state") };
}
