#!/usr/bin/env node
import { pathToFileURL } from "node:url";
import { ApiClient } from "./api/client.mjs";
import { configuration, assertNodeVersion } from "./config.mjs";
import { parseArguments } from "./commands/arguments.mjs";
import { help } from "./commands/help.mjs";
import { capsuleCommand } from "./commands/capsules.mjs";
import { mountCommand } from "./commands/mounts.mjs";
import { dataCommand } from "./commands/data.mjs";
import { eventCommand } from "./commands/events.mjs";
import { synchronize } from "./cache/sync.mjs";
import { runCapsule } from "./runtime/run.mjs";
import { doctor } from "./runtime/doctor.mjs";

export async function dispatch(args, api) {
  switch (args.command) {
    case "health":
      return api.json("/api/health");
    case "doctor":
      return doctor(api.config);
    case "sync":
      return synchronize(api, args.positional[0]);
    case "run":
      return runCapsule(api, args.positional[0], args.runtimeArgs, {
        logCap: args.values["log-cap"],
      });
    case "query":
    case "write":
    case "get":
      return dataCommand(api, args);
    case "revert":
    case "event":
    case "events":
      return eventCommand(api, args);
    case "ls":
    case "mount":
    case "position":
    case "move":
    case "unmount":
      return mountCommand(api, args);
    default:
      return capsuleCommand(api, args);
  }
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  io = process,
) {
  let config;
  try {
    assertNodeVersion();
    const args = parseArguments(argv);
    if (args.command === "help") {
      io.stdout.write(help(args.topic));
      return 0;
    }
    config = configuration(env);
    const result = await dispatch(args, new ApiClient(config));
    io.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return args.command === "run" ? result.exitCode || (result.logError ? 1 : 0) : 0;
  } catch (error) {
    if (error.result) io.stdout.write(JSON.stringify(error.result, null, 2) + "\n");
    else if (error.eventId) {
      const receipt = {
        eventId: error.eventId,
        ...(error.code ? { code: error.code } : {}),
        status: error.status,
      };
      io.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
    }
    let message = String(error.message);
    if (config?.token)
      message = message.replaceAll(config.token, "[凭据已隐藏]");
    io.stderr.write(message + "\n");
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main();
