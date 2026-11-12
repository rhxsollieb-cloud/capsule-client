import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../src/system/process.mjs";

export async function repositoryFixture(t, source) {
  const directory = await mkdtemp(join(tmpdir(), "capsule-sync-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repository = join(directory, "remote");
  await mkdir(join(repository, "files"), { recursive: true });
  await git(["init", "-b", "main"], repository);
  await git(["config", "user.name", "Capsule test"], repository);
  await git(["config", "user.email", "capsule-test@localhost"], repository);
  await writeFile(join(repository, "files", "main.mjs"), source);
  await writeFile(join(repository, "cap.json"), JSON.stringify({
    format: 2,
    name: "工具",
    kind: "code",
    description: "",
    runtime: { engine: "node", entry: "main.mjs" },
  }));
  await git(["add", "."], repository);
  await git(["commit", "-m", "initial"], repository);
  const record = {
    name: "工具",
    kind: "code",
    description: "",
    commit: await git(["rev-parse", "HEAD"], repository),
    token: "first",
    runtime: { engine: "node", entry: "main.mjs" },
  };
  const api = {
    config: { serverUrl: "http://test", home: join(directory, "client"), token: "" },
    path: (name, operation = "", query = {}) => ({ name, operation, query }),
    json: async () => ({ ...record }),
    download: async (path, destination) => {
      assertVersion(path.query.commit, record.commit);
      await git(["update-ref", "refs/heads/capsule-export", path.query.commit], repository);
      try {
        await git(
          ["bundle", "create", destination, "refs/heads/capsule-export"],
          repository,
        );
      } finally {
        await git(["update-ref", "-d", "refs/heads/capsule-export"], repository);
      }
    },
  };
  async function update(content) {
    await writeFile(join(repository, "files", "main.mjs"), content);
    await git(["add", "."], repository);
    await git(["commit", "-m", "update"], repository);
    record.commit = await git(["rev-parse", "HEAD"], repository);
    return record.commit;
  }
  return { api, directory, repository, record, update };
}

function assertVersion(requested, current) {
  if (requested !== current) throw new Error("请求必须指向 stat 返回的提交");
}
