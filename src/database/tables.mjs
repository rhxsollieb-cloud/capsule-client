import { capsuleName } from "../system/paths.mjs";

const error = (message, status = 400) => Object.assign(new Error(message), { status });
const quote = (value) => '"' + value.replaceAll('"', '""') + '"';

function identifier(value) {
  if (typeof value !== "string" || !value || value.length > 255 || /[\x00-\x1f]/.test(value))
    throw error("表名或列名无效");
  return value;
}

function object(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw error("需要字段对象");
  if (fields && Object.keys(value).some((key) => !fields.includes(key))) throw error("包含不支持的字段");
  return value;
}

function scalar(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value?.type === "bigint" && /^-?\d+$/.test(value.value || "")) return value;
  if (value?.type === "blob" && typeof value.base64 === "string"
      && Buffer.from(value.base64, "base64").toString("base64") === value.base64) return value;
  throw error("单元格值需要标量、bigint或blob");
}

async function query(api, cap, sql, parameters = [], page = {}) {
  const result = await api.json(api.path(cap.name, "query"), "POST", { sql, parameters, ...page });
  if (result.commit !== cap.commit) throw error("数据库读取期间版本已变化，请重新读取", 409);
  return result;
}

async function database(api, name) {
  const cap = await api.json(api.path(capsuleName(name)));
  if (cap.kind !== "database") throw error("表格操作仅支持SQLite数据库cap");
  return cap;
}

async function schema(api, cap, table) {
  table = identifier(table);
  const found = await query(api, cap, "SELECT type FROM sqlite_schema WHERE name=? AND type IN ('table','view')", [table]);
  if (found.items.length !== 1) throw error("数据表不存在", 404);
  const columns = await query(api, cap,
    'SELECT name,type,pk,"notnull",dflt_value AS defaultValue,hidden FROM pragma_table_xinfo(?) ORDER BY cid',
    [table], { limit: 100 });
  if (columns.nextOffset !== null && columns.nextOffset !== undefined)
    throw error("此表超过100列，请使用SQL渐进查询", 413);
  return { columns: columns.items, type: found.items[0].type };
}

export async function readTable(api, name, { table, limit = 50, offset = 0 } = {}) {
  const cap = await database(api, name);
  if (table === undefined) {
    const names = await query(api, cap,
      "SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY (substr(name,1,1)='_'),(name='cap_run_logs'),name",
      [], { limit: 1 });
    table = names.items[0]?.name;
    if (!table) return { ...cap, table: null, schema: [], columns: [], items: [], nextOffset: null, editable: false };
  }
  const info = await schema(api, cap, table);
  const primary = info.columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  const order = primary.length ? " ORDER BY " + primary.map((column) => quote(column.name)).join(",") : "";
  const result = await query(api, cap, `SELECT * FROM ${quote(table)}${order}`, [], { limit, offset });
  return {
    ...cap,
    table,
    schema: info.columns,
    ...result,
    editable: info.type === "table" && primary.length > 0 && !/^_|^sqlite_/i.test(table),
  };
}

function values(input, columns, { primary = false } = {}) {
  object(input);
  const names = Object.keys(input);
  if (!names.length) throw error("至少指定一个单元格");
  for (const name of names) {
    const column = columns.find((item) => item.name === name);
    if (!column || column.hidden || (primary && column.pk)) throw error("列不存在、由数据库生成或不能修改主键");
  }
  return { names, bindings: names.map((name) => scalar(input[name])) };
}

function key(input, columns) {
  const primary = columns.filter((column) => column.pk).sort((a, b) => a.pk - b.pk);
  object(input);
  if (!primary.length || Object.keys(input).length !== primary.length
      || primary.some((column) => !Object.hasOwn(input, column.name) || input[column.name] === null))
    throw error("修改或删除行必须提供完整、非NULL的主键");
  return {
    clause: primary.map((column) => `${quote(column.name)} IS ?`).join(" AND "),
    bindings: primary.map((column) => scalar(input[column.name])),
  };
}

function statement(table, columns, change) {
  object(change, ["operation", "key", "values"]);
  if (change.operation === "insert") {
    if (change.key !== undefined) throw error("新增行不接受key字段");
    const data = values(change.values, columns);
    return { sql: `INSERT INTO ${quote(table)} (${data.names.map(quote).join(",")}) VALUES (${data.names.map(() => "?").join(",")})`, parameters: data.bindings };
  }
  const match = key(change.key, columns);
  if (change.operation === "delete") {
    if (change.values !== undefined) throw error("删除行不接受values字段");
    return { sql: `DELETE FROM ${quote(table)} WHERE ${match.clause}`, parameters: match.bindings };
  }
  if (change.operation !== "update") throw error("不支持的行操作");
  const data = values(change.values, columns, { primary: true });
  return { sql: `UPDATE ${quote(table)} SET ${data.names.map((name) => `${quote(name)}=?`).join(",")} WHERE ${match.clause}`, parameters: [...data.bindings, ...match.bindings] };
}

export async function writeTable(api, name, { table, changes, token } = {}) {
  const cap = await database(api, name);
  if (typeof token !== "string" || !token) throw error("表格写入需要读取时的token");
  if (token !== cap.token) throw error("数据库版本冲突，修改已保留，请重新读取后核对", 409);
  table = identifier(table);
  if (/^_|^sqlite_/i.test(table)) throw error("系统表需要通过所属统一接口管理", 409);
  const info = await schema(api, cap, table);
  if (info.type !== "table") throw error("视图只支持读取");
  if (!Array.isArray(changes) || !changes.length || changes.length > 100)
    throw error("每次提交需要1至100项行操作");
  const statements = changes.map((change) => statement(table, info.columns, change));
  return api.json(api.path(cap.name, "write"), "POST", { token, statements });
}
