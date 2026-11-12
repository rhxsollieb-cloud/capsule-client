export function loadOfficeApi(editorUrl) {
  const url = new URL(editorUrl);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname))
    return Promise.reject(new Error("文档服务地址无效"));
  const source = url.origin + "/web-apps/apps/api/documents/api.js";
  let script = document.getElementById("capsule-onlyoffice-api");
  if (script && script.src !== source) return Promise.reject(new Error("文档服务地址已变化，请重新载入工作台"));
  if (script?.dataset.ready === "true" && window.DocsAPI?.DocEditor) return Promise.resolve(window.DocsAPI);
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      clearTimeout(timeout);
      if (error) { script.remove(); reject(error); }
      else if (!window.DocsAPI?.DocEditor) { script.remove(); reject(new Error("文档服务未提供DocsAPI")); }
      else { script.dataset.ready = "true"; resolve(window.DocsAPI); }
    };
    const timeout = setTimeout(() => finish(new Error("加载文档编辑器超时，请检查文档服务")), 30000);
    if (!script) {
      script = document.createElement("script");
      script.id = "capsule-onlyoffice-api";
      script.src = source;
      script.async = true;
      script.addEventListener("load", () => finish(), { once: true });
      script.addEventListener("error", () => finish(new Error("无法加载ONLYOFFICE编辑器")), { once: true });
      document.head.append(script);
    } else {
      script.addEventListener("load", () => finish(), { once: true });
      script.addEventListener("error", () => finish(new Error("无法加载ONLYOFFICE编辑器")), { once: true });
    }
  });
}
