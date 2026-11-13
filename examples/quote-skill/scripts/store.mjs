import { mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

export function problem(message, status = 400, code = "INVALID_INPUT") {
  return Object.assign(new Error(message), { status, code });
}

function money(cents) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

function values(quantity, unitPrice) {
  const count = String(quantity);
  const price = String(unitPrice);
  if (!/^\d+$/.test(count) || !Number.isSafeInteger(Number(count)) || Number(count) > 1000000)
    throw problem("数量需为 0–1,000,000 的整数");
  if (!/^\d+(?:\.\d{1,2})?$/.test(price)) throw problem("单价需为非负数，最多两位小数");
  const [whole, fraction = ""] = price.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > 1000000000)
    throw problem("单价不能超过 10,000,000.00 元");
  return { quantity: Number(count), unitPriceCents: cents };
}

function publicQuote(row) {
  return {
    quantity: row.quantity,
    unitPrice: money(row.unit_price_cents),
    amount: money(row.quantity * row.unit_price_cents),
    currency: "CNY",
    version: row.version,
    updatedAt: row.updated_at,
  };
}

function contains(root, target) {
  const path = relative(root, target);
  return !path || path !== ".." && !path.startsWith(".." + sep) && !isAbsolute(path);
}

export function openStore(directory = process.env.CAPSULE_SKILL_STATE) {
  if (typeof directory !== "string" || !directory.trim())
    throw problem("请设置 CAPSULE_SKILL_STATE，指向代码目录之外的本机运行状态目录", 400, "STATE_REQUIRED");
  const skillRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
  const target = resolve(directory);
  if (contains(skillRoot, target))
    throw problem("运行状态不能保存在 skill 代码目录内", 400, "STATE_LOCATION");
  mkdirSync(target, { recursive: true, mode: 0o700 });
  const actual = realpathSync(target);
  if (contains(skillRoot, actual))
    throw problem("运行状态不能通过链接保存在 skill 代码目录内", 400, "STATE_LOCATION");
  const database = new DatabaseSync(join(actual, "state.sqlite"));
  try {
    database.exec(`
      PRAGMA busy_timeout=5000;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS quote (
        id INTEGER PRIMARY KEY CHECK(id=1),
        quantity INTEGER NOT NULL CHECK(quantity BETWEEN 0 AND 1000000),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents BETWEEN 0 AND 1000000000),
        version INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    database.prepare("INSERT OR IGNORE INTO quote VALUES (1,12,19900,1,?)").run(new Date().toISOString());
  } catch (error) { database.close(); throw error; }
  const read = () => publicQuote(database.prepare("SELECT * FROM quote WHERE id=1").get());
  return {
    read,
    set(quantity, unitPrice, expectedVersion) {
      const input = values(quantity, unitPrice);
      if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1))
        throw problem("version 需为已读取的正整数版本号");
      database.exec("BEGIN IMMEDIATE");
      try {
        const previous = read();
        if (expectedVersion !== undefined && previous.version !== expectedVersion)
          throw problem("报价已由其他位置更新，请重新读取后核对；当前输入已保留", 409, "VERSION_CONFLICT");
        database.prepare("UPDATE quote SET quantity=?,unit_price_cents=?,version=version+1,updated_at=? WHERE id=1")
          .run(input.quantity, input.unitPriceCents, new Date().toISOString());
        const saved = read();
        database.exec("COMMIT");
        return saved;
      } catch (error) { database.exec("ROLLBACK"); throw error; }
    },
    close() { database.close(); },
  };
}
