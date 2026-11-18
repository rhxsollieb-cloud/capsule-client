const interactive = "input, textarea, select, [contenteditable], a[href], audio, video, summary, [role=slider], [role=spinbutton]";

// Reading shortcuts must leave navigation, text selection, and native controls alone.
export function bindReaderShortcuts(reader) {
  const document = reader.wrapper.ownerDocument;
  const keyboard = (event) => {
    if (event.defaultPrevented || event.isComposing || event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !reader.active() || reader.busy || !reader.record) return;
    const target = event.target;
    if (target !== document.body && target !== document.documentElement && !reader.wrapper.contains(target)) return;
    if (target.closest?.(interactive)) return;
    const control = target.closest?.("button, [role=button]");
    if (control && control !== reader.previous && control !== reader.next) return;
    if ([...document.querySelectorAll("dialog[open], [role=menu], [aria-modal=true]")]
      .some((element) => !element.hidden && element.getClientRects().length)) return;
    if (document.getSelection()?.isCollapsed === false) return;
    const previous = event.key === "ArrowLeft";
    if (previous ? !(reader.canBack?.() ?? reader.history.length) : !reader.record.lines.nextLine) return;
    event.preventDefault();
    if (previous) void reader.back();
    else void reader.go(reader.record.lines.nextLine);
  };
  document.addEventListener("keydown", keyboard);
  return () => document.removeEventListener("keydown", keyboard);
}
