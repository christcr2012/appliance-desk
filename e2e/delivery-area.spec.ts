import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";

test.describe("Taxes › Delivery area (FEETAX-2)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("the seeded catalogue shows each place's readiness and passes axe", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/area");
    await expect(page.getByRole("heading", { name: "Delivery area" })).toBeVisible();

    // A state-collected place starts ready: no tax on rent, no license.
    const eaton = page.locator("tr", { hasText: "Eaton" }).first();
    await expect(eaton.getByText("Ready", { exact: true })).toBeVisible();
    await expect(eaton.getByText("No license needed")).toBeVisible();

    // Greeley is home base: its rent-tax decision starts undecided (it
    // lives in the tax rules, not the readiness row), and its license
    // rule — yes, before delivering — is named in the license column.
    const greeley = page.locator("tr", { hasText: "Greeley" }).first();
    await expect(
      greeley.getByText(/The rental tax rule for Greeley isn't decided yet/),
    ).toBeVisible();
    await expect(greeley.getByText("Yes, before delivering")).toBeVisible();
    await expect(greeley.getByText("Not decided")).toBeVisible();

    // Fort Collins counts deliveries: its rule is named on the row.
    const fortCollins = page.locator("tr", { hasText: "Fort Collins" }).first();
    await expect(
      fortCollins.getByText("After more than one delivery in 12 months"),
    ).toBeVisible();

    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("check a place by name answers from the same readiness state", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/area");
    await page.getByLabel("A city or town by name").fill("Eaton");
    await page.getByRole("button", { name: "Check this place" }).click();
    await expect(page.getByText(/Eaton/)).toBeVisible();
    await expect(page.getByText("ready to deliver")).toBeVisible();

    await page.getByLabel("A city or town by name").fill("Windsor");
    await page.getByRole("button", { name: "Check this place" }).click();
    await expect(page.getByText(/not ready yet/)).toBeVisible();
  });

  test("check an address runs the delivery readiness check", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/sales-tax/area");
    const select = page.getByLabel("A customer address on file");
    const options = await select.locator("option").count();
    test.skip(options < 2, "No seeded service address to check");
    const value = await select.locator("option").nth(1).getAttribute("value");
    await select.selectOption(value ?? "");
    await page.getByRole("button", { name: "Check this address" }).click();
    await expect(
      page.getByText(/ready to deliver|not ready to deliver yet/),
    ).toBeVisible();
  });
});
