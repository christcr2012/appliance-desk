import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!fs.existsSync(owner), "Requires isolated CI owner session");
});

test("desk sidebar returns to the same Today filter without changing explicit links", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/desk/today?group=snoozed", { waitUntil: "load" });
  await expect(page).toHaveURL(/group=snoozed/);
  const nav = page.getByRole("navigation", { name: "Owner desk" });
  await nav.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/customers$/);
  await nav.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/today\?group=snoozed/);
});

test("phone bottom bar restores a list filter in this tab", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/today?group=snoozed", { waitUntil: "load" });
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "Customers", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/customers$/);
  await nav.getByRole("link", { name: "Today", exact: true }).click();
  await expect(page).toHaveURL(/\/desk\/today\?group=snoozed/);
});
