import { readFile } from "node:fs/promises";
import { capsuleName, entryPath } from "../system/paths.mjs";

function parameters(value) {
  if (value === undefined) return undefined;
  let result;
  try {
    result = JSON.parse(value);
  } catch {
    throw new Error("--params 需为有效 JSON 数组或参数对象");
  }
  if (result === null || typeof result !== "object")
    throw new Error("--params 需为 JSON 数组或参数对象");
  return result;
}

function queryInput(values) {
  if (values.sql !== undefined) {
    const bindings = parameters(values.params);
    return {
      sql: values.sql,
      ...(bindings === undefined ? {} : { parameters: bindings }),
      ...(values.limit === undefined ? {} : { limit: values.limit }),
      ...(values.offset === undefined ? {} : { offset: values.offset }),
    };
  }
  return {
    ...(values.text === undefined ? {} : { text: values.text }),
    ...(values.entry === undefined ? {} : { entry: entryPath(values.entry) }),
    ...(values.limit === undefined ? {} : { limit: values.limit }),
    ...(values.offset === undefined ? {} : { offset: values.offset }),
  };
}

async function writeInput(values) {
  if (values.body !== undefined) {
    return {
      token: values.token,
      ...(values.entry === undefined ? {} : { entry: entryPath(values.entry) }),
      body: await readFile(values.body, "utf8"),
    };
  }
  let statements;
  if (values.sql !== undefined) {
    const bindings = parameters(values.params);
    statements = [{
      sql: values.sql,
      ...(bindings === undefined ? {} : { parameters: bindings }),
    }];
  } else {
    statements = JSON.parse(await readFile(values.file, "utf8"));
    if (!Array.isArray(statements) || !statements.length)
      throw new Error("--file 需包含非空 statements JSON 数组");
  }
  return { token: values.token, statements };
}

export async function dataCommand(api, { command, positional, values }) {
  const name = capsuleName(positional[0]);
  if (command === "get") {
    const entry = positional.length === 2 ? undefined : entryPath(positional[1]);
    const result = await api.download(api.path(name, "content", { entry }), positional.at(-1));
    return { name, entry, ...result };
  }
  const input = command === "query" ? queryInput(values) : await writeInput(values);
  return api.json(api.path(name, command), "POST", input);
}
