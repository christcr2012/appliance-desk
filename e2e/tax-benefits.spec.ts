import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";

test.describe("Taxes › Tax benefits (TAXBEN-1)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("the benefits page shows the year's rows, the policy and passes axe", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    const year = new Date().getFullYear();
    await page.goto("/desk/sales-tax/benefits");
    await expect(page.getByRole("heading", { name: `Tax benefits ${year}` })).toBeVisible();
    await expect(page.getByText(/Tentative profit/)).toBeVisible();

    // Always-on rows: the enterprise zone answer, the bad-debt
    // explanation and the ordinary-deductions checklist.
    await expect(page.getByRole("heading", { name: "Colorado enterprise zone credit" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Bad debts and unreturned appliances" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Ordinary deductions checklist" })).toBeVisible();
    await expect(page.getByText(/your CPA confirms/i).first()).toBeVisible();

    // The capitalization policy is offered unsigned until the owner signs.
    await expect(page.getByText(/Capitalization policy/).first()).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((v) => v.impact === "critical" || v.impact === "serious")).toEqual([]);
  });
});
