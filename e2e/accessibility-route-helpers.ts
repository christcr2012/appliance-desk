import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AccessibilityRoute } from "./route-inventory";

const DEFAULT_VIEWPORTS = [360, 1440] as const;
const THEMES = ["light", "dark"] as const;
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] as const;

export async function scanAccessibilityRoute(
  page: Page,
  route: AccessibilityRoute,
  viewports: readonly number[] = DEFAULT_VIEWPORTS,
) {
  await page.setViewportSize({ width: viewports[0] ?? 360, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  // Next.js server components and background requests can keep networkidle
  // pending indefinitely even after the page has rendered. Wait for the
  // actual load event, then inspect the visible DOM/axe state below.
  await page.goto(route.fixture, { waitUntil: "load" });
  await expect(page.locator("body")).toBeVisible();
  // Controls such as "Save schedule" stay disabled (and dimmed) until React hydrates. Scanning mid-switch makes axe
  // read a half-dimmed button (seen twice in CI at /desk/jobs/[id], 360px). Wait, bounded, for hydration to settle;
  // pages that keep a control disabled on purpose simply continue after the cap and are scanned as they are.
  await page
    .waitForFunction(() => document.querySelectorAll("button:disabled").length === 0, undefined, { timeout: 4000 })
    .catch(() => undefined);

  for (const theme of THEMES) {
    await page.evaluate((mode) => {
      localStorage.setItem("theme", mode);
      document.documentElement.classList.toggle("dark", mode === "dark");
      document.documentElement.style.colorScheme = mode;
    }, theme);

    await expect(page.locator("html")).toHaveClass(
      theme === "dark" ? /dark/ : /^(?!.*\bdark\b)/,
    );

    // The class changes before browser paints and before transition-colors
    // finishes. Axe must inspect the settled palette, never a half-dark frame.
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
      await Promise.all(
        document.getAnimations().filter((animation) => animation.playState === "running")
          .map((animation) => animation.finished.catch(() => undefined)),
      );
    });

    for (const width of viewports) {
      await page.setViewportSize({ width, height: 900 });
      // Let the browser finish laying the page out at the new width before measuring.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      if (width <= 400) {
        // Older review finding (pr39): wide content must never push the page sideways on a phone. A table or form that
        // is wider than the screen has to scroll inside its own box, not drag the whole page.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        // When it fails, name the innermost elements that stick out, so the cause is visible in the CI annotation.
        const culprits = overflow > 0 ? await page.evaluate(() => [...document.querySelectorAll("body *")]
          .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
          .slice(-5).map((el) => `${el.tagName.toLowerCase()}[${String(el.getAttribute("class") ?? "").slice(0, 60)}] ` +
            `right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? "").trim().slice(0, 30)}"`)
          .join(" | ")) : "";
        expect(overflow, `${route.path} should not scroll sideways at ${width}px in ${theme} mode ${culprits}`).toBeLessThanOrEqual(0);
      }
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
