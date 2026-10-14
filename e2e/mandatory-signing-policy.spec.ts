import fs from "node:fs";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const state = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(state) ? state : undefined });

test("owner reviews dated mandatory-charge policies without a payable estimate", async ({ page }) => {
  test.skip(!process.env.CI || !fs.existsSync(state), "Disposable authenticated CI fixtures only");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/settings?section=products");
  const region = page.getByRole("region", { name: "Mandatory quote categories" });
  await expect(region).toBeVisible();
  await expect(region.getByText(/No active owner policy|Effective revision/)).toBeVisible();
  await expect(region.getByLabel(/Effective from/)).toBeVisible();
  await expect(region.getByLabel(/Reason and dated decision evidence/)).toBeVisible();
  await expect(region.getByRole("button", { name: /Record dated owner policy/ })).toBeEnabled();
  await expect(region.getByText(/does not remove IN-79/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(report.violations).toEqual([]);
});
