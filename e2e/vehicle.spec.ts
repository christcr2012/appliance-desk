import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: "e2e/.auth/owner.json" });

for (const width of [360, 1440]) {
  test("OPS-3 vehicle and mileage page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/vehicle");
    await expect(page.getByRole("heading", { level: 1, name: /Vehicle and mileage/ })).toBeVisible();
    await expect(page.getByText("Miles and the mileage deduction")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
