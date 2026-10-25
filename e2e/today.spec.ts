import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, overdueCustomer, SIZES } from "./support/ar0b-fixtures";

// AR-0b (docs/build-specs/screens/TODAY.md section 7): the Today inbox in a real browser.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

test.describe("Today inbox", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("owner sees health, inbox and visits; snooze hides a card and Undo brings it back; keyboard reaches the actions", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    const fixture = await overdueCustomer("Today Snooze");
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/desk/today", { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Your business this week" }).first()).toBeVisible();
      await expect(page.getByText("Money in").first()).toBeVisible();
      await expect(page.getByRole("heading", { name: "Today's visits" })).toBeVisible();

      const title = `${fixture.name}: past due`;
      const card = page.locator("article", { has: page.getByRole("heading", { name: title }) });
      await expect(card).toBeVisible();
      await expect(card.getByRole("link", { name: "Call" })).toHaveAttribute("href", "tel:9705550142");

      // Keyboard: Tab from the top reaches this card's main action.
      await page.getByRole("heading", { level: 1, name: "Today" }).focus();
      let reached = false;
      for (let i = 0; i < 80 && !reached; i++) {
        await page.keyboard.press("Tab");
        reached = await card.getByRole("link", { name: "Review unpaid invoice" }).evaluate((el) => el === document.activeElement).catch(() => false);
      }
      expect(reached).toBe(true);

      await card.getByRole("button", { name: `More for ${title}` }).click();
      await page.getByRole("menuitem", { name: "Snooze…" }).click();
      const sheet = page.getByRole("dialog", { name: "Snooze this item" });
      await expect(sheet).toBeVisible();
      await sheet.getByRole("button", { name: "Snooze" }).click();
      await expect(card).toHaveCount(0);
      const toast = page.getByRole("status").filter({ hasText: "Snoozed until" });
      await expect(toast).toBeVisible({ timeout: 15_000 });
      await toast.getByRole("button", { name: "Undo" }).click();
      await expect(page.locator("article", { has: page.getByRole("heading", { name: title }) })).toBeVisible({ timeout: 15_000 });
    } finally {
      await fixture.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    await scanAccessibilityRoute(page, { path: "/desk/today", role: "OWNER", fixture: "/desk/today" }, SIZES);
  });
});

test.describe("Today for staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff see no money", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    await page.goto("/desk/today", { waitUntil: "load" });
    await expect(page.getByRole("heading", { level: 1, name: "Today" })).toBeVisible();
    await expect(page.getByText("Money in")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Your business this week" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Today's visits" })).toBeVisible();
  });
});
