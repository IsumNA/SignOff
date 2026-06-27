// Light / dark theme handling. The app is dark by default; a `.light` class on
// <html> swaps to the light palette defined in styles.css. The preference is
// stored locally and applied before paint (see the inline script in __root).

export type Theme = "light" | "dark";

export const THEME_KEY = "signoff.theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    return window.localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("dark", theme === "dark");
}

export function setTheme(theme: Theme): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* ignore storage failures */
  }
  applyTheme(theme);
}

// Inline, self-executing snippet injected into <head> so the correct theme is
// set before the body paints (avoids a flash of the wrong theme on load).
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var light=t==='light';var c=document.documentElement.classList;c.toggle('light',light);c.toggle('dark',!light);}catch(e){document.documentElement.classList.add('dark');}})();`;
