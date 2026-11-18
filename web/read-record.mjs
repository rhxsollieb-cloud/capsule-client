const invalid = () => Object.assign(new Error("正文分页响应不完整或续读范围不连续，未作为全文载入。"), { status: 502, code: "INVALID_RESPONSE" });

export function checkedReadPage(record, { from, token, total } = {}) {
  const lines = record?.lines;
  if (typeof record?.body !== "string" || record.body.includes("\0") || typeof record.token !== "string" || !record.token
    || !lines || !Number.isSafeInteger(lines.from) || lines.from < 1 || !Number.isSafeInteger(lines.to)
    || !Number.isSafeInteger(lines.total) || lines.total < 0 || lines.to < 0 || lines.to > lines.total
    || lines.to < Math.min(lines.from - 1, lines.total) || (from !== undefined && lines.from !== from)) throw invalid();
  if (token !== undefined && record.token !== token)
    throw Object.assign(new Error("读取期间内容已变化，请刷新后核对；不会拼接不同版本。"), { status: 409, code: "VERSION_CONFLICT" });
  if (total !== undefined && lines.total !== total) throw invalid();
  const count = Math.max(0, lines.to - lines.from + 1);
  let actual = 1;
  for (let index = 0; index < record.body.length; index++) if (record.body[index] === "\n") actual++;
  if (count ? actual !== count : record.body !== "" || lines.from <= lines.total) throw invalid();
  if (lines.nextLine !== (lines.to < lines.total ? lines.to + 1 : null)
    || lines.truncated !== (lines.from > 1 || lines.to < lines.total)) throw invalid();
  return record;
}
