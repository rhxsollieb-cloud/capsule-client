import { execute } from "../system/process.mjs";

export async function doctor(config) {
  const git = await execute("git", ["--version"]);
  return {
    node: process.versions.node,
    git: git.stdout.trim(),
    serverUrl: config.serverUrl,
    home: config.home,
    authenticated: Boolean(config.token),
    engines: ["node"],
    dependencies: "仅支持 Node 内置模块",
  };
}
