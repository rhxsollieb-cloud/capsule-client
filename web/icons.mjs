const paths = {
  search: "m21 21-5-5M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  library: "M4 3h5v18H4zM13 3h5v18h-5zM1 21h21",
  events: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  terminal: "m4 6 5 5-5 5M12 18h8",
  refresh: "M20 7v5h-5M4 17v-5h5M6.1 6a7 7 0 0 1 11.5-1L20 8M4 16l2.4 3a7 7 0 0 0 11.5-1",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  branch: "M6 4v12a3 3 0 0 0 6 0v-2a6 6 0 0 1 6-6V4M3 4a3 3 0 1 0 6 0 3 3 0 0 0-6 0ZM15 4a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z",
  capsule: "m12 3 9 5v8l-9 5-9-5V8l9-5ZM3 8l9 5 9-5M12 13v8",
  chevron: "m9 5 7 7-7 7",
  text: "M5 3h10l4 4v14H5V3ZM14 3v5h5M8 12h8M8 16h6",
  file: "M5 3h10l4 4v14H5V3ZM14 3v5h5",
  files: "M3 6h7l2 2h9v12H3V6ZM3 6V4h7l2 2",
  code: "m8 6-6 6 6 6M16 6l6 6-6 6M14 3l-4 18",
  database: "M21 5c0 2-4 4-9 4S3 7 3 5s4-3 9-3 9 1 9 3ZM3 5v14c0 2 4 3 9 3s9-1 9-3V5M3 12c0 2 4 3 9 3s9-1 9-3",
  image: "M3 3h18v18H3zM3 17l6-7 5 5 3-4 4 5M16 7h.01",
  audio: "M10 17V4l10-2v13M10 8l10-2M4 16a3 3 0 1 0 0 6 3 3 0 0 0 0-6ZM14 14a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z",
  video: "M3 5h13v14H3zM16 9l5-3v12l-5-3",
  excel: "M4 3h16v18H4zM4 9h16M4 15h16M10 3v18",
  word: "M5 3h10l4 4v14H5V3ZM8 11l2 6 2-4 2 4 2-6",
  history: "M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2",
  play: "m8 4 13 8-13 8V4Z",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  download: "M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4",
  save: "M4 3h14l3 3v15H3V3h1ZM7 3v6h10V3M7 21v-8h10v8",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
};

export function icon(name, className = "") {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.5");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  if (className) svg.setAttribute("class", className);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name] || paths.file);
  svg.append(path);
  return svg;
}

export function fillIcons(root = document) {
  for (const element of root.querySelectorAll("[data-icon]")) {
    element.replaceChildren(icon(element.dataset.icon));
  }
}
