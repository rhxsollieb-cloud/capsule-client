export function initializeTheme() {
  let theme = "light";
  try { theme = localStorage.getItem("capsule-theme") === "dark" ? "dark" : "light"; } catch { /* Storage is optional. */ }
  const apply = () => { document.documentElement.dataset.theme = theme; };
  apply();
  return {
    isDark: () => theme === "dark",
    toggle() {
      theme = theme === "light" ? "dark" : "light";
      try { localStorage.setItem("capsule-theme", theme); } catch { /* Theme works without storage. */ }
      apply();
    },
  };
}
