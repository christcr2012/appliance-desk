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
  await expect(pull).toHaveAttribute("data-pull-ready", "true");
  // Real Chromium touch input, not dispatched DOM events: this exercises scroll
  // arbitration and the browser's pointercancel behavior.
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => document.scrollingElement?.scrollTop ?? window.scrollY)).toBe(0);
  const strip = pull.getByTestId("pull-refresh-status");
  const rect = await strip.boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width / 2;
  const y = rect!.y + rect!.height / 2; // the dedicated non-interactive status strip, away from screen edges
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const offset of [30, 60, 95]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y + offset }] });
  }
  await expect(pull.getByTestId("pull-refresh-status")).toHaveText("Release to refresh");
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(pull.getByTestId("pull-refresh-status")).toHaveText(/Updated just now|Refreshing…/);
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
  await expect(pull.getByTestId("pull-refresh-status")).not.toHaveText("Release to refresh");
  await pull.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, clientX: 20, clientY: 100 });
  await pull.getByRole("button", { name: "Refresh" }).click();
  await expect(pull.getByTestId("pull-refresh-status")).toHaveText(/Updated just now|Refreshing…/);
});

test("mobile rule cards reveal their existing actions without triggering a money change", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/desk/sales-tax/rules", { waitUntil: "load" });
  const card = page.locator("[data-swipe-card]").first();
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-swipe-open", "false");
  const rect = await card.boundingBox();
  expect(rect).not.toBeNull();
  const x = rect!.x + rect!.width * 0.75;
  const y = rect!.y + Math.min(rect!.height / 2, 35);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  for (const dx of [25, 50, 95]) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - dx, y }] });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(card).toHaveAttribute("data-swipe-open", "true");
  await expect(card.getByRole("link", { name: "History" })).toBeVisible();
  await expect(card.getByRole("link", { name: "Change…" })).toBeVisible();
  await page.getByRole("heading", { level: 1, name: /Tax and fee rules/ }).click();
  await expect(card).toHaveAttribute("data-swipe-open", "false");
  await expect(card.getByRole("button", { name: /More for row/ })).toBeVisible();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await card.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 1, clientX: 210, clientY: 20 });
  await card.dispatchEvent("pointerup", { pointerType: "touch", pointerId: 1, clientX: 120, clientY: 20 });
  await expect(card).toHaveAttribute("data-swipe-open", "false");
});
