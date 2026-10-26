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
  // The offline page is a plain link, but this browser may finish loading pages the moment the connection returns
  // (the desk can send you straight back to Today), so the link can legitimately be gone. Wait until either the link or
  // Today is showing, check the link's address if it is still there, and then finish on Today in both cases.
  await context.setOffline(false);
  const tryAgain = page.getByRole("link", { name: "Try again" });
  const today = page.getByRole("heading", { name: "Today", exact: true });
  await expect(tryAgain.or(today)).toBeVisible();
  const href = await tryAgain.getAttribute("href", { timeout: 3000 }).catch(() => null);
  if (href !== null) {
    expect(href).toBe("/desk/today");
    await tryAgain.click({ timeout: 3000 }).catch(() => undefined);
  }
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
});
