import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { cacheDirectory, synchronize } from "../src/cache/sync.mjs";
import { cachedVersion } from "../src/cache/metadata.mjs";
import { withClientDatabase } from "../src/storage/database.mjs";
import { execute, git } from "../src/system/process.mjs";
import { repositoryFixture } from "./fixture.mjs";

async function bundleFor(repository, path, destination, { incremental = false } = {}) {
  const reference = "refs/heads/export-" + randomUUID();
  await git(["update-ref", reference, path.query.commit], repository);
  try { await git(["bundle", "create", destination, reference, ...(incremental && path.query.base ? ["^" + path.query.base] : [])], repository); }
  finally { await git(["update-ref", "-d", reference], repository); }
}

async function cacheRows(config) {
  return withClientDatabase(config.home, (database) => ({
    versions: database.prepare("SELECT commit_id FROM cache_versions ORDER BY commit_id").all().map((row) => row.commit_id),
    head: database.prepare("SELECT commit_id FROM cache_heads WHERE server_url=? AND name=?").get(config.serverUrl, "工具")?.commit_id,
  }));
}

test("并发同步在同一跨进程锁内stat，共享一次下载且不用旧响应倒退新版", async (t) => {
  const { api, repository, record, update } = await repositoryFixture(t, "first\n");
  let downloads = 0, reads = 0, acceptFirst, signalFirst;
  const firstRead = new Promise((resolve) => { signalFirst = resolve; });
  api.json = async () => {
    reads++;
    const baseline = structuredClone(record);
    if (reads === 1) { signalFirst(); await new Promise((resolve) => { acceptFirst = resolve; }); }
    return baseline;
  };
  api.download = async (path, destination) => { downloads++; await bundleFor(repository, path, destination); };
  const oldCommit = record.commit;
  const first = synchronize(api, "工具");
  await firstRead;
  const second = synchronize(api, "工具");
  const newCommit = await update("second\n");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(reads, 1, "第二个stat必须等第一个同步释放锁");
  acceptFirst();
  const [older, newer] = await Promise.all([first, second]);
  assert.equal(older.commit, oldCommit);
  assert.equal(newer.commit, newCommit);
  assert.equal(await git(["rev-parse", "HEAD"], newer.repository), newCommit);
  assert.equal((await cacheRows(api.config)).head, newCommit);
  assert.equal(downloads, 2);
  const repeated = await Promise.all([synchronize(api, "工具"), synchronize(api, "工具")]);
  assert.ok(repeated.every((result) => result.changed === false));
  assert.equal(downloads, 2);
});

test("历史commit复用现有Git对象，不重复下载，并固定引用防止历史被GC清走", async (t) => {
  const { api, record, update } = await repositoryFixture(t, "old\n");
  let downloads = 0;
  const download = api.download;
  api.download = async (...args) => { downloads++; return download(...args); };
  const firstRecord = structuredClone(record);
  const first = await synchronize(api, "工具");
  const latest = await update("new\n");
  await synchronize(api, "工具");
  Object.assign(record, firstRecord);
  const historical = await synchronize(api, "工具");
  assert.equal(historical.commit, first.commit);
  assert.equal(await readFile(join(first.repository, "main.mjs"), "utf8"), "old\n");
  assert.equal(downloads, 2);
  for (const commit of [first.commit, latest])
    assert.equal(await git(["rev-parse", `refs/capsule-cache/${commit}`], first.repository), commit);
  assert.equal((await cachedVersion(api.config, "工具", first.commit)).commit, first.commit);
});

test("本地缓存即使提交后Git状态干净，未知本地HEAD也不会被同步覆盖", async (t) => {
  const { api } = await repositoryFixture(t, "server\n");
  const cached = await synchronize(api, "工具");
  await git(["config", "user.name", "Local cache test"], cached.repository);
  await git(["config", "user.email", "cache@localhost"], cached.repository);
  await writeFile(join(cached.repository, "main.mjs"), "committed local work\n");
  await git(["add", "."], cached.repository);
  await git(["commit", "-m", "local work"], cached.repository);
  const local = await git(["rev-parse", "HEAD"], cached.repository);
  await assert.rejects(synchronize(api, "工具"), /HEAD并非已登记/);
  assert.equal(await git(["rev-parse", "HEAD"], cached.repository), local);
  assert.equal(await readFile(join(cached.repository, "main.mjs"), "utf8"), "committed local work\n");
  assert.equal((await cacheRows(api.config)).head, cached.commit);
});

