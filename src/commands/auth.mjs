import { Authentication } from "../operations/auth.mjs";
import { passwordInput, usernameInput } from "./password-input.mjs";
import { localAuthentication } from "../connection/local-auth.mjs";

export async function authCommand(_api, { command, positional, values }, context = {}) {
  const auth = new Authentication({ env: context.env || process.env, human: true });
  const operation = async (name, input, fallback) => (await localAuthentication(auth, name, input)) ?? fallback();
  if (command === "connection") {
    if (!positional.length && values["office-url"] === undefined)
      return { serverUrl: auth.config.serverUrl, officeEditorUrl: auth.config.officeEditorUrl, configuration: auth.store.file, signedIn: auth.config.identitySource === "session" };
    const input = { ...(positional[0] ? { serverUrl: positional[0] } : {}), ...(values["office-url"] ? { officeEditorUrl: values["office-url"] } : {}) };
    return operation("connection", input, () => auth.connect(input));
  }
  if (command === "login") {
    const username = await usernameInput(positional[0], context);
    const password = await passwordInput(values["password-file"], context);
    const input = { username, password, ...(values.server ? { serverUrl: values.server } : {}), ...(values["office-url"] ? { officeEditorUrl: values["office-url"] } : {}) };
    return operation("login", input, () => auth.login(input));
  }
  if (command === "logout") return operation("logout", {}, () => auth.logout());
  if (command === "password-change") {
    if (values["current-password-file"] === "-" && values["new-password-file"] === "-") throw new Error("当前和新密码不能同时从同一标准输入读取，请用交互输入或独立文件");
    const currentPassword = await passwordInput(values["current-password-file"], context, "当前密码：");
    const newPassword = await passwordInput(values["new-password-file"], context, "新密码：");
    const input = { currentPassword, newPassword };
    return operation("password", input, () => auth.password(input));
  }
  throw new Error("未知身份操作");
}
