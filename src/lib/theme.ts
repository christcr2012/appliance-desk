// Dark mode (Chris asked for this, 2026-09-27): a person's choice is
// "light", "dark", or "system" (follow the device's own setting), kept
// in localStorage so it's remembered across visits. Only ever runs in
// the browser — every function here touches window/localStorage, so
// these are called from Client Components only.

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "theme";

export function getStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    // Private browsing / storage disabled — fall back to "system" below.
  }
  return "system";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return preference;
}

/** Adds/removes the .dark class on <html> to match a preference. */
export function applyTheme(preference: ThemePreference): void {
  const isDark = resolveTheme(preference) === "dark";
  document.documentElement.classList.toggle("dark", isDark);
}

// A same-window `localStorage` write doesn't fire the browser's own
// "storage" event (that only reaches OTHER tabs/windows) — so
// ThemeToggle's useSyncExternalStore needs its own signal to know a
// change happened in this same tab. "storage" is still listened for
// too, so a toggle in one tab is picked up by another.
export const THEME_CHANGE_EVENT = "appliance-desk:theme-change";

/** Saves a preference and applies it immediately. */
export function setThemePreference(preference: ThemePreference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    // Best-effort — the theme just won't be remembered next visit.
  }
  applyTheme(preference);
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

// Runs once, synchronously, before the page paints (see
// src/components/theme-init-script.tsx) so there's no flash of the
// wrong theme while React hydrates. Kept as a plain string (not a
// function reference) since it has to run standalone, before any of
// our own JS has loaded.
export const THEME_INIT_SCRIPT = `
(function() {
  try {
    var pref = localStorage.getItem("${STORAGE_KEY}") || "system";
    var isDark = pref === "dark" || (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch {}
})();
`;
