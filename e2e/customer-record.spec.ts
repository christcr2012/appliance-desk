import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, overdueCustomer, SIZES } from "./support/ar0b-fixtures";

// AR-0b (docs/build-specs/screens/CUSTOMER-RECORD.md section 6): the customer record in a real browser.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

test.describe("Customer record", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("phone: Activity first and the bottom bar; desktop: Rentals and the right column; old links; keyboard", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const fixture = await overdueCustomer("Record Page");
    const url = `/desk/customers/${fixture.customerId}`;
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(url, { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1, name: fixture.name })).toBeVisible();
      const phoneTabs = page.getByRole("navigation", { name: "Customer sections" }).first();
      await expect(phoneTabs.getByRole("link", { name: "Activity" })).toHaveAttribute("aria-current", "page");
      const bar = page.getByRole("group", { name: "Customer actions" });
      await expect(bar.getByRole("link", { name: "Schedule visit" })).toBeVisible();
      await expect(bar.getByRole("link", { name: "New quote" })).toBeVisible();
      await expect(page.getByText("Owes now").first()).toBeVisible();

      await page.setViewportSize({ width: 1280, height: 800 });
      const desktopTabs = page.getByRole("navigation", { name: "Customer sections" }).last();
      await expect(desktopTabs.getByRole("link", { name: /^Rentals/ })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("complementary", { name: "Next steps and activity" })).toBeVisible();
      // Keyboard: from the breadcrumb, Tab reaches the header's Take payment (the oldest open bill) within the header.
      await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("link", { name: "Customers" }).focus();
      let reached = false;
      for (let i = 0; i < 8 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await page.evaluate(() => document.activeElement?.textContent?.trim() === "Take payment");
      }
      expect(reached).toBe(true);
      const take = page.getByRole("link", { name: "Take payment" }).first();
      await expect(take).toHaveAttribute("href", `/desk/billing/customer/${fixture.customerId}/invoice/${fixture.billId}#take-payment`);

      await page.goto(`${url}?tab=service`, { waitUntil: "load" });
      await expect(page).toHaveURL(new RegExp(`${url}\\?tab=visits$`));
      await expect(page.getByRole("navigation", { name: "Customer sections" }).last().getByRole("link", { name: "Visits" })).toHaveAttribute(
        "aria-current",
        "page",
      );
    } finally {
      await fixture.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const fixture = await overdueCustomer("Record Axe");
    try {
      await scanAccessibilityRoute(page, { path: "/desk/customers/[id]", role: "OWNER", fixture: `/desk/customers/${fixture.customerId}` }, SIZES);
    } finally {
      await fixture.cleanup();
    }
  });
});

test.describe("Customer record for staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff still see the operational view and no money", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    const fixture = await overdueCustomer("Record Staff");
    try {
      await page.goto(`/desk/customers/${fixture.customerId}?tab=bills`, { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1, name: fixture.name })).toBeVisible();
      await expect(page.getByText("Service addresses")).toBeVisible();
      await expect(page.getByText("Owes now")).toHaveCount(0);
      await expect(page.getByText("$70.00")).toHaveCount(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
