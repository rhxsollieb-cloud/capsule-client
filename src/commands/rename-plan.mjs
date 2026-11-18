import { createHash } from "node:crypto";
import { posix } from "node:path";
import { virtualPath } from "../operations/mounts.mjs";
import { capsuleName } from "../system/paths.mjs";

const previewFields = ["prepared", "dryRun", "canApply", "name", "targetName", "token", "mountsToken", "path", "affectedPositions", "blockedReasons", "plan"];
const planFields = ["operation", "version", "sourceName", "name", "token", "mountsToken", "path", "into", "reviewDigest"];
const fields = (value, keys) => value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every((key) => keys.includes(key));
const nonempty = (value) => typeof value === "string" && value.length > 0;
const isToken = (value) => nonempty(value) && value.length <= 1024 && !/[\s\x00-\x1f\x7f]/u.test(value);
const badPlan = () => Object.assign(new Error("改名计划格式、范围或版本无效，请保留并核对完整预演文件"), { status: 400, code: "RENAME_PLAN_INVALID" });

function renameSegments(path, { sourceName, name }) {
  return path.split("/").map((segment) => segment === sourceName ? name : segment).join("/");
}

export function renameDestination(plan) {
  return plan.into === undefined ? undefined : posix.join(renameSegments(plan.into, plan), plan.name);
}

export function validRenameRange(rows, finalPath, plan, { blocked = false } = {}) {
  if (!Array.isArray(rows)) return false;
  const destination = renameDestination(plan);
  if (destination && blocked && finalPath === undefined && rows.length === 0) return true;
  if (finalPath !== destination) return false;
  const seen = new Set();
  const destinations = new Set();
  try {
    for (const row of rows) {
      if (!fields(row, ["from", "path", "name"]) || virtualPath(row.from, { root: false }) !== row.from ||
          !row.from.split("/").includes(plan.sourceName) || seen.has(row.from)) return false;
      const moved = destination && (row.from === plan.path || row.from.startsWith(plan.path + "/"));
      const path = moved ? destination + renameSegments(row.from.slice(plan.path.length), plan) : renameSegments(row.from, plan);
      if (row.path !== path || row.name !== posix.basename(path) || (!blocked && destinations.has(path))) return false;
      seen.add(row.from);
      destinations.add(path);
    }
  } catch { return false; }
  return !destination || seen.has(plan.path);
}

export function sameRenameRange(expected, actual) {
  const bySource = new Map(expected.map((row) => [row.from, row.path]));
  return expected.length === actual.length && actual.every(({ from, path }) => bySource.get(from) === path);
}

function reviewDigest(plan, path, rows, reasons) {
  const positions = rows.map((row) => [row.from, row.path, row.name]);
  const data = [plan.operation, plan.version, plan.sourceName, plan.name, plan.token, plan.mountsToken, plan.path, plan.into, path, positions, reasons];
  return createHash("sha256").update(JSON.stringify(data)).digest("hex");
}

export function preparedRename(preview, input) {
  const { sourceName, name, path, into } = input;
  if (preview?.name !== sourceName || preview.targetName !== name || !isToken(preview.token) || !isToken(preview.mountsToken) ||
      !Array.isArray(preview.blockedReasons) || !preview.blockedReasons.every(nonempty)) return undefined;
  const canApply = preview.blockedReasons.length === 0;
  if (!validRenameRange(preview.affectedPositions, preview.path, input, { blocked: !canApply })) return undefined;
  const { token, mountsToken, affectedPositions, blockedReasons } = preview;
  const plan = { operation: "rename", version: 1, sourceName, name, token, mountsToken, ...(into === undefined ? {} : { path, into }) };
  plan.reviewDigest = reviewDigest(plan, preview.path, affectedPositions, blockedReasons);
  return {
    prepared: true, dryRun: true, canApply, name: sourceName, targetName: name, token, mountsToken,
    affectedPositions, blockedReasons, ...(preview.path === undefined ? {} : { path: preview.path }), plan,
  };
}

export function parseRenamePlan(preview) {
  const plan = preview?.plan;
  if (!fields(preview, previewFields) || preview.prepared !== true || preview.dryRun !== true ||
      !fields(plan, planFields) || plan.operation !== "rename" || plan.version !== 1 ||
      plan.sourceName !== preview.name || plan.name !== preview.targetName || plan.token !== preview.token || plan.mountsToken !== preview.mountsToken)
    throw badPlan();
  try {
    if (capsuleName(plan.sourceName) !== plan.sourceName || capsuleName(plan.name) !== plan.name || plan.sourceName === plan.name ||
        (plan.into === undefined) !== (plan.path === undefined)) throw badPlan();
    if (plan.into !== undefined && (virtualPath(plan.path, { root: false }) !== plan.path || virtualPath(plan.into) !== plan.into ||
        posix.basename(plan.path) !== plan.sourceName || plan.into === plan.path || plan.into.startsWith(plan.path + "/"))) throw badPlan();
  } catch { throw badPlan(); }
  const parsed = preparedRename(preview, plan);
  if (!parsed || parsed.canApply !== preview.canApply || parsed.plan.reviewDigest !== plan.reviewDigest) throw badPlan();
  if (!parsed.canApply) throw Object.assign(new Error("改名计划存在阻止原因，请核对后重新预演"), { status: 409, code: "RENAME_PLAN_BLOCKED" });
  return { plan: parsed.plan, affectedPositions: parsed.affectedPositions };
}
