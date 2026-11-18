import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { link, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] || join(root, ".local", "releases"));
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
if (git("status", "--porcelain").trim()) throw new Error("先提交客户端源码，再生成精确版本安装包；运行资料须留在忽略目录");
const commit = git("rev-parse", "HEAD").trim();
const entries = git("ls-tree", "-r", "-z", "--name-only", commit).split("\0").filter(Boolean);
for (const entry of entries) {
  if (/(^|\/)(?:\.local|node_modules|connection\.sqlite)(?:\/|$)|(^|\/)\.env(?:$|\.(?!example$))|\.(?:pem|key|p12|pfx)$/i.test(entry))
    throw new Error("源码清单含不应分发的运行资料或密钥：" + entry);
}
await mkdir(output, { recursive: true });
const temporary = await mkdtemp(join(output, ".capsule-package-"));
const name = `capsule-client-${commit.slice(0, 12)}.zip`;
try {
  const archive = join(temporary, name);
  git("archive", "--format=zip", "--prefix=capsule-client/", "--output=" + archive, commit);
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(archive)) hash.update(chunk);
  const sha256 = hash.digest("hex");
  await writeFile(join(temporary, "SHA256SUMS"), `${sha256}  ${name}\n`, { flag: "wx" });
  await writeFile(join(temporary, "release.json"), JSON.stringify({ repository: "https://github.com/rhxsollieb-cloud/capsule-client",
    commit, archive: name, sha256, node: ">=24", containsCredentials: false }, null, 2) + "\n", { flag: "wx" });
  // Hard-link publication is exclusive: an existing release is never replaced.
  for (const file of [name, "SHA256SUMS", "release.json"]) await link(join(temporary, file), join(output, file));
  console.log(JSON.stringify({ commit, archive: join(output, name), sha256 }, null, 2));
} finally { await rm(temporary, { recursive: true, force: true }); }
