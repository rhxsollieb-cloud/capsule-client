export function skillEnvironment(values = {}) {
  const environment = { ...process.env, ...values };
  delete environment.CAPSULE_TOKEN;
  delete environment.CAPSULE_LEASE_TOKEN;
  delete environment.CAPSULE_ONLYOFFICE_JWT_SECRET;
  return environment;
}
