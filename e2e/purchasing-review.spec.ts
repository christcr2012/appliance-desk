import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = path.resolve("e2e/.auth/owner.json");
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!process.env.CI || !fs.existsSync(owner), "Disposable CI business fixture only");
});
test("owner can name, keyboard edit and persist purchase-order lines on a phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/desk/suppliers/new");
  const supplierName = `CI review supplier ${Date.now()}`;
  await page.getByLabel("Supplier name").fill(supplierName);
  await page.getByRole("button", { name: "Add supplier", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/suppliers\/(?!new$)[^/]+$/);
  await expect(page.getByRole("heading", { name: supplierName, exact: true })).toBeVisible();
  await page.goto("/desk/purchase-orders/new");
  await page.getByLabel("Description", { exact: true }).fill("Door seal review fixture");
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await page.getByLabel("Unit cost ($)", { exact: true }).fill("4.25");
  await page.getByLabel("Description", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Quantity", { exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
  await info.attach("purchase-order-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await page.getByRole("button", { name: "Create purchase order", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/purchase-orders\/(?!new$)[^/]+$/);
  const savedLine = page
    .locator("main li:visible")
    .filter({ hasText: "Door seal review fixture" })
    .first();
  await expect(savedLine).toBeVisible();
  await expect(savedLine).toContainText("2");
  await page.reload();
  const reloadedLine = page
    .locator("main li:visible")
    .filter({ hasText: "Door seal review fixture" })
    .first();
  await expect(reloadedLine).toBeVisible();
  await expect(reloadedLine).toContainText("2");
});
