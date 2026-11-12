export function nativeTree(entries) {
  const root = { children: new Map() };
  for (const file of entries) {
    const segments = file.path.split("/");
    let parent = root;
    for (let index = 0; index < segments.length; index++) {
      const name = segments[index];
      const path = segments.slice(0, index + 1).join("/");
      if (!parent.children.has(name)) parent.children.set(name, { name, path, children: new Map() });
      parent = parent.children.get(name);
      if (index === segments.length - 1) parent.file = file;
    }
  }
  return root;
}

export function sortedChildren(parent) {
  return [...parent.children.values()].sort((left, right) =>
    Number(Boolean(right.children.size)) - Number(Boolean(left.children.size)) || left.name.localeCompare(right.name, "zh-CN"));
}
