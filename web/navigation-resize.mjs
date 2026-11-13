import { node } from "./dom.mjs";

const storageKey = "capsule-navigation-widths";
const defaults = { library: 224, native: 205 };
const minimum = { library: 160, native: 150 };
const maximum = { library: 480, native: 520 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function fitNavigationWidths(preferred, viewport, hasNative) {
  const budget = Math.max(minimum.library + (hasNative ? minimum.native : 0), viewport - 260);
  let library = clamp(preferred.library, minimum.library, Math.min(maximum.library, budget - (hasNative ? minimum.native : 0)));
  let native = clamp(preferred.native, minimum.native, maximum.native);
  if (hasNative) {
    native = Math.min(native, Math.max(minimum.native, budget - library));
    library = Math.min(library, Math.max(minimum.library, budget - native));
  }
  return { library: Math.round(library), native: Math.round(native) };
}

export function navigationWidthRange(side, widths, viewport, hasNative) {
  const other = hasNative ? widths[side === "library" ? "native" : "library"] : 0;
  return { min: minimum[side], max: Math.max(minimum[side], Math.min(maximum[side], viewport - 260 - other)) };
}

function storedWidths() {
  let value;
  try { value = JSON.parse(localStorage.getItem(storageKey)); } catch { /* Widths work without storage. */ }
  return Object.fromEntries(Object.entries(defaults).map(([side, fallback]) => [side, Number.isFinite(value?.[side]) && value[side] > 0 ? value[side] : fallback]));
}

export class NavigationResize {
  constructor({ workspace, library, nativeNavigation }) {
    Object.assign(this, { workspace });
    this.preferred = storedWidths();
    this.handles = {};
    for (const [side, target] of Object.entries({ library, native: nativeNavigation })) {
      const handle = node("div", "navigation-resizer");
      handle.dataset.side = side;
      handle.tabIndex = 0;
      handle.setAttribute("role", "separator");
      handle.setAttribute("aria-orientation", "vertical");
      handle.setAttribute("aria-label", side === "library" ? "调整知识库宽度" : "调整内部内容列宽度");
      handle.setAttribute("aria-controls", target.id);
      handle.title = "拖动调整宽度，← → 微调，Shift 加速，Home / End 调至最小 / 最大";
      handle.addEventListener("pointerdown", (event) => this.start(side, event));
      handle.addEventListener("lostpointercapture", (event) => this.cancel(event));
      handle.addEventListener("keydown", (event) => this.keydown(side, event));
      workspace.insertBefore(handle, target.nextSibling);
      this.handles[side] = handle;
    }
    this.move = (event) => {
      if (!this.drag || event.pointerId !== this.drag.pointerId) return;
      this.change(this.drag.side, this.drag.width + event.clientX - this.drag.x);
    };
    this.end = (event) => { if (event.pointerId === this.drag?.pointerId) this.finish(true); };
    this.cancel = (event) => { if (this.drag && (event.pointerId === undefined || event.pointerId === this.drag.pointerId)) this.finish(false); };
    this.resized = () => this.apply();
    window.addEventListener("resize", this.resized);
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(this.resized);
      this.resizeObserver.observe(workspace);
    }
    if (typeof MutationObserver !== "undefined") {
      this.visibilityObserver = new MutationObserver(this.resized);
      this.visibilityObserver.observe(workspace, { attributes: true, attributeFilter: ["class"] });
    }
    this.apply();
  }
  apply() {
    this.hasNative = this.workspace.classList.contains("has-native");
    const collapsed = this.workspace.classList.contains("library-collapsed");
    if (this.drag && (collapsed || this.drag.side === "native" && !this.hasNative)) { this.finish(false); return; }
    this.viewport = this.workspace.clientWidth || window.innerWidth;
    this.widths = fitNavigationWidths(this.preferred, this.viewport, this.hasNative);
    this.workspace.style.setProperty("--library-user-width", `${this.widths.library}px`);
    this.workspace.style.setProperty("--native-user-width", `${this.widths.native}px`);
    for (const [side, handle] of Object.entries(this.handles)) {
      const range = navigationWidthRange(side, this.widths, this.viewport, this.hasNative);
      const left = side === "library" ? this.widths.library : this.widths.library + this.widths.native;
      handle.style.left = `${left}px`;
      handle.setAttribute("aria-valuenow", String(this.widths[side]));
      handle.setAttribute("aria-valuemin", String(range.min));
      handle.setAttribute("aria-valuemax", String(range.max));
      handle.setAttribute("aria-valuetext", `${this.widths[side]} 像素`);
    }
  }
  change(side, width) {
    const range = navigationWidthRange(side, this.widths, this.viewport, this.hasNative);
    this.preferred[side] = clamp(width, range.min, range.max);
    this.apply();
  }
  keydown(side, event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    const range = navigationWidthRange(side, this.widths, this.viewport, this.hasNative);
    const delta = (event.shiftKey ? 40 : 10) * (event.key === "ArrowLeft" ? -1 : 1);
    const width = event.key === "Home" ? range.min : event.key === "End" ? range.max : this.widths[side] + delta;
    this.change(side, width);
    this.persist();
  }
  start(side, event) {
    if (event.button !== 0 || event.isPrimary === false || this.drag) return;
    event.preventDefault();
    this.apply();
    this.drag = { side, pointerId: event.pointerId, x: event.clientX, width: this.widths[side], preferred: { ...this.preferred } };
    this.handles[side].focus();
    try { this.handles[side].setPointerCapture(event.pointerId); } catch { /* Document listeners remain active. */ }
    document.body.classList.add("navigation-resizing");
    document.addEventListener("pointermove", this.move);
    document.addEventListener("pointerup", this.end);
    document.addEventListener("pointercancel", this.cancel);
    window.addEventListener("blur", this.cancel);
  }
  finish(commit) {
    if (!this.drag) return;
    const drag = this.drag;
    this.drag = null;
    document.body.classList.remove("navigation-resizing");
    document.removeEventListener("pointermove", this.move);
    document.removeEventListener("pointerup", this.end);
    document.removeEventListener("pointercancel", this.cancel);
    window.removeEventListener("blur", this.cancel);
    try { this.handles[drag.side].releasePointerCapture(drag.pointerId); } catch { /* Capture may already be released. */ }
    if (commit) this.persist();
    else { this.preferred = drag.preferred; this.apply(); }
  }
  persist() {
    try { localStorage.setItem(storageKey, JSON.stringify(this.preferred)); } catch { /* Widths work without storage. */ }
  }
  destroy() {
    this.finish(false);
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    window.removeEventListener("resize", this.resized);
    Object.values(this.handles).forEach((handle) => handle.remove());
  }
}
