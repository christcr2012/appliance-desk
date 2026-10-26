import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const state = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(state) ? state : undefined });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
  test.skip(!fs.existsSync(state), "Requires isolated CI owner fixture");
});

test("offline desk uses only the public fallback and restores online page", async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem("desk-sw-test", "on"));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/today");
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.reload();
  }
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await context.setOffline(true);
  await expect(page.getByText("You're offline — changes are paused")).toBeVisible();
  await page.goto("/desk/customers");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  expect(axe.violations).toEqual([]);
  // Check the recovery link while still offline: once the connection returns the desk may reload the page by itself,
  // and the link could be gone before this check ran (a timing race that failed in CI).
  const tryAgain = page.getByRole("link", { name: "Try again" });
  await expect(tryAgain).toHaveAttribute("href", "/desk/today");
  await tryAgain.click();
  await context.setOffline(false);
  await page.goto("/desk/today");
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});
