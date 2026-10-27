import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ storageState: "e2e/.auth/owner.json" });

for (const width of [360, 1440]) {
  test("OPS-7 privacy and security page is readable and accessible at " + width, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/desk/privacy-security");
    await expect(page.getByRole("heading", { level: 1, name: /Privacy and security/ })).toBeVisible();
    await expect(page.getByText("Something may have leaked")).toBeVisible();
    await expect(page.getByText("Service providers that hold customer information")).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Use face-match ID checks/ })).not.toBeChecked();
    await expect(page.getByRole("checkbox", { name: /Remove old sales enquiries automatically/ })).not.toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}

test("OPS-7 public page shows the written disposal policy", async ({ page }) => {
  await page.goto("/privacy/how-we-handle-your-information");
  await expect(page.getByRole("heading", { level: 1, name: "How we handle your information" })).toBeVisible();
  await expect(page.getByText("How we destroy information")).toBeVisible();
});
