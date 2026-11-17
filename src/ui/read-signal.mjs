export const BROWSER_READ_TIMEOUT_MS = 30 * 60 * 1000;

// IncomingMessage.close also occurs after a normal GET request was received.
// Only an aborted request or an unfinished response closing cancels a read.
export function browserReadSignal(request, response, { timeoutMs = BROWSER_READ_TIMEOUT_MS } = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("读取超时范围无效");
  const controller = new AbortController();
  const disconnected = () => controller.abort(new DOMException("浏览器已取消读取", "AbortError"));
  const closed = () => { if (!response.writableFinished) disconnected(); };
  request?.once("aborted", disconnected);
  response.once("close", closed);
  const timeout = setTimeout(() => controller.abort(new DOMException("原件读取超时", "TimeoutError")), timeoutMs);
  timeout.unref?.();
  if (request?.aborted || response.destroyed && !response.writableFinished) disconnected();
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      request?.removeListener("aborted", disconnected);
      response.removeListener("close", closed);
    },
  };
}
