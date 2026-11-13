import { execute } from "../system/process.mjs";

export async function doctor(config) {
  const git = await execute("git", ["--version"]);
  return {
    node: process.versions.node,
    git: git.stdout.trim(),
    serverUrl: config.serverUrl,
    clientUrl: config.clientUrl,
    home: config.home,
    authenticated: Boolean(config.token),
    engines: ["node"],
    dependencies: "由 Skill 按自身需要准备，客户端不自动安装依赖",
  };
}
