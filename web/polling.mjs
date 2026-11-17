// Pure status polling pauses in hidden tabs. Callers explicitly keep confirmation
// work running in the background; editing lease renewal has its own lifecycle.
export function startPolling(operation, { interval = 5000, immediate = false, enabled = () => true,
  whenHidden = () => false, document: page = globalThis.document, schedule = setTimeout,
  cancel = clearTimeout, onError = (error) => console.error("状态刷新失败", error) } = {}) {
  let timer, running = false, stopped = false, requested = false;
  const visible = () => page?.hidden !== true || whenHidden();
  const queue = () => {
    cancel(timer);
    if (stopped || !visible()) return;
    const milliseconds = typeof interval === "function" ? interval() : interval;
    timer = schedule(tick, milliseconds);
    timer?.unref?.();
  };
  const tick = async () => {
    cancel(timer);
    if (stopped || !visible()) return;
    if (running) { requested = true; return; }
    if (!enabled()) { queue(); return; }
    running = true;
    try { await operation(); } catch (error) { onError(error); }
    finally {
      running = false;
      if (requested) { requested = false; if (!stopped && visible()) { void tick(); return; } }
      queue();
    }
  };
  const wake = () => { cancel(timer); if (visible()) void tick(); };
  const visibility = () => { cancel(timer); if (visible()) wake(); };
  page?.addEventListener?.("visibilitychange", visibility);
  if (immediate) wake(); else queue();
  return { wake, stop() { stopped = true; cancel(timer); page?.removeEventListener?.("visibilitychange", visibility); } };
}

export function waitUntilVisible(page = globalThis.document) {
  if (page?.hidden !== true || !page.addEventListener) return Promise.resolve();
  return new Promise((resolve) => {
    const changed = () => {
      if (page.hidden) return;
      page.removeEventListener("visibilitychange", changed);
      resolve();
    };
    page.addEventListener("visibilitychange", changed);
  });
}
