import { copyCapsule } from "../operations/copy.mjs";

export function copyCommand(api, { positional, values }) {
  return copyCapsule(api, { name: positional[0], to: positional[1], token: values.token });
}
