import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { defaultClientHome } from "../src/system/clientHome.mjs";
import { configuration } from "../src/config.mjs";

test("Windows 默认缓存位于员工 LocalAppData，支持空格和中文并可回退到用户目录", () => {
  const options = { platform: "win32", userHome: "C:\\Users\\员工 A" };
  assert.equal(defaultClientHome({ LOCALAPPDATA: "D:\\用户资料\\Local Data" }, options), "D:\\用户资料\\Local Data\\Capsule");
  assert.equal(defaultClientHome({}, options), "C:\\Users\\员工 A\\AppData\\Local\\Capsule");
});

test("非 Windows 保留安装目录工作区，显式配置仍优先且按启动目录解析", () => {
  const expected = fileURLToPath(new URL("../.local", import.meta.url));
  for (const platform of ["darwin", "linux"]) assert.equal(defaultClientHome({}, { platform }), expected);
  assert.equal(configuration({ CAPSULE_CLIENT_HOME: "员工资料/缓存" }).home, resolve("员工资料/缓存"));
});
