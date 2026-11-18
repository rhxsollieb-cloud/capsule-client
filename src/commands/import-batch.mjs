import { dirname, resolve } from "node:path";
import { planImport } from "../import/batch-sources.mjs";
import { importBatch } from "../operations/import-batch.mjs";
import { readJsonInput } from "./input.mjs";

export async function importBatchCommand(api, { positional: [file], values }, context) {
  const manifest = await readJsonInput(file, context);
  const directory = file === "-" ? process.cwd() : dirname(resolve(file));
  const dryRun = values["dry-run"];
  const verify = values.verify && !dryRun;
  const plan = await planImport(manifest, directory, { verify });
  return importBatch(api, plan, { dryRun, verify });
}
