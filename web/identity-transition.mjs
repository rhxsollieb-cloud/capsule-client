export function identityChangeProof(operation, input, { dirty, principal, serverUrl, officeEditorUrl } = {}) {
  if (!dirty) return {};
  let sameServer = false;
  try {
    sameServer = new URL(input.serverUrl).origin === serverUrl
      && (!officeEditorUrl || new URL(input.officeEditorUrl || officeEditorUrl).origin === officeEditorUrl);
  } catch { /* Invalid input cannot authorize a switch. */ }
  // A username may have been renamed while this draft was open. The BFF checks
  // the immutable user ID after authentication and before publishing identity.
  if (operation === "login" && sameServer && principal?.id) return { expectedUserId: principal.id };
  throw new Error("请先保存或处理当前草稿，再切换连接、账户或密码。会话过期时可使用原用户名重新登录。");
}
