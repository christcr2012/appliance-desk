import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const ownerState = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(ownerState)).toBe(true);
  test.skip(!fs.existsSync(ownerState), "Test-only owner session required");
});

test("Settings Features shows guarded controls at five sizes and passes accessibility", async ({ page }) => {
  for (const width of [360, 390, 820, 1280, 1920]) {
    await page.setViewportSize({ width, height: width < 820 ? 844 : 800 });
    await page.goto("/desk/settings/features");
    await expect(page.getByRole("heading", { name: "Features", level: 1 })).toBeVisible();
    await expect(page.getByText("Turn on more when your business needs it.")).toBeVisible();
    await expect(page.getByText("Files for your accountant", { exact: true })).toBeVisible();
    await expect(page.getByText("Phone and texting costs", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to Settings" }).last()).toHaveAttribute("href", "/desk/settings");
    const issues = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(issues.violations).toEqual([]);
  }
});
