import fs from "node:fs";
import { test, expect } from "@playwright/test";

const owner = "e2e/.auth/owner.json";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined, hasTouch: true, isMobile: true });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(owner)).toBe(true);
  test.skip(!fs.existsSync(owner), "Requires isolated CI owner session");
});

test("mobile Today supports gesture refresh and keeps the bottom bar reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/today", { waitUntil: "load" });
  const pull = page.locator("[data-pull-to-refresh]").first();
  await expect(pull).toBeVisible();
  // Real Chromium touch input, not dispatched DOM events: this exercises scroll
  // arbitration and the browser's pointercancel behavior.
  await page.evaluate(() => window.scrollTo(0, 0));
  const rect = await pull.boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + 12;
  const y = rect!.y + 8; // the dedicated non-interactive status strip
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const offset of [30, 60, 95]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + offset }] });
  }
  await expect(pull.getByRole("status")).toHaveText("Release to refresh");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(pull.getByRole("status")).toHaveText(/Updated just now|Refreshing…/);
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});
test("reduced motion exposes a manual refresh control without a pull gesture", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/today", { waitUntil: "load" });
  const pull = page.locator("[data-pull-to-refresh]").first();
  await expect(pull.getByRole("button", { name: "Refresh" })).toBeVisible();
  await pull.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 10 });
  await pull.dispatchEvent("pointermove", { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 100 });
  await expect(pull.getByRole("status")).not.toHaveText("Release to refresh");
  await pull.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 100 });
  await pull.getByRole("button", { name: "Refresh" }).click();
  await expect(pull.getByRole("status")).toHaveText(/Updated just now|Refreshing…/);
});
