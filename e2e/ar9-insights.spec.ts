import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// AR-9: the Insights tabs (Customers, Equipment), Money › Income details,
// and the redirects that replaced Growth / Fleet / Revenue / Reports /
// Dashboard. Owner sees numbers; staff has no Insights tab and a direct
// URL is refused.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

test.describe("AR-9 insights as owner", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
    test.skip(!process.env.CI || !fs.existsSync(owner), "Disposable CI owner only");
  });

  test("owner opens both Insights tabs and Income details and sees the numbers", async ({ page }) => {
    await page.goto("/desk/customers");
    await page.getByRole("link", { name: "Insights", exact: true }).first().click();
    await expect(page).toHaveURL(/\/desk\/customers\/insights/);
    // Heading names match by substring, and the h2s carry InfoTip buttons
    // (their labels join the heading's accessible name) — pin level 2 and
    // anchor the start so "Where leads come from" (h3) and friends cannot
    // collide with the section titles.
    await expect(page.getByRole("heading", { level: 2, name: /^Leads/ })).toBeVisible();
    await expect(page.getByText("New leads", { exact: true })).toBeVisible();
    await expect(page.getByText(/Pipeline value/)).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /^Worth a call/ })).toBeVisible();

    await page.goto("/desk/inventory");
    await page.getByRole("link", { name: "Insights", exact: true }).first().click();
    await expect(page).toHaveURL(/\/desk\/inventory\/insights/);
    await expect(page.getByRole("heading", { level: 2, name: /^Value and cost/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: "All appliances: value and cost", exact: true })).toBeVisible();

    await page.goto("/desk/money/income");
    await expect(page.getByText(/matching records · .* total/)).toBeVisible();
  });

  test("the old URLs land on the new screens", async ({ page }) => {
    const landings: [string, RegExp][] = [
      ["/desk/growth", /\/desk\/customers\/insights/],
      ["/desk/fleet", /\/desk\/inventory\/insights/],
      // The redirect preserves both params; their order in the URL is not a contract.
      ["/desk/fleet?costs=missing&page=2", /\/desk\/inventory\/insights\?(costs=missing&page=2|page=2&costs=missing)/],
      ["/desk/revenue", /\/desk\/money\/income/],
      ["/desk/revenue?source=refunds&scope=all", /\/desk\/money\/income\?scope=all&source=refunds|\/desk\/money\/income\?source=refunds&scope=all/],
      ["/desk/reports", /\/desk\/money$/],
      ["/desk/dashboard", /\/desk\/today/],
    ];
    for (const [from, to] of landings) {
      await page.goto(from);
      await expect(page).toHaveURL(to);
    }
  });

  test("keyboard reaches the period toggle and the tables, axe clean at five sizes", async ({ page }) => {
    await page.goto("/desk/customers/insights");
    const lastMonth = page.getByRole("link", { name: "Last month" }).first();
    for (let tab = 0; tab < 80; tab++) {
      if (await lastMonth.evaluate((el) => el === document.activeElement)) break;
      await page.keyboard.press("Tab");
    }
    await expect(lastMonth).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/period=last/);
    await expect(page.getByText("Speed to lead", { exact: true })).toBeVisible();

    for (const width of [360, 390, 820, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/desk/customers/insights");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const violations = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      ).violations;
      expect(violations).toEqual([]);
      await page.goto("/desk/inventory/insights");
      const equipmentViolations = (
        await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()
      ).violations;
      expect(equipmentViolations).toEqual([]);
    }
  });
});

test.describe("AR-9 insights as staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test.beforeEach(() => {
    if (process.env.CI) expect(fs.existsSync(staff)).toBe(true);
    test.skip(!process.env.CI || !fs.existsSync(staff), "Disposable CI staff only");
  });

  test("staff has no Insights tab and direct URLs are refused", async ({ page }) => {
    await page.goto("/desk/customers");
    await expect(page.getByRole("link", { name: "Insights", exact: true })).toHaveCount(0);
    await page.goto("/desk/customers/insights");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/desk/inventory/insights");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/desk/money/income");
    await expect(page).toHaveURL(/\/$/);
  });
});
