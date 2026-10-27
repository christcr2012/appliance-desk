import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: "e2e/.auth/owner.json" });

for (const width of [360, 1440]) {
  test("OPS-8 continuity page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/continuity");
    await expect(page.getByRole("heading", { level: 1, name: /If something happens to me/ })).toBeVisible();
    await expect(page.getByText("Pause all automatic charges").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });

  test("OPS-8 yearly check-up page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/continuity/checkup");
    await expect(page.getByRole("heading", { level: 1, name: /Yearly business check-up/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
