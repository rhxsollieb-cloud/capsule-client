export const text = Object.freeze({ type: "string" });
export const flag = Object.freeze({ type: "boolean" });
export const requiredText = Object.freeze({ type: "string", required: true, nonempty: true });
export const version = Object.freeze({ type: "string", required: true, nonempty: true, missing: "写入需要--token，请先读取当前实体或位置版本" });
export const integer = (minimum, maximum) => ({ type: "integer", minimum, maximum });

export const presentationOptions = Object.freeze({
  fields: text,
  raw: flag,
  "max-chars": integer(512, 200000),
  out: text,
  "json-errors": flag,
});
