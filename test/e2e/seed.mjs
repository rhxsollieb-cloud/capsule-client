import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Document, Packer, Paragraph } from "docx";
import ExcelJS from "exceljs";

export async function seedFrontend(api, directory) {
  const accounts = {};
  for (const [role, username, password, name] of [
    ["admin", "admin", "Admin-test-password-2026!", "测试管理员"],
    ["editor", "editor", "Editor-test-password-2026!", "测试编辑同事"],
  ]) {
    const { user } = await api.json("/api/access/users", "POST", { username, password, name, role });
    accounts[role] = { id: user.id, username, password };
  }
  const create = async (name, kind, body) => {
    const cap = await api.json("/api/capsules", "POST", { name, kind, ...(body === undefined ? {} : { body }), description: "隔离前端测试数据" });
    await api.json("/api/mounts", "POST", { name, path: "/" + name });
    return cap;
  };
  const write = (cap, entry, body) => api.json(api.path(cap.name, "write"), "POST", { token: cap.token, entry, body });
  const upload = async (cap, bytes) => {
    const file = join(directory, cap.name);
    await writeFile(file, bytes);
    return api.upload(cap.name, undefined, file, cap.token);
  };
  await create("工作说明.md", "markdown", "# 测试知识正文\n\n这是隔离测试的工作说明，可通过左侧知识库打开。\n\n## 协作规则\n\n保存时核对版本，普通 editor 可编辑。\n");
  let files = await create("资料包", "files", "# 资料包说明\n\n从第二列选择内部文件。\n");
  files = await write(files, "notes/清单.txt", "内部文件正文\n第一项：核对资料\n第二项：保留版本\n");
  await write(files, "notes/补充.txt", "另一个内部文件正文\n");
  const image = await create("示例图.png", "image");
  await upload(image, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVrkAAAAASUVORK5CYII=", "base64"));
  const database = await create("业务记录", "database", "# 业务记录\n\n测试 contacts 表。\n");
  await api.json(api.path(database.name, "write"), "POST", { token: database.token, statements: [
    { sql: "CREATE TABLE contacts (id INTEGER PRIMARY KEY, name TEXT NOT NULL)" },
    { sql: "INSERT INTO contacts VALUES (?,?)", parameters: [1, "测试联系人甲"] },
    { sql: "INSERT INTO contacts VALUES (?,?)", parameters: [2, "测试联系人乙"] },
  ] });
  await create("示例工具", "code", "# 示例工具\n\n用于前端测试的 Skill。\n");
  let protectedCap = await create("受保护.md", "markdown", "");
  const access = await api.json(api.path(protectedCap.name, "access"));
  await api.json(api.path(protectedCap.name, "access"), "PUT", { revision: access.revision, permission: "none" });
  protectedCap = await write(protectedCap, "README.md", "# 仅管理员可见\n\n这是隔离测试的管理员保护内容。\n");
  const document = await create("测试文档.docx", "word");
  await upload(document, await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph("Office Word 测试正文")] }] })));
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("测试数据").addRows([["名称", "数量"], ["测试内容", 2]]);
  const spreadsheet = await create("测试表格.xlsx", "excel");
  await upload(spreadsheet, Buffer.from(await workbook.xlsx.writeBuffer()));
  return accounts;
}
