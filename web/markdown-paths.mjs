export function capsuleEntry(href, currentEntry = "README.md") {
  if (typeof href !== "string" || !href || /[?#]/.test(href)) return null;
  let path;
  try { path = decodeURIComponent(href); } catch { return null; }
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path) || path.startsWith("/") || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const parts = currentEntry.split("/").slice(0, -1);
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else {
      if (segment.toLowerCase() === ".git" || segment.includes(":")) return null;
      parts.push(segment);
    }
  }
  return parts.length ? parts.join("/") : null;
}

export function embeddedKind(path) {
  const extension = path.split(".").at(-1).toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(extension)) return "image";
  if (["mp3", "wav", "ogg", "m4a"].includes(extension)) return "audio";
  if (["mp4", "webm", "mov"].includes(extension)) return "video";
  return null;
}
