import { ApiClient } from "../api/client.mjs";
import { configuration, officeOrigin } from "../config.mjs";
import { ConnectionStore } from "../connection/store.mjs";

const invalid = (message) => Object.assign(new Error(message), { status: 400, code: "BAD_REQUEST" });
const publicProfile = (config) => ({ serverUrl: config.serverUrl, officeEditorUrl: config.officeEditorUrl, ...(config.clientUrl ? { clientUrl: config.clientUrl } : {}) });

export function configuredConnection(env = process.env, { human = false, store = new ConnectionStore(env) } = {}) {
  return { ...configuration(env, { profile: store.read(), human }), connectionKey: store.key };
}

export class Authentication {
  constructor({ env = process.env, store = new ConnectionStore(env), human = true, fetcher = fetch, config } = {}) {
    this.env = env; this.store = store; this.human = human; this.fetcher = fetcher;
    this.config = config || configuredConnection(env, { human, store });
  }
  api(config = this.config) { return new ApiClient(config, this.fetcher); }
  async status() {
    const result = { ...publicProfile(this.config), connected: false, authenticated: false, authMode: this.config.identitySource || (this.config.token ? "token" : "none") };
    try {
      const identity = await this.api().json("/api/access/me");
      return { ...result, connected: true, authenticated: true, principal: identity.principal, permissions: identity.permissions,
        ...(identity.principal?.expiresAt || this.config.sessionExpiresAt ? { expiresAt: identity.principal?.expiresAt || this.config.sessionExpiresAt } : {}) };
    } catch (error) {
      return { ...result, connected: Boolean(error.status && error.status !== 502), error: error.message, ...(error.code ? { code: error.code } : {}) };
    }
  }
  candidate(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw invalid("连接参数需要对象");
    for (const key of Object.keys(input)) if (!["serverUrl", "officeEditorUrl", "username", "password", "currentPassword", "newPassword", "expectedUserId"].includes(key)) throw invalid("连接参数包含未知字段");
    const serverUrl = input.serverUrl ?? this.config.serverUrl;
    const officeEditorUrl = input.officeEditorUrl ?? this.config.officeEditorUrl;
    const config = configuration({ ...this.env, CAPSULE_SERVER_URL: serverUrl, CAPSULE_ONLYOFFICE_URL: officeOrigin(officeEditorUrl), CAPSULE_CLIENT_HOME: this.config.home,
      ...(this.config.clientUrl ? { CAPSULE_CLIENT_URL: this.config.clientUrl } : {}), CAPSULE_TOKEN: "" }, { human: true });
    if (new URL(config.serverUrl).protocol !== "https:" && !["127.0.0.1", "localhost", "[::1]"].includes(new URL(config.serverUrl).hostname))
      throw invalid("远程用户名密码登录需要 HTTPS，本机开发可使用回环 HTTP");
    return config;
  }
  save(config, session) {
    this.store.write({ ...publicProfile(config), ...(session ? { session } : {}) });
    const base = { ...config };
    delete base.sessionExpiresAt;
    this.config = { ...base, token: session?.token || "", identitySource: session ? "session" : "none", ...(session?.expiresAt ? { sessionExpiresAt: session.expiresAt } : {}) };
    return this.config;
  }
  async connect(input, { beforeChange = async () => {} } = {}) {
    const config = this.candidate(input);
    await beforeChange();
    const old = this.store.read();
    const session = old?.serverUrl === config.serverUrl ? old.session : undefined;
    this.save(config, session);
    return { ...publicProfile(this.config), authenticated: Boolean(session), reload: true };
  }
  async login(input, { beforeChange = async () => {} } = {}) {
    const config = this.candidate(input);
    if (typeof input.username !== "string" || !input.username.trim() || typeof input.password !== "string" || !input.password)
      throw invalid("请输入用户名和密码");
    let result;
    try { result = await this.api(config).json("/api/access/login", "POST", { username: input.username, password: input.password }); }
    catch (error) { error.message = error.message.replaceAll(input.password, "[密码已隐藏]"); throw error; }
    if (typeof result.token !== "string" || !result.token || typeof result.expiresAt !== "string" || !result.principal)
      throw Object.assign(new Error("登录响应不完整，未修改本机连接，请重新核对服务端版本"), { status: 502, code: "INVALID_RESPONSE" });
    try {
      if (input.expectedUserId !== undefined && (typeof input.expectedUserId !== "string" || result.principal.id !== input.expectedUserId))
        throw Object.assign(new Error("登录的用户身份已变化，未切换当前账户；请先保存或导出原草稿后再登录"), { status: 409, code: "AUTH_IDENTITY_CHANGED" });
      await beforeChange();
      this.save(config, { token: result.token, expiresAt: result.expiresAt, principal: result.principal });
    } catch (error) {
      try { await this.api({ ...config, token: result.token }).json("/api/access/logout", "POST", {}); } catch { /* Original local failure remains visible. */ }
      throw error;
    }
    return { ...publicProfile(this.config), authenticated: true, principal: result.principal, expiresAt: result.expiresAt, reload: true };
  }
  async logout({ beforeChange = async () => {} } = {}) {
    if (["token", "agent"].includes(this.config.identitySource)) throw Object.assign(new Error("兼容访问令牌不能通过退出登录撤销；请使用用户名密码登录，维护令牌由管理员单独撤销"), { status: 409, code: "SESSION_REQUIRED" });
    await beforeChange();
    if (this.config.token) {
      try { await this.api().json("/api/access/logout", "POST", {}); }
      catch (error) { if (error.status !== 401) throw error; }
    }
    this.clearPublishedSession("退出登录", { loggedOut: true });
    return { ...publicProfile(this.config), authenticated: false, reload: true };
  }
  async password(input, { beforeChange = async () => {} } = {}) {
    if (typeof input.currentPassword !== "string" || typeof input.newPassword !== "string") throw invalid("请输入当前密码和新密码");
    await beforeChange();
    let result;
    try { result = await this.api().json("/api/access/password", "POST", { currentPassword: input.currentPassword, newPassword: input.newPassword }); }
    catch (error) { for (const value of [input.currentPassword, input.newPassword].filter(Boolean)) error.message = error.message.replaceAll(value, "[密码已隐藏]"); throw error; }
    this.clearPublishedSession("修改密码", { changed: result.changed === true });
    return { changed: result.changed === true, authenticated: false, reload: true };
  }
  clearPublishedSession(operation, result) {
    const next = { ...this.config, token: "", identitySource: "none" };
    delete next.sessionExpiresAt;
    this.config = next;
    try { this.store.write({ ...publicProfile(next) }); }
    catch (cause) {
      throw Object.assign(new Error(`${operation}已在服务端完成，但本机连接配置保存失败；当前进程已退出登录，请核对配置权限后重新登录，不要重放已完成操作`, { cause }), {
        status: 500, code: "AUTH_LOCAL_PUBLISH_FAILED", identityChanged: true, resultChanged: true,
        result: { ...result, authenticated: false, localPersistenceFailed: true, reload: true },
      });
    }
  }
}
