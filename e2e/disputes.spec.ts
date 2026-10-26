import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: "e2e/.auth/owner.json" });

for (const width of [360, 1440]) {
  test("OPS-5 disputes page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/disputes");
    await expect(page.getByRole("heading", { level: 1, name: /Disputes/ })).toBeVisible();
    await expect(page.getByText("Bank payment refund wait")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
