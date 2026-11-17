export function skillEnvironment(values = {}) {
  const environment = {};
  const privateKeys = new Set(["CAPSULE_TOKEN", "CAPSULE_LEASE_TOKEN", "CAPSULE_ONLYOFFICE_JWT_SECRET"]);
  for (const source of [process.env, values]) {
    for (const [key, value] of Object.entries(source)) {
      const normalized = key.toUpperCase();
      if (!privateKeys.has(normalized))
        environment[process.platform === "win32" ? normalized : key] = value;
    }
  }
  return environment;
}
