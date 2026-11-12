import { getOfficeSession, officeStatus, openOfficeSession, saveOfficeSession, sessionPath } from "../office/sessions.mjs";

export function officeSessionCommand(api, { command, positional, values }) {
  if (command === "office-status") return officeStatus(api);
  if (command === "office-open") return openOfficeSession(api, { name: positional[0], entry: positional[1], token: values.token });
  if (command === "office-session") return getOfficeSession(api, positional[0]);
  if (command === "office-save") return saveOfficeSession(api, positional[0]);
  return api.download(sessionPath(positional[0], "recovery"), positional[1]);
}