test(".git及属性路径被换成链接时，在任何attributes写入之前停止且外部文件不变", async (t) => {
  const { api, directory } = await repositoryFixture(t, "saved\n");
  const cached = await synchronize(api, "工具");
  const external = join(directory, "external");
  await mkdir(join(external, "info"), { recursive: true });
  const externalAttributes = join(external, "info", "attributes");
  await writeFile(externalAttributes, "do not overwrite\n");
  for (const [entry, target] of [[".git", external], [".git/info", join(external, "info")], [".git/info/attributes", externalAttributes]]) {
    const path = join(cached.repository, entry), backup = path + ".backup";
    await rename(path, backup);
    await symlink(target, path);
    try {
      await assert.rejects(synchronize(api, "工具"), /Git目录或属性位置不安全/);
      assert.equal(await readFile(externalAttributes, "utf8"), "do not overwrite\n");
    } finally { await rm(path); await rename(backup, path); }
  }
  assert.equal(await git(["rev-parse", "HEAD"], cached.repository), cached.commit);
});

test("两个独立CLI进程同步同一空缓存只下载一次，SQLite与HEAD一致", async (t) => {
  const { api, directory, repository, record } = await repositoryFixture(t, "shared\n");
  const bundle = join(directory, "source.bundle");
  await bundleFor(repository, { query: { commit: record.commit } }, bundle);
  const metadata = join(directory, "record.json"), counter = join(directory, "downloads.txt");
  await writeFile(metadata, JSON.stringify(record));
  const child = join(directory, "sync-child.mjs");
  const source = `
import { appendFile, copyFile, readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { synchronize } from ${JSON.stringify(new URL("../src/cache/sync.mjs", import.meta.url).href)};
const [home, metadata, bundle, counter] = process.argv.slice(2);
const api = {
  config: { home, serverUrl: 'http://test' },
  path: (name, operation = '', query = {}) => ({ name, operation, query }),
  json: async () => JSON.parse(await readFile(metadata, 'utf8')),
  download: async (_path, destination) => { await appendFile(counter, String(process.pid) + '\\n'); await delay(100); await copyFile(bundle, destination); },
};
process.stdout.write(JSON.stringify(await synchronize(api, '工具')));
`;
  await writeFile(child, source);
  const outcomes = await Promise.all([0, 1].map(() => execute(process.execPath, [child, api.config.home, metadata, bundle, counter], { cwd: directory })));
  const results = outcomes.map((result) => JSON.parse(result.stdout));
  assert.deepEqual(results.map((result) => result.changed).sort(), [false, true]);
  assert.equal((await readFile(counter, "utf8")).trim().split("\n").length, 1);
  assert.equal(results[0].repository, results[1].repository);
  assert.equal(await git(["rev-parse", "HEAD"], results[0].repository), record.commit);
  assert.equal((await cacheRows(api.config)).head, record.commit);
});

