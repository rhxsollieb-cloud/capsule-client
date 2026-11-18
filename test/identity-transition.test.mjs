import test from "node:test";
import assert from "node:assert/strict";
import { identityChangeProof } from "../web/identity-transition.mjs";

test("有草稿时仅允许向同一服务器重新认证同一员工，并携UUID核对证明", () => {
  const context = { dirty: true, principal: { id: "employee-1", username: "editor01" }, serverUrl: "https://company.example" };
  const input = { username: "EDITOR01", password: "not-persisted", serverUrl: "https://company.example/" };
  assert.deepEqual(identityChangeProof("login", input, context), { expectedUserId: "employee-1" });
  assert.deepEqual(identityChangeProof("login", { ...input, username: "renamed-editor" }, context), { expectedUserId: "employee-1" });
  assert.equal(input.expectedUserId, undefined);
  for (const changed of [{ ...input, serverUrl: "https://another.example" }, { ...input, serverUrl: "invalid" }])
    assert.throws(() => identityChangeProof("login", changed, context), /草稿/);
  for (const operation of ["logout", "password", "connection"])
    assert.throws(() => identityChangeProof(operation, input, context), /草稿/);
  assert.deepEqual(identityChangeProof("logout", {}, { ...context, dirty: false }), {});
  assert.throws(() => identityChangeProof("login", { ...input, officeEditorUrl: "https://different-docs.example" }, { ...context, officeEditorUrl: "https://docs.example" }), /草稿/);
});
