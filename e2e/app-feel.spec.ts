import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!fs.existsSync(owner), "Requires isolated CI owner fixture");
});

test("Today to Customers immediately shows loading or the destination, then a complete list", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/today", { waitUntil: "load" });
  // Slow a route payload enough for the partial-prefetch loading skeleton to be useful.
  await page.route("**/desk/customers?*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  const customers = page.getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Customers", exact: true });
  await customers.click({ noWaitAfter: true });
  const heading = page.getByRole("heading", { name: "Customers", exact: true });
  const loading = page.getByRole("status").filter({ hasText: /Loading customers/i });
  await expect.poll(async () => await heading.isVisible() || await loading.isVisible(),
    { timeout: 1000, message: "A desk navigation must immediately show the skeleton or Customers heading" }).toBe(true);
  await expect(heading).toBeVisible({ timeout: 3000 });
  await expect(page.getByRole("main")).toBeVisible();
});