test("完整旧HEAD作为base请求并验证增量bundle，新版不重复传旧媒体", async (t) => {
  const { api, repository, record, directory, update } = await repositoryFixture(t, "old\n");
  await writeFile(join(repository, "media.bin"), randomBytes(512 * 1024));
  await git(["add", "."], repository);
  await git(["commit", "-m", "media"], repository);
  record.commit = await git(["rev-parse", "HEAD"], repository);
  const requests = [], sizes = [];
  api.download = async (path, destination) => {
    requests.push(path.query);
    await bundleFor(repository, path, destination, { incremental: true });
    sizes.push((await stat(destination)).size);
    await cp(destination, join(directory, `download-${requests.length}.bundle`));
  };
  const first = await synchronize(api, "工具");
  const secondCommit = await update("new text only\n");
  const second = await synchronize(api, "工具");
  assert.equal(requests[0].base, undefined);
  assert.equal(requests[1].base, first.commit);
  assert.equal(requests[1].commit, secondCommit);
  assert.ok((await readFile(join(directory, "download-2.bundle"))).includes(Buffer.from("-" + first.commit)));
  assert.ok(sizes[1] < sizes[0] / 4);
  assert.equal(second.commit, secondCommit);
  assert.deepEqual(await readFile(join(second.repository, "media.bin")), await readFile(join(repository, "media.bin")));
});

test("仅旧server明确拒绝base未知字段时回退一次full，其他失败不重试", async (t) => {
  const { api, update } = await repositoryFixture(t, "old\n");
  let reads = 0;
  const json = api.json, download = api.download;
  api.json = async (...args) => { reads++; return json(...args); };
  await synchronize(api, "工具");
  await update("new\n");
  const requests = [];
  api.download = async (path, destination) => {
    requests.push(path.query);
    if (path.query.base) throw Object.assign(new Error("请求包含不支持的字段"), { status: 400, code: "BAD_REQUEST" });
    return download(path, destination);
  };
  const updated = await synchronize(api, "工具");
  assert.equal(requests.length, 2);
  assert.ok(requests[0].base);
  assert.equal(requests[1].base, undefined);
  assert.equal(requests[0].commit, requests[1].commit);
  assert.equal(reads, 2, "不应为兼容性额外查询health或重读stat");
  await update("third\n");
  const failures = [
    Object.assign(new Error("其他输入错误"), { status: 400, code: "BAD_REQUEST" }),
    Object.assign(new Error("请求包含不支持的字段"), { status: 400, code: "OTHER" }),
    Object.assign(new Error("请求包含不支持的字段"), { status: 503, code: "BAD_REQUEST" }),
    Object.assign(new Error("请求包含不支持的字段"), { status: 401, code: "UNAUTHORIZED" }),
    Object.assign(new Error("connection interrupted"), { code: "NETWORK_ERROR" }),
  ];
  for (const failure of failures) {
    let attempts = 0;
    api.download = async () => { attempts++; throw failure; };
    await assert.rejects(synchronize(api, "工具"), (error) => error === failure);
    assert.equal(attempts, 1);
    assert.equal(await git(["rev-parse", "HEAD"], updated.repository), updated.commit);
  }
});

test("已有缓存的下载失败及SQLite发布失败均保留旧HEAD，重试复用已验证对象", async (t) => {
  const { api, record, update } = await repositoryFixture(t, "old\n");
  let downloads = 0, failDownload = false;
  const download = api.download;
  api.download = async (path, destination) => {
    downloads++;
    if (failDownload) { await writeFile(destination, "partial"); throw new Error("network interrupted"); }
    return download(path, destination);
  };
  const first = await synchronize(api, "工具");
  const target = await update("new\n");
  failDownload = true;
  await assert.rejects(synchronize(api, "工具"), /network interrupted/);
  assert.equal(await git(["rev-parse", "HEAD"], first.repository), first.commit);
  assert.equal((await cacheRows(api.config)).head, first.commit);
  failDownload = false;
  await withClientDatabase(api.config.home, (database) => database.exec("CREATE TRIGGER reject_cache_head BEFORE UPDATE ON cache_heads BEGIN SELECT RAISE(ABORT,'publish denied'); END"));
  await assert.rejects(synchronize(api, "工具"), /publish denied/);
  assert.equal(await git(["rev-parse", "HEAD"], first.repository), first.commit);
  assert.deepEqual(await cacheRows(api.config), { head: first.commit, versions: [first.commit] });
  await withClientDatabase(api.config.home, (database) => database.exec("DROP TRIGGER reject_cache_head"));
  const retried = await synchronize(api, "工具");
  assert.equal(retried.commit, target);
  assert.equal(downloads, 3, "SQLite失败后目标对象已在本地，不应第四次下载");
  assert.equal((await cacheRows(api.config)).head, record.commit);
  assert.ok((await readdir(join(first.repository, ".."))).every((entry) => !entry.startsWith(".sync-")));
});

