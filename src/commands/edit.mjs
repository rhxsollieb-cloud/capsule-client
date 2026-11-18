import { editText } from "../operations/content.mjs";
import { applyEdits, prepareEdits } from "../operations/edit-plan.mjs";
import { patchError, readPatchPlan, validatePatchItems } from "../operations/text-patch.mjs";
import { readJsonInput, TEXT_INPUT_LIMIT } from "./input.mjs";

export async function editCommand(api, { positional: [name, entry], values }, context) {
  if (values.prepare !== undefined) {
    const items = validatePatchItems(await readJsonInput(values.prepare, context));
    const preview = await prepareEdits(api, items);
    if (preview.canApply && Buffer.byteLength(JSON.stringify(preview, null, 2) + "\n") > TEXT_INPUT_LIMIT)
      throw patchError("预演文件超过1MiB，请拆分修改清单", 413, "PLAN_TOO_LARGE");
    return preview;
  }
  if (values.plan !== undefined) return applyEdits(api, readPatchPlan(await readJsonInput(values.plan, context)));
  return editText(api, { name, entry, oldText: values["old-text"], newText: values["new-text"], all: values.all,
    token: values.token, dryRun: values["dry-run"], description: values.description });
}
