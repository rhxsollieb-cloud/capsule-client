#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { ApiClient } from "./api/client.mjs";
import { assertNodeVersion } from "./config.mjs";
import { configuredConnection } from "./operations/auth.mjs";
import { parseArguments } from "./commands/arguments.mjs";
import { commandDefinition } from "./commands/catalog.mjs";
import { help } from "./commands/help.mjs";
import { dispatch } from "./commands/dispatch.mjs";
import { boundedResult, machineError, prepareOutput, printResult } from "./commands/output.mjs";

export { dispatch };

export async function main(argv = process.argv.slice(2), env = process.env, io = process) {
  let config;
  let args;
  const separator = argv.indexOf("--");
  const cliArgs = separator < 0 ? argv : argv.slice(0, separator);
  const jsonErrors = cliArgs.includes("--json-errors") || cliArgs.includes("--json-errors=true");
  try {
    assertNodeVersion();
    args = parseArguments(argv);
    if (args.command === "help") { io.stdout.write(help(args.topic, { json: args.helpJson })); return 0; }
    await prepareOutput(args.output);
    if (!commandDefinition(args.command).offline) config = configuredConnection(env);
    const result = await dispatch(args, config ? new ApiClient(config) : undefined, { stdin: io.stdin || process.stdin, stderr: io.stderr || process.stderr, env });
    await printResult(result, args, io);
    if (args.command === "run") return result.exitCode || (result.logError ? 1 : 0);
    return args.command === "import-batch" ? result.exitCode || 0 : 0;
  } catch (error) {
    const token = config?.token || (typeof env.CAPSULE_TOKEN === "string" ? env.CAPSULE_TOKEN : undefined);
    const leaseIndex = cliArgs.findIndex((value) => value === "--lease" || value.startsWith("--lease="));
    const leaseToken = args?.values?.lease || config?.leaseToken || env.CAPSULE_LEASE_TOKEN ||
      (leaseIndex < 0 ? undefined : cliArgs[leaseIndex].startsWith("--lease=") ? cliArgs[leaseIndex].slice(8) : cliArgs[leaseIndex + 1]);
    if (jsonErrors || args?.output?.jsonErrors) {
      const value = machineError(error, { token, leaseToken, command: args?.command });
      if (["user-create", "credential-create", "lease-acquire"].includes(args?.command) && (error.result?.credentialIssued || error.result?.leaseAcquired) && typeof error.result.token === "string") {
        // Output-file failure must not lose a token that the server will never return again.
        value.error.message = error.result.leaseAcquired ? "编辑占用已获取，但输出文件未保存。请保存本响应，及时续租或释放。" : "凭据已签发，但输出文件未保存。请立即保存本响应，勿重放签发。";
        value.result = { token: error.result.token, ...(error.result.leaseAcquired ? { leaseAcquired: true, id: error.result.id } : { credentialIssued: true }), outputFailed: true };
      }
      io.stdout.write(JSON.stringify(boundedResult(value, args?.output?.maxChars), null, 2) + "\n");
    } else if (error.result) {
      const { result } = machineError(error, { token, leaseToken });
      io.stdout.write(JSON.stringify(boundedResult(result, args?.output?.maxChars), null, 2) + "\n");
    }
    else if (error.eventId || error.operationId) io.stdout.write(JSON.stringify({ ...(error.eventId ? { eventId: error.eventId } : {}), ...(error.operationId ? { operationId: error.operationId } : {}), ...(error.code ? { code: error.code } : {}), status: error.status }, null, 2) + "\n");
    let message = String(error.message);
    if (token) message = message.replaceAll(token, "[凭据已隐藏]");
    if (leaseToken) message = message.replaceAll(leaseToken, "[凭据已隐藏]");
    io.stderr.write(message + "\n");
    return 1;
  }
}

function invokedDirectly(entry) {
  if (!entry) return false;
  if (pathToFileURL(entry).href === import.meta.url) return true;
  // Node 24.0 lacks import.meta.main. npm's POSIX bin link names the same entry.
  try { return pathToFileURL(realpathSync(entry)).href === import.meta.url; }
  catch { return false; }
}

if (import.meta.main ?? invokedDirectly(process.argv[1]))
  process.exitCode = await main();
