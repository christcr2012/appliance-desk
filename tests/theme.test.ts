import { describe, it, expect, beforeEach, vi } from "vitest";

// Chris asked for dark mode support (2026-09-27). These test the pure
// preference-resolution logic in src/lib/theme.ts — what "system" means
// given the device's setting, what gets saved, and what class ends up
// on <html> — independent of any component.

function mockMatchMedia(prefersDark: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(prefers-color-scheme: dark)" && prefersDark,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it('getStoredPreference defaults to "system" with nothing saved', async () => {
    const { getStoredPreference } = await import("@/lib/theme");
    expect(getStoredPreference()).toBe("system");
  });

  it("getStoredPreference returns a saved explicit preference", async () => {
    localStorage.setItem("theme", "dark");
    const { getStoredPreference } = await import("@/lib/theme");
    expect(getStoredPreference()).toBe("dark");
  });

  it("ignores a corrupted/unrecognized stored value and falls back to system", async () => {
    localStorage.setItem("theme", "purple");
    const { getStoredPreference } = await import("@/lib/theme");
    expect(getStoredPreference()).toBe("system");
  });

  it('resolveTheme("system") follows the device\'s prefers-color-scheme', async () => {
    const { resolveTheme } = await import("@/lib/theme");

    mockMatchMedia(true);
    expect(resolveTheme("system")).toBe("dark");

    mockMatchMedia(false);
    expect(resolveTheme("system")).toBe("light");
  });

  it("resolveTheme passes through an explicit light/dark preference regardless of the device", async () => {
    const { resolveTheme } = await import("@/lib/theme");
    mockMatchMedia(true); // device says dark
    expect(resolveTheme("light")).toBe("light");
    expect(resolveTheme("dark")).toBe("dark");
  });

  it("applyTheme adds .dark to <html> for a dark result, removes it for light", async () => {
    const { applyTheme } = await import("@/lib/theme");
    mockMatchMedia(false);

    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    applyTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("setThemePreference saves the choice and applies it immediately", async () => {
    const { setThemePreference } = await import("@/lib/theme");
    mockMatchMedia(false);

    setThemePreference("dark");
    expect(localStorage.getItem("theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    setThemePreference("light");
    expect(localStorage.getItem("theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("THEME_INIT_SCRIPT (the anti-flash script) is self-contained and doesn't reference any import", async () => {
    // It runs standalone in the browser before any of our JS loads, so
    // it can never rely on an import — that would just throw silently
    // and dark mode's first paint would be wrong every time.
    const { THEME_INIT_SCRIPT } = await import("@/lib/theme");
    expect(THEME_INIT_SCRIPT).not.toMatch(/\bimport\b/);
    expect(THEME_INIT_SCRIPT).toContain("localStorage");
    expect(THEME_INIT_SCRIPT).toContain("matchMedia");
  });
});
