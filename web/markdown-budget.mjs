const MAX_RENDER_NODES = 30000;
const MAX_RENDER_BYTES = 2 * 1024 * 1024;

export function exceedsMarkdownBytes(body) {
  return body.length > MAX_RENDER_BYTES || new TextEncoder().encode(body).length > MAX_RENDER_BYTES;
}

// Count before either DOMPurify pass creates a DOM. A one-line HTML table can
// have far more nodes than its line count or byte size suggests.
export function exceedsMarkdownBudget(tokens) {
  let count = 0;
  const pending = [tokens];
  while (pending.length) for (const token of pending.pop()) {
    if (++count > MAX_RENDER_NODES) return true;
    if (token.children?.length) pending.push(token.children);
    if (token.type !== "html_block" && token.type !== "html_inline") continue;
    const content = token.content || "";
    for (let index = 0; index < content.length - 1; index++)
      if (content[index] === "<" && /[a-z/!]/i.test(content[index + 1]) && ++count > MAX_RENDER_NODES) return true;
  }
  return false;
}
