import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import AxeBuilder from "@axe-core/playwright";

// O-4: the owner schedules a price change for a rental set from the real screen, sees it waiting, and cancels it.
// The set price itself never moves while the change is waiting. Phone width, keyboard and the accessibility scan included.
const state = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const isolated = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe.configure({ mode: "serial" });
test.use({ storageState: fs.existsSync(state) ? state : undefined, viewport: { width: 390, height: 844 } });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
  test.skip(!isolated || !fs.existsSync(state), "Disposable CI owner session required.");
});

const SET_ID = "rental-package-washer-dryer-set";

test("schedule a set price change by keyboard, see it waiting, leave the price alone, then cancel it", async ({ page }) => {
  const before = (await prisma.rentalPackage.findUniqueOrThrow({ where: { id: SET_ID } })).monthlyPriceCents;
  await page.goto("/desk/settings/price-changes");
  await expect(page.getByRole("heading", { name: "Price changes", exact: true })).toBeVisible();

  const target = page.getByLabel("Appliance or set");
  await target.selectOption({ label: `Washer + Dryer Set (now $${(before / 100).toFixed(2)} a month)` });
  await page.getByLabel("New monthly price (dollars)").fill("64.50");
  const start = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Starts on").fill(start);
  await page.getByLabel("Note to yourself (optional)").fill("browser test");
  await page.getByLabel("Note to yourself (optional)").press("Enter");

  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  const waiting = page.getByRole("listitem").filter({ hasText: "Washer + Dryer Set (set)" });
  await expect(waiting).toContainText("$64.50");
  await expect(waiting).toContainText("browser test");
  expect((await prisma.rentalPackage.findUniqueOrThrow({ where: { id: SET_ID } })).monthlyPriceCents).toBe(before);

  // The same day cannot be scheduled twice.
  await target.selectOption({ label: `Washer + Dryer Set (now $${(before / 100).toFixed(2)} a month)` });
  await page.getByLabel("New monthly price (dollars)").fill("65");
  await page.getByLabel("Starts on").fill(start);
  await page.getByRole("button", { name: "Schedule this change" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "already a price change scheduled" })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("listitem").filter({ hasText: "Washer + Dryer Set (set)" }).getByRole("button", { name: "Cancel this change" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Cancelled." })).toBeVisible();
  await expect(page.getByText("Nothing is scheduled.")).toBeVisible();
  expect((await prisma.rentalPackage.findUniqueOrThrow({ where: { id: SET_ID } })).monthlyPriceCents).toBe(before);
});

test.afterAll(async () => {
  if (!isolated) return;
  await prisma.scheduledPriceChange.deleteMany({ where: { packageId: SET_ID } });
  await prisma.auditLog.deleteMany({ where: { entityId: SET_ID, action: { in: ["pricing.schedule", "pricing.schedule_cancel"] } } });
});
