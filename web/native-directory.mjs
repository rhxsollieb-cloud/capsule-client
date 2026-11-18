import { action } from "./api.mjs";

function cannotListDirectory(error) {
  return error.status === 400 && (error.code === "BAD_REQUEST" && error.message === "请求包含不支持的字段" ||
    error.code === undefined && error.message === "操作参数无效");
}

function directoryPage(result, directory, offset) {
  const prefix = directory ? directory + "/" : "";
  const validItem = (item) => {
    if (!item || typeof item.path !== "string" || !item.path.startsWith(prefix)) return false;
    const name = item.path.slice(prefix.length);
    return Boolean(name) && !name.includes("/") && ["file", "directory"].includes(item.kind) &&
      Number.isSafeInteger(item.size) && item.size >= 0;
  };
  if (!Array.isArray(result?.items) || !result.items.every(validItem) ||
    typeof result.commit !== "string" || !result.commit ||
    (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || result.nextOffset <= offset)))
    throw new Error("目录分页响应无效，请刷新后重试");
}

export class NativeDirectoryPages {
  constructor({ request = action, onChange, onError }) {
    Object.assign(this, { request, onChange, onError });
    this.reset();
  }

  reset() {
    this.controller?.abort();
    this.controller = new AbortController();
    this.pages = new Map();
    this.legacy = false;
    this.commit = undefined;
  }

  get(directory = "") { return this.pages.get(directory); }

  async load(name, directory = "", offset = 0) {
    const pages = this.pages;
    const previous = pages.get(directory);
    if (previous?.busy || (offset && previous?.nextOffset !== offset) || (this.legacy && directory)) return false;
    const page = { ...previous, items: previous?.items || [], busy: true, error: undefined };
    pages.set(directory, page);
    this.onChange();
    try {
      const input = { name, limit: 100, offset };
      const options = { signal: this.controller.signal };
      let result;
      if (this.legacy) result = await this.request("entries", input, options);
      else {
        try { result = await this.request("entries", { ...input, directory }, options); }
        catch (error) {
          if (this.pages !== pages || directory || offset || !cannotListDirectory(error)) throw error;
          result = await this.request("entries", input, options);
          if (this.pages !== pages) return false;
          this.legacy = true;
        }
      }
      if (this.pages !== pages) return false;
      if (!this.legacy) {
        directoryPage(result, directory, offset);
        if ((directory || offset) && result.commit !== this.commit)
          throw new Error("文件目录版本已变化，请刷新内部内容");
        this.commit = result.commit;
      }
      page.items = offset ? [...page.items, ...result.items] : result.items;
      page.nextOffset = result.nextOffset;
      page.loaded = true;
      return true;
    } catch (error) {
      if (this.pages !== pages) return false;
      page.error = error.message;
      page.failedOffset = offset;
      this.onError(error);
      return false;
    } finally {
      if (this.pages === pages) { page.busy = false; this.onChange(); }
    }
  }
}
