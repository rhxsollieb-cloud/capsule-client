import assert from "node:assert/strict";
import test from "node:test";
import { ApiClient } from "../src/api/client.mjs";
import { readTable, writeTable } from "../src/database/tables.mjs";
import { missingServer, serverFixture } from "./serverFixture.mjs";

async function databaseFixture(t, statements) {
  const fixture = await serverFixture(t);
  const api = new ApiClient({
    serverUrl: fixture.application.url,
    token: "integration-only-token",
    home: fixture.clientHome,
  });
  const created = await api.json("/api/capsules", "POST", { name: "业务记录", kind: "database" });
  const cap = await api.json(api.path(created.name, "write"), "POST", {
    token: created.token,
    statements,
  });
  return { ...fixture, api, cap };
}

const inventory = [
  { sql: "CREATE TABLE inventory(tenant TEXT NOT NULL,sku TEXT NOT NULL,label TEXT NOT NULL UNIQUE,quantity INTEGER NOT NULL CHECK(quantity>=0),PRIMARY KEY(tenant,sku))" },
  { sql: "INSERT INTO inventory VALUES (?,?,?,?)", parameters: ["A", "001", "Alpha", 2] },
  { sql: "INSERT INTO inventory VALUES (?,?,?,?)", parameters: ["B", "001", "Beta", 5] },
];

test("表格适配保留只读版本，复合主键更新使用绑定参数", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { api, cap } = await databaseFixture(t, inventory);
  const read = await readTable(api, cap.name, { table: "inventory", limit: 1, offset: 0 });
  assert.equal(read.commit, cap.commit);
  assert.equal(read.token, cap.token);
  assert.equal(read.editable, true);
  assert.deepEqual(read.schema.filter((column) => column.pk).map((column) => column.name), ["tenant", "sku"]);
  assert.equal(read.items.length, 1);
  assert.equal(read.nextOffset, 1);
  assert.equal((await api.json(api.path(cap.name))).commit, cap.commit);
  const value = "x'); DROP TABLE inventory; --";
  const written = await writeTable(api, cap.name, {
    token: read.token,
    table: "inventory",
    changes: [{ operation: "update", key: { tenant: "A", sku: "001" }, values: { label: value, quantity: 7 } }],
  });
  assert.notEqual(written.commit, cap.commit);
  const after = await readTable(api, cap.name, { table: "inventory", limit: 20 });
  assert.equal(after.items.length, 2);
  assert.equal(after.items.find((item) => item.tenant === "A").label, value);
  assert.equal(after.items.find((item) => item.tenant === "B").quantity, 5);
  await assert.rejects(writeTable(api, cap.name, {
    token: read.token,
    table: "inventory",
    changes: [{ operation: "delete", key: { tenant: "B", sku: "001" } }],
  }), { status: 409 });
  assert.equal((await api.json(api.path(cap.name))).commit, written.commit);
  const inserted = await writeTable(api, cap.name, {
    token: written.token,
    table: "inventory",
    changes: [{ operation: "insert", values: { tenant: "C", sku: "003", label: "Gamma", quantity: 1 } }],
  });
  assert.equal((await readTable(api, cap.name, { table: "inventory" })).items.length, 3);
  const deleted = await writeTable(api, cap.name, {
    token: inserted.token,
    table: "inventory",
    changes: [{ operation: "delete", key: { tenant: "C", sku: "003" } }],
  });
  assert.equal((await readTable(api, cap.name, { table: "inventory" })).items.length, 2);
  assert.notEqual(deleted.commit, inserted.commit);
});

test("未知表名或列名不能注入SQL，媒体登记表禁止表格直接写入", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { api, cap } = await databaseFixture(t, inventory);
  await assert.rejects(readTable(api, cap.name, { table: "inventory; DROP TABLE inventory; --" }),
    (error) => [400, 404].includes(error.status));
  await assert.rejects(writeTable(api, cap.name, {
    token: cap.token,
    table: "inventory",
    changes: [{ operation: "update", key: { tenant: "A", sku: "001" }, values: { 'quantity"=0; DELETE FROM inventory; --': 8 } }],
  }), (error) => error.status === 400);
  await assert.rejects(writeTable(api, cap.name, {
    token: cap.token,
    table: "_cap_files",
    changes: [{ operation: "delete", key: { path: "media/owned.jpg" } }],
  }), (error) => [400, 409].includes(error.status));
  const read = await readTable(api, cap.name, { table: "inventory" });
  assert.equal(read.items.length, 2);
  assert.equal(read.commit, cap.commit);
});

test("NULL或不完整主键不能定位行，约束失败整批事务和cap版本保持不变", {
  skip: missingServer,
  timeout: 60000,
}, async (t) => {
  const { api, cap } = await databaseFixture(t, [
    ...inventory,
    { sql: "CREATE TABLE nullable_keys(a TEXT,b TEXT,value TEXT,PRIMARY KEY(a,b))" },
    { sql: "INSERT INTO nullable_keys VALUES (NULL,'same','first'),(NULL,'same','second')" },
  ]);
  for (const key of [{ a: null, b: "same" }, { b: "same" }]) {
    await assert.rejects(writeTable(api, cap.name, {
      token: cap.token,
      table: "nullable_keys",
      changes: [{ operation: "update", key, values: { value: "incorrect" } }],
    }), (error) => error.status === 400);
  }
  await assert.rejects(writeTable(api, cap.name, {
    token: cap.token,
    table: "inventory",
    changes: [
      { operation: "update", key: { tenant: "A", sku: "001" }, values: { quantity: 8 } },
      { operation: "insert", values: { tenant: "C", sku: "002", label: "Beta", quantity: 1 } },
    ],
  }));
  const read = await readTable(api, cap.name, { table: "inventory" });
  assert.equal(read.items.find((item) => item.tenant === "A").quantity, 2);
  assert.equal(read.items.length, 2);
  assert.equal(read.commit, cap.commit);
  assert.equal(read.token, cap.token);
  const nullable = await readTable(api, cap.name, { table: "nullable_keys" });
  assert.deepEqual(nullable.items.map((item) => item.value), ["first", "second"]);
});
