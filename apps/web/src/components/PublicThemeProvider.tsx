import { useEffect } from "react";

function getSystemTheme() {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function PublicThemeProvider() {
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const applyTheme = () => {
      const theme = getSystemTheme();
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    };

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, []);

  return null;
}
