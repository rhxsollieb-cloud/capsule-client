#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { ApiClient } from "./api/client.mjs";
import { configuration, assertNodeVersion } from "./config.mjs";
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
    if (!commandDefinition(args.command).offline) config = configuration(env);
    const result = await dispatch(args, config ? new ApiClient(config) : undefined, { stdin: io.stdin || process.stdin });
    await printResult(result, args, io);
    return args.command === "run" ? result.exitCode || (result.logError ? 1 : 0) : 0;
  } catch (error) {
    const token = config?.token || (typeof env.CAPSULE_TOKEN === "string" ? env.CAPSULE_TOKEN : undefined);
    if (jsonErrors || args?.output?.jsonErrors) {
      const value = machineError(error, { token, command: args?.command });
      io.stdout.write(JSON.stringify(boundedResult(value, args?.output?.maxChars), null, 2) + "\n");
    } else if (error.result) {
      const { result } = machineError(error, { token });
      io.stdout.write(JSON.stringify(boundedResult(result, args?.output?.maxChars), null, 2) + "\n");
    }
    else if (error.eventId) io.stdout.write(JSON.stringify({ eventId: error.eventId, ...(error.code ? { code: error.code } : {}), status: error.status }, null, 2) + "\n");
    let message = String(error.message);
    if (token) message = message.replaceAll(token, "[凭据已隐藏]");
    io.stderr.write(message + "\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
