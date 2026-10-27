import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";

test.describe("Taxes › Rules (TFA-1)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  // The kit list renders every row twice (phone cards + desktop table), so
  // text assertions scope to the desktop table; the row ⋯ trigger is labelled
  // "More for row N", not "More actions".
  test("rules list shows now, next, source and state, and passes axe", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/rules");
    await expect(page.getByRole("heading", { name: "Tax and fee rules" })).toBeVisible();
    const table = page.locator("table");
    await expect(table.getByText("Colorado retail delivery fee")).toBeVisible();
    await expect(table.getByText("$0.31 per delivery")).toBeVisible();
    await expect(table.getByText("Researched — not confirmed").first()).toBeVisible();
    await expect(page.getByText("When to act on changes that cost you")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("owner watch switch renders, toggles and persists (TFA-3)", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/rules");
    await expect(page.getByText("Watch the official tax pages")).toBeVisible();
    const toggle = page.getByRole("checkbox", { name: "Watch for new tax and fee amounts" });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await page.getByRole("button", { name: "Save watch setting" }).click();
    await expect(page.getByText("Watching is off.")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("checkbox", { name: "Watch for new tax and fee amounts" })).not.toBeChecked();
    // Restore the starting value so other specs see the default state.
    await page.getByRole("checkbox", { name: "Watch for new tax and fee amounts" }).check();
    await page.getByRole("button", { name: "Save watch setting" }).click();
    await expect(page.getByText("Watching is on.")).toBeVisible();
  });

  test("history shows every version of a rule", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/rules");
    const row = page.locator("tr", { hasText: "Colorado retail delivery fee" }).first();
    await row.getByRole("button", { name: /More for row/ }).click();
    await page.getByRole("menuitem", { name: "History" }).click();
    await expect(page.getByRole("heading", { name: "History: Colorado retail delivery fee" })).toBeVisible();
    await expect(page.getByText("$0.31 per delivery — from 2026-07-01")).toBeVisible();
  });

  test("owner changes a future rate and undoes it", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/rules");
    const row = page.locator("tr", { hasText: "Colorado retail delivery fee" }).first();
    await row.getByRole("button", { name: /More for row/ }).click();
    await page.getByRole("menuitem", { name: "Change…" }).click();
    await expect(page.getByRole("dialog", { name: "Change: Colorado retail delivery fee" })).toBeVisible();
    await page.getByLabel("Fee per delivery ($)").fill("0.35");
    await page.getByLabel("Starts on").fill("2027-07-01");
    await page.getByLabel("Why is this changing?").fill("Browser test change");
    await page.getByRole("button", { name: "Save change" }).click();
    await expect(page.locator("table").getByText("$0.35 per delivery")).toBeVisible();
    await expect(row).toContainText("from 2027-07-01");
    await row.getByRole("button", { name: /More for row/ }).click();
    await page.getByRole("menuitem", { name: "Undo this change" }).click();
    await page.getByRole("button", { name: "Undo change" }).click();
    await expect(page.getByText("Change undone.")).toBeVisible();
    await expect(page.getByText("$0.35 per delivery")).toHaveCount(0);
  });
});
