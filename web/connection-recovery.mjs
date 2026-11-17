// Authentication failures can arrive from selection, polling and several panels
// together. They must share one reconciliation, never replay a write operation.
export function singleConnection(operation) {
  let pending;
  return () => {
    if (pending) return pending;
    const current = Promise.resolve().then(operation).finally(() => {
      if (pending === current) pending = undefined;
    });
    pending = current;
    return current;
  };
}

export async function restoreConnectionContent({ workspace, tree, sessionChanged = false,
  rebind = () => {}, onOfficeSessionChanged = () => {} }) {
  const item = workspace.item || tree.selected;
  let selected = false;
  if (!workspace.cap && item) {
    // A failed stat clears cap but retains the user's selection. Only the
    // reading/navigation path is restored; saving and other writes are not.
    if (await workspace.select(item) === false) return true;
    selected = true;
  }
  if (!selected && workspace.cap) await workspace.refresh();
  if (sessionChanged) {
    rebind();
    workspace.chrome?.();
    if (workspace.office) onOfficeSessionChanged(workspace.office);
  }
  return Boolean(item || workspace.cap);
}
