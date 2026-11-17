import { json, requestJson, uiError } from "./errors.mjs";

const operations = {
  connection: ["serverUrl", "officeEditorUrl"],
  login: ["serverUrl", "officeEditorUrl", "username", "password", "expectedUserId"],
  logout: [],
  password: ["currentPassword", "newPassword"],
};

export async function authRoute(request, response, url, { authentication, beforeChange, changed }) {
  const operation = url.pathname.slice("/ui/auth/".length);
  if (operation === "status") {
    if (request.method !== "GET") throw uiError("身份状态需要 GET", 405);
    json(response, 200, await authentication.status());
    return;
  }
  if (request.method !== "POST") throw uiError("身份操作需要 POST", 405);
  if (!Object.hasOwn(operations, operation)) throw uiError("身份接口不存在", 404);
  const input = await requestJson(request);
  if (Object.keys(input).some((key) => !operations[operation].includes(key))) throw uiError("身份操作参数无效");
  const options = { beforeChange };
  const result = operation === "logout" ? await authentication.logout(options)
    : await authentication[operation === "connection" ? "connect" : operation](input, options);
  changed();
  json(response, 200, result);
}