test("首次SQLite发布失败不留下已发布仓库或半份元数据", async (t) => {
  const { api } = await repositoryFixture(t, "new\n");
  await withClientDatabase(api.config.home, (database) => database.exec("CREATE TRIGGER reject_new_cache BEFORE INSERT ON cache_heads BEGIN SELECT RAISE(ABORT,'new publish denied'); END"));
  await assert.rejects(synchronize(api, "工具"), /new publish denied/);
  assert.equal(existsSync(join(cacheDirectory(api.config, "工具"), "repository")), false);
  assert.deepEqual(await cacheRows(api.config), { head: undefined, versions: [] });
  assert.deepEqual(await readdir(cacheDirectory(api.config, "工具")), []);
});

test("SQLite已COMMIT后close报错仍非零诊断，首次和已有缓存均保持已发布版本且不重下载", async (t) => {
  const close = DatabaseSync.prototype.close;
  let activeCommit, thrown;
  t.mock.method(DatabaseSync.prototype, "close", function () {
    const published = activeCommit && this.prepare("SELECT commit_id FROM cache_heads WHERE name=?").get("工具")?.commit_id === activeCommit;
    close.call(this);
    if (published && !thrown) { thrown = true; throw new Error("close after commit failed"); }
  });
  for (const existing of [false, true]) {
    activeCommit = undefined;
    thrown = false;
    const { api, record, update } = await repositoryFixture(t, `case-${existing}\n`);
    let downloads = 0;
    const download = api.download;
    api.download = async (...args) => { downloads++; return download(...args); };
    if (existing) { await synchronize(api, "工具"); await update("updated version\n"); }
    activeCommit = record.commit;
    await assert.rejects(synchronize(api, "工具"), (error) => {
      assert.equal(error.cachePublished, true);
      assert.equal(error.code, "CACHE_DATABASE_CLOSE_FAILED");
      assert.match(error.message, /close after commit failed/);
      return true;
    });
    const repository = join(cacheDirectory(api.config, "工具"), "repository");
    assert.equal(await git(["rev-parse", "HEAD"], repository), activeCommit);
    assert.equal((await cacheRows(api.config)).head, activeCommit);
    const before = downloads;
    assert.equal((await synchronize(api, "工具")).changed, false);
    assert.equal(downloads, before);
  }
});

test("错误commit的bundle被拒绝，缺少子blob的本地提交明确损坏且不自动重下", async (t) => {
  const { api, repository, record, update } = await repositoryFixture(t, "old\n");
  const old = record.commit;
  const latest = await update("new\n");
  api.download = (path, destination) => bundleFor(repository, { ...path, query: { commit: old } }, destination);
  await assert.rejects(synchronize(api, "工具"), /精确提交/);
  assert.equal(existsSync(join(cacheDirectory(api.config, "工具"), "repository")), false);
  let downloads = 0;
  api.download = (path, destination) => { downloads++; return bundleFor(repository, path, destination); };
  const cached = await synchronize(api, "工具");
  assert.equal(cached.commit, latest);
  const objects = join(cached.repository, ".git", "objects");
  await rm(objects, { recursive: true });
  await cp(join(repository, ".git", "objects"), objects, { recursive: true });
  const blob = await git(["rev-parse", "HEAD:main.mjs"], cached.repository);
  const missing = join(objects, blob.slice(0, 2), blob.slice(2));
  await rm(missing);
  await assert.rejects(synchronize(api, "工具"), /Git对象缺失或损坏/);
  assert.equal(downloads, 1);
  assert.equal(existsSync(missing), false);
  assert.equal(await readFile(join(cached.repository, "main.mjs"), "utf8"), "new\n");
  assert.equal((await cacheRows(api.config)).head, latest);
});
