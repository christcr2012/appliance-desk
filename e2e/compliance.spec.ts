import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";

// CMP-1: the Compliance center — the four tabs, the business facts screen
// (EIN box disabled until the encryption key is set), and a filing page.
test.describe("Compliance center (CMP-1)", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("coming up shows real obligations and passes axe", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/compliance");
    await expect(page.getByRole("heading", { name: "Compliance" })).toBeVisible();
    const sections = page.getByRole("navigation", { name: "Compliance sections" });
    await expect(sections.getByRole("link", { name: "Coming up", exact: true })).toBeVisible();
    await expect(sections.getByRole("link", { name: /Needs you/ })).toBeVisible();
    // The seeded registry covers three years of periods; an estimated-tax
    // filing is always within the 120-day window from any date.
    await expect(page.getByText("Federal estimated tax (Form 1040-ES)").first()).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("not needed shows the checked items with reasons", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/compliance?tab=notneeded");
    await expect(page.getByText("Beneficial ownership report (FinCEN)")).toBeVisible();
    await expect(page.getByText(/U.S. companies are exempt/)).toBeVisible();
    await expect(page.getByText("Heavy vehicle tax (Form 2290)")).toBeVisible();
  });

  test("needs you shows obligations whose dates are not set yet", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/compliance?tab=needs");
    // The Greeley license and trade-name obligations apply, but the
    // facts that would date them are not recorded yet — they must be
    // visible with what is missing, never silently absent. (CMP-4
    // confirmed an LLC's trade name never renews, so the obligation is
    // titled "Trade name", not "Trade name renewal".)
    await expect(page.getByText("Applies to you, dates not set yet")).toBeVisible();
    await expect(page.getByText("Greeley business license")).toBeVisible();
    await expect(page.getByText("Trade name", { exact: true })).toBeVisible();
  });

  test("business facts renders and the EIN box explains itself", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/compliance");
    await page.getByRole("link", { name: "Business facts" }).click();
    await expect(page.getByRole("heading", { name: "Business facts" })).toBeVisible();
    await expect(page.getByLabel("Business type")).toBeVisible();
    await expect(page.getByLabel(/LLC report month/)).toBeVisible();
    // In CI no encryption key is configured: the EIN field must be disabled
    // with the reason, never silently stored in the clear.
    const ein = page.getByLabel(/Business EIN/);
    await expect(ein).toBeDisabled();
    await expect(page.getByText(/encryption key/)).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });

  test("a filing page opens from the list", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated OWNER fixture required");
    await page.goto("/desk/compliance");
    await page.getByText("Federal estimated tax (Form 1040-ES)").first().click();
    await expect(page.getByRole("heading", { name: "Federal estimated tax (Form 1040-ES)" })).toBeVisible();
    await expect(page.getByText("How it's filed")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
