// Light / dark theme handling. The app is light by default; a `.dark` class on
// <html> swaps to the dark palette defined in styles.css. The preference is
// stored locally and applied before paint (see the inline script in __root).

export type Theme = "light" | "dark";

export const THEME_KEY = "signoff.theme";

export function getStoredTheme(): Theme {
  if (typeof window === "undefined") return "light";
  try {
    return window.localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
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
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('${THEME_KEY}');var dark=t==='dark';var c=document.documentElement.classList;c.toggle('dark',dark);c.toggle('light',!dark);}catch(e){document.documentElement.classList.add('light');}})();`;
