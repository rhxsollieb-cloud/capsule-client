const invalid = (entry, reason) => Object.assign(
  new Error(`此内容不能在 Windows 工作目录中展开：${entry}（${reason}）；请在服务端整理文件名后重试`),
  { code: "WINDOWS_PATH_UNSUPPORTED", status: 409 },
);

export function assertWindowsEntries(entries) {
  const names = new Map();
  for (const entry of entries) {
    const parts = typeof entry === "string" ? entry.split("/") : [];
    if (!parts.length) throw invalid(String(entry), "条目无效");
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part || /[<>:"\\|?*\x00-\x1f\x7f]/u.test(part) || /[ .]$/u.test(part))
        throw invalid(entry, "文件名包含 Windows 保留字符或末尾空格/句点");
      if (part.length > 255) throw invalid(entry, "单段文件名超过 255 个 UTF-16 单元");
      if (/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/iu.test(part))
        throw invalid(entry, "文件名为 Windows 设备保留名称");
      const prefix = parts.slice(0, index + 1).join("/");
      // Conservatively cover Windows uppercase aliases such as σ/ς and µ/Μ.
      const key = prefix.normalize("NFC").toLowerCase().toUpperCase().normalize("NFC");
      const directory = index < parts.length - 1;
      const previous = names.get(key);
      if (previous && (previous.prefix !== prefix || previous.directory !== directory))
        throw invalid(entry, `与 ${previous.prefix} 的大小写、Unicode 名称或文件/目录位置冲突`);
      names.set(key, { prefix, directory });
    }
  }
}
