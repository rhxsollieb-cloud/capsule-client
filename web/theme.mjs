export function initializeTheme() {
  const control = document.getElementById("theme-toggle");
  let theme = "light";
  try { theme = localStorage.getItem("capsule-theme") === "dark" ? "dark" : "light"; } catch { /* Storage is optional. */ }
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    control.textContent = theme === "light" ? "深色" : "浅色";
    control.setAttribute("aria-label", `切换到${theme === "light" ? "深色" : "浅色"}主题`);
  };
  control.addEventListener("click", () => {
    theme = theme === "light" ? "dark" : "light";
    try { localStorage.setItem("capsule-theme", theme); } catch { /* Theme works without storage. */ }
    apply();
  });
  apply();
}
