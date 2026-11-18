import { fileURLToPath } from "node:url";
import { readTextInput } from "./input.mjs";

const topics = {
  data: { title: "胶囊数据规范", summary: "数据类别、存储与统一访问约定。", source: "docs/data-format.md" },
  cli: { title: "CLI 工作流程", summary: "查看目录、预演、写入、批量组织与回执。", source: "docs/cli-parity.md" },
  skills: { title: "代码 Skill 与本机协作", summary: "Skill格式、独立CLI及可选本机页面。", source: "docs/skills.md" },
};

function range(value, fallback, maximum) {
  const number = value ?? fallback;
  if (!Number.isSafeInteger(number) || number < 1 || number > maximum)
    throw new Error(`指南行范围需为1..${maximum}的有效整数`);
  return number;
}

export async function guideCommand(_api, { positional, values = {} }) {
  const [topic] = positional;
  const identity = { guideVersion: 1, scope: "client-bundled" };
  if (topic === undefined) {
    if (values.from !== undefined || values.limit !== undefined) throw new Error("指南分页需要指定主题");
    return { ...identity, topics: Object.entries(topics).map(([topic, entry]) => ({ topic, ...entry })) };
  }
  if (!Object.hasOwn(topics, topic)) throw new Error("未知指南主题：" + topic + "；可用 " + Object.keys(topics).join("、"));
  const { title, source } = topics[topic];
  const from = range(values.from, 1, 1000000);
  const limit = range(values.limit, 60, 200);
  // Only the bundled whitelist determines the file; caller paths and cwd are never used.
  const body = await readTextInput(fileURLToPath(new URL("../../" + source, import.meta.url)));
  const lines = body === "" ? [] : body.split(/\r\n|\n|\r/);
  const end = Math.min(from - 1 + limit, lines.length);
  const nextLine = end < lines.length ? end + 1 : null;
  return {
    ...identity, topic, title, source,
    body: lines.slice(from - 1, end).join("\n"),
    lines: { from, to: end, total: lines.length, nextLine, truncated: from > 1 || nextLine !== null },
    next: nextLine === null ? null : { topic, from: nextLine, limit },
  };
}
