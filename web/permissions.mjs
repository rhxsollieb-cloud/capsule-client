// Undefined keeps standalone legacy views usable; connect explicitly sets unknown before querying me.
let identity;
export function setIdentity(value) { identity = value; }
export function currentIdentity() { return identity; }
export function canManage() { return identity === undefined || identity?.permissions?.manage === true || identity?.principal?.role === "admin"; }
export function canCreate() { return identity === undefined || identity?.permissions?.create === true; }
export function canEdit(cap) {
  if (identity === null || identity?.permissions?.readOnly) return false;
  if (cap?.permissions) return cap.permissions.edit === true;
  return identity === undefined || Boolean(identity && !identity.permissions?.readOnly);
}
