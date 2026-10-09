import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const admin = "e2e/.auth/admin.json";

test.describe("sales tax setup shell and owner decisions", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test("owner tax setup on phone has meaningful fields and light/dark accessibility", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated test-only owner state required");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/desk/sales-tax/setup");
    await expect(page.getByRole("heading", { name: /tax decisions and owner setup/i })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Sales tax sections" })).toBeVisible();
    await expect(page.getByLabel("Short-term lease election")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Filing accounts" })).toBeVisible();
    const light = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(light.violations).toEqual([]);
    await page.emulateMedia({ colorScheme: "dark" });
    const dark = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    expect(dark.violations).toEqual([]);
  });
  test("owner taxability matrix is editable without activating billing", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner state required");
    await page.goto("/desk/sales-tax/taxability");
    await expect(page.getByRole("heading", { name: "What's taxed?" })).toBeVisible();
    await expect(page.getByRole("button", { name: /save tax rule/i })).toBeVisible();
  });
});

test.describe("staff may not access private finance setup", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff deep link is denied", async ({ page }) => {
    test.skip(!fs.existsSync(staff), "Authenticated staff state required");
    await page.goto("/desk/sales-tax/setup");
    await expect(page).not.toHaveURL(/\/desk\/sales-tax\/setup(?:\?|$)/);
    await expect(page.getByLabel("Short-term lease election")).toHaveCount(0);
  });
});

test.describe("administrator can read but cannot save", () => {
  test.use({ storageState: fs.existsSync(admin) ? admin : undefined });
  test("administrator receives read-only role projection", async ({ page }) => {
    test.skip(!fs.existsSync(admin), "Administrator test state not configured");
    await page.goto("/desk/sales-tax/setup");
    await expect(page.getByText(/read only/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /save changes/i })).toHaveCount(0);
  });
});

