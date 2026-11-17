import { homedir } from "node:os";
import { resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

export function defaultClientHome(env = process.env, { platform = process.platform, userHome = homedir() } = {}) {
  if (platform === "win32") {
    const local = env.LOCALAPPDATA || win32.join(userHome, "AppData", "Local");
    return win32.resolve(local, "Capsule");
  }
  return resolve(fileURLToPath(new URL("../../.local", import.meta.url)));
}
