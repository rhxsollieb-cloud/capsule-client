import test from "node:test";
import assert from "node:assert/strict";
import { assertWindowsEntries } from "../src/system/windowsPaths.mjs";

test("Windows 展开前拒绝设备名、ADS、末尾空格和不安全分隔符", () => {
  for (const entry of ["NUL", "a/CON.txt", "COM¹.log", "lpt³", "prn .txt", "CONIN$", "a/conout$.txt", "file.txt:stream", "C:relative", "C:/absolute", "a\\b", "a//b", "../escape", "a/end.", "a/end ", "a/*.txt", "a/with?mark", "a/with|pipe", "a/\u0000", "x".repeat(256)])
    assert.throws(() => assertWindowsEntries([entry]), (error) => error.code === "WINDOWS_PATH_UNSUPPORTED" && error.status === 409, entry);
});

test("Windows 展开前检测父目录大小写、文件目录和 Unicode 冲突", () => {
  for (const entries of [["Readme.md", "README.md"], ["Assets/a.png", "assets/b.png"], ["DATA", "data/row.txt"], ["café.md", "cafe\u0301.md"], ["σ.txt", "ς.txt"], ["µ.txt", "Μ.txt"]])
    assert.throws(() => assertWindowsEntries(entries), { code: "WINDOWS_PATH_UNSUPPORTED" });
  assert.doesNotThrow(() => assertWindowsEntries(["SKILL.md", "scripts/cli.mjs", "scripts/ui.mjs", "素材/照片 A (1).png", "assets/emoji-😀.png", ".env.example", "long/".repeat(70) + "file.txt"]));
});
