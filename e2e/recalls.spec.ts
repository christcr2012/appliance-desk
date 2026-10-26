import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: "e2e/.auth/owner.json" });

for (const width of [360, 768, 1440]) {
  test("OPS-1 recalls page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/recalls");
    await expect(page.getByRole("heading", { level: 1, name: /Recalls/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
