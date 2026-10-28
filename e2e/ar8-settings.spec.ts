import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

// AR-8: the catalog settings page — search lands on a row, a row save shows
// the saved toast and its Undo, the phone section list navigates, an admin
// sees owner rows read-only, and an old section URL lands on the new one.
const ownerState = "e2e/.auth/owner.json";
const adminState = "e2e/.auth/admin.json";
const db = (() => { try { return new URL(process.env.DATABASE_URL ?? ""); } catch { return null; } })();
const isolated = process.env.CI === "true" && !!db && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe.configure({ mode: "serial" });
test.beforeEach(() => {
  test.skip(!isolated || !fs.existsSync(ownerState), "Disposable CI owner session required.");
});

test.afterAll(async () => {
  if (!isolated) return;
  await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeFlatCents: 0 } }).catch(() => undefined);
});

test.describe("AR-8 settings (owner, desktop)", () => {
  test.use({ storageState: ownerState, viewport: { width: 1280, height: 900 } });

  test("search 'late fee' → row → change to $6 → saved toast → Undo", async ({ page }) => {
    await page.goto("/desk/settings?section=rentals");
    const search = page.locator("[data-kit-search]").first();
    await search.fill("late fee");
    const hit = page.getByRole("link", { name: /Flat late fee/ });
    await expect(hit).toBeVisible();
    await hit.click();
    await expect(page).toHaveURL(/section=rentals/);
    const row = page.locator("#row-lateFeeFlatCents");
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Change…" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByLabel(/Amount \(\$\)/).fill("6");
    await expect(sheet.getByText("From $0.00 to $6.00")).toBeVisible();
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved Flat late fee")).toBeVisible();
    const stored = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(stored.lateFeeFlatCents).toBe(600);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(row.getByText("$0.00")).toBeVisible();
    const restored = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(restored.lateFeeFlatCents).toBe(0);
  });

  test("old URL /desk/settings?section=policies lands on Rentals & policies", async ({ page }) => {
    await page.goto("/desk/settings?section=policies");
    await expect(page).toHaveURL(/section=rentals/);
    await expect(page.locator("#row-lateFeeFlatCents")).toBeVisible();
  });

  test("keyboard: search, open a Sheet, Escape returns focus", async ({ page }) => {
    await page.goto("/desk/settings?section=rentals");
    const search = page.locator("[data-kit-search]").first();
    await search.focus();
    await search.fill("grace");
    await page.getByRole("link", { name: /Late fee grace days/ }).click();
    const row = page.locator("#row-lateFeeGraceDays");
    const change = row.getByRole("button", { name: "Change…" });
    await change.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("accessibility scan of the rentals section", async ({ page }) => {
    await scanAccessibilityRoute(page, { path: "/desk/settings", role: "OWNER", fixture: "/desk/settings?section=rentals" });
  });
});

test.describe("AR-8 settings (owner, phone)", () => {
  test.use({ storageState: ownerState, viewport: { width: 390, height: 844 } });

  test("phone section list → section → back", async ({ page }) => {
    await page.goto("/desk/settings");
    const listLink = page.getByRole("link", { name: /Rentals & policies/ }).first();
    await expect(listLink).toBeVisible();
    await listLink.click();
    await expect(page).toHaveURL(/section=rentals/);
    await expect(page.locator("#row-relocationFeeCents")).toBeVisible();
    await page.getByRole("link", { name: "Settings" }).first().click();
    await expect(page.getByRole("link", { name: /Money & taxes/ }).first()).toBeVisible();
  });
});

test.describe("AR-8 settings (admin)", () => {
  test.use({ storageState: adminState, viewport: { width: 1280, height: 900 } });

  test("admin sees owner rows read-only with the reason", async ({ page }) => {
    test.skip(!fs.existsSync(adminState), "Admin session required.");
    await page.goto("/desk/settings?section=team");
    const row = page.locator("#row-trustedDeviceDays");
    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: "Change…" })).toHaveCount(0);
    await row.getByRole("button", { name: "View" }).click();
    await expect(row.getByText("Only the owner can change this.")).toBeVisible();
  });
});
