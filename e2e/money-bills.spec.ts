import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, overdueCustomer, SIZES } from "./support/ar0b-fixtures";

// AR-0b (docs/build-specs/screens/MONEY-BILLS.md section 8): Money › Bills in a real browser.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

test.describe("Money › Bills", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("owner: Past due, phone card buttons, desktop side panel, old link", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    const fixture = await overdueCustomer("Bills Panel");
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/desk/billing?filter=delinquent`, { waitUntil: "load" });
      await expect(page).toHaveURL(/\/desk\/billing\?status=past-due$/);
      await page.goto(`/desk/billing?status=past-due&q=${encodeURIComponent(fixture.name)}`, { waitUntil: "load" });
      await expect(page.getByRole("link", { name: /^Past due \d+$/ })).toHaveAttribute("aria-current", "page");
      const card = page.getByRole("list", { name: "Bills" }).getByRole("listitem").first();
      await expect(card).toContainText(fixture.name);
      await expect(card).toContainText(`Bill #${fixture.billNumber}`);
      await expect(card.getByRole("link", { name: "Record cash or check" })).toHaveAttribute(
        "href",
        `/desk/billing/customer/${fixture.customerId}#record-payment`,
      );
      await expect(page.getByRole("link", { name: "New bill" })).toBeVisible();

      await page.setViewportSize({ width: 1280, height: 800 });
      const row = page.getByRole("table").getByRole("row", { name: new RegExp(fixture.name) });
      await row.click();
      await expect(page).toHaveURL(new RegExp(`open=${fixture.billId}`));
      const panel = page.getByRole("complementary", { name: `Bill #${fixture.billNumber}` });
      await expect(panel).toBeVisible();
      await expect(panel.getByText("Still owed")).toBeVisible();
      await expect(panel.getByRole("link", { name: "Open full bill →" })).toHaveAttribute(
        "href",
        `/desk/billing/customer/${fixture.customerId}/invoice/${fixture.billId}`,
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    await scanAccessibilityRoute(page, { path: "/desk/billing", role: "OWNER", fixture: "/desk/billing?status=past-due" }, SIZES);
  });
});

test.describe("Money › Bills for staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff are still refused", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    await page.goto("/desk/billing?status=past-due");
    await expect(page).toHaveURL(/\/$/);
  });
});
