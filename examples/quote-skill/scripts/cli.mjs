import { openStore, problem } from "./store.mjs";

const [command, ...args] = process.argv.slice(2);
let store;
try {
  let result;
  if (command === "--help" && !args.length) {
    result = {
      name: "quote-skill",
      usage: ["node scripts/cli.mjs --help", "node scripts/cli.mjs state", "node scripts/cli.mjs set QUANTITY UNIT_PRICE [--version VERSION]"],
      environment: { CAPSULE_SKILL_STATE: "代码目录之外的本机运行状态目录；CLI 与界面使用同一目录" },
    };
  } else if (command === "state" && !args.length) {
    store = openStore();
    result = store.read();
  } else if (command === "set" && (args.length === 2 || args.length === 4 && args[2] === "--version")) {
    store = openStore();
    result = store.set(args[0], args[1], args.length === 4 ? Number(args[3]) : undefined);
  } else throw problem("用法无效，请运行 node scripts/cli.mjs --help", 400, "USAGE");
  process.stdout.write(JSON.stringify(result) + "\n");
} catch (error) {
  process.stderr.write(JSON.stringify({ error: error.message, code: error.code || "QUOTE_FAILED" }) + "\n");
  process.exitCode = error.status === 400 ? 2 : 1;
} finally { store?.close(); }
