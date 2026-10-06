import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AccessibilityRoute } from "./route-inventory";

const VIEWPORTS = [360, 1440] as const;
const THEMES = ["light", "dark"] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;

export async function scanAccessibilityRoute(
  page: Page,
  route: AccessibilityRoute,
) {
  await page.setViewportSize({ width: VIEWPORTS[0], height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(route.fixture, { waitUntil: "networkidle" });
  await expect(page.locator("body")).toBeVisible();

  for (const theme of THEMES) {
    await page.evaluate((mode) => {
      localStorage.setItem("theme", mode);
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.documentElement.style.colorScheme = mode;
    }, theme);

    await expect(page.locator("html")).toHaveClass(
      theme === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
    );

    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 900 });
      const results = await new AxeBuilder({ page })
        .withTags([...AXE_TAGS])
        .analyze();
      expect(
        results.violations,
        `${route.path} should pass automated WCAG 2.2 AA engineering checks at ${width}px in ${theme} mode`,
      ).toEqual([]);
    }
  }
}
