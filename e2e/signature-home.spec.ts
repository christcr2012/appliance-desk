import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// V-1/V-2: the signature home page keeps passing the same accessibility rules as before the redesign, never scrolls
// sideways, shows the keyboard focus ring on the cut-corner shapes, and does not animate for people who ask for less motion.

const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function settle(page: Page, theme: "light" | "dark") {
  await page.evaluate((mode) => {
    localStorage.setItem("theme", mode);
    document.documentElement.classList.toggle("dark", mode === "dark");
    document.documentElement.style.colorScheme = mode;
  }, theme);
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await Promise.all(document.getAnimations().filter((a) => a.playState === "running").map((a) => a.finished.catch(() => undefined)));
  });
}

test.describe("signature home page", () => {
  for (const theme of ["light", "dark"] as const) {
    for (const width of [360, 768, 1440]) {
      test(`passes accessibility checks and does not scroll sideways at ${width}px in ${theme} mode`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/", { waitUntil: "load" });
        await settle(page, theme);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
        expect(results.violations).toEqual([]);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }

  test("a clipped (cut-corner) control still shows a complete keyboard focus ring", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "load" });
    const clipped = page.locator("main .cut-corner-sm a, main a.cut-corner-sm, main button.cut-corner-sm").first();
    if ((await clipped.count()) === 0) test.skip(true, "this opening mode has no cut-corner control above the fold");
    await clipped.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(clipped).toBeFocused();
    const clip = await clipped.evaluate((el) => getComputedStyle(el).clipPath);
    expect(clip).toBe("none");
    const outline = await clipped.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });

  test("reduced motion turns the entrance animation off", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "load" });
    const animated = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".signature-rise")].filter((el) => getComputedStyle(el).animationName !== "none").length,
    );
    expect(animated).toBe(0);
  });
});
