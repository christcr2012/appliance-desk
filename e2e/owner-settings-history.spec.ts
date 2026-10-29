import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

// O-1: the settings history shows what an undo will do before it happens, a changed-while-you-looked setting is
// reported instead of overwritten, a section save can be previewed first, and the Switches list has its full set of rows.
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

const settings = () => prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });

test.describe("settings history and previews", () => {
  let original: { lateFeeGraceDays: number; referralRewardCents: number };
  const auditIds: string[] = [];

  test.beforeAll(async () => {
    if (!isolated) return;
    const s = await settings();
    original = { lateFeeGraceDays: s.lateFeeGraceDays, referralRewardCents: s.referralRewardCents };
  });
  test.afterAll(async () => {
    if (!isolated) return;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: original });
    await prisma.auditLog.deleteMany({ where: { id: { in: auditIds } } });
  });

  /** A saved change exactly as the settings save writes it: the whole row before and after. */
  async function recordChange(field: "lateFeeGraceDays", from: number, to: number) {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    const current = await settings();
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { [field]: to } });
    const row = await prisma.auditLog.create({
      data: {
        userId: owner.id, action: "settings.update", entityType: "BusinessSettings", entityId: "singleton",
        oldValue: JSON.parse(JSON.stringify({ ...current, [field]: from })),
        newValue: JSON.parse(JSON.stringify({ ...current, [field]: to })),
      },
    });
    auditIds.push(row.id);
    return row.id;
  }

  test("undo shows what it will do first, can be declined, and works when confirmed (phone width, keyboard)", async ({ page }) => {
    const from = 61 + (randomUUID().charCodeAt(0) % 5);
    const to = from + 2;
    const id = await recordChange("lateFeeGraceDays", from, to);
    await page.goto("/desk/settings/history");
    const row = page.getByRole("listitem").filter({ hasText: `Late fee grace days: ${from} → ${to}` });
    const review = row.getByRole("link", { name: "Review undoing Late fee grace days" });
    await review.focus();
    await page.keyboard.press("Enter");
    const panel = page.getByRole("region", { name: "Check this undo" });
    await expect(panel.getByRole("heading", { name: "Undo this change?" })).toBeVisible();
    await expect(panel).toContainText(`${to} → ${from}`);
    await expect(panel).toContainText("Nothing has been changed yet");
    expect((await settings()).lateFeeGraceDays).toBe(to);
    // Declining leaves it alone.
    await panel.getByRole("link", { name: "No, leave it as it is" }).click();
    await expect(page.getByRole("region", { name: "Check this undo" })).toHaveCount(0);
    expect((await settings()).lateFeeGraceDays).toBe(to);
    // Confirming undoes it and says so.
    await page.goto(`/desk/settings/history?undo=${id}&key=lateFeeGraceDays`);
    await page.getByRole("button", { name: "Yes, undo it" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Undone." })).toBeVisible();
    expect((await settings()).lateFeeGraceDays).toBe(from);
    expect(await prisma.auditLog.count({ where: { action: "settings.undo", newValue: { path: ["lateFeeGraceDays"], equals: from } } })).toBeGreaterThan(0);
  });

  test("a setting that changed while the owner was looking is reported and left alone", async ({ page }) => {
    const id = await recordChange("lateFeeGraceDays", 70, 72);
    await page.goto(`/desk/settings/history?undo=${id}&key=lateFeeGraceDays`);
    await expect(page.getByRole("button", { name: "Yes, undo it" })).toBeVisible();
    // Someone else saves a different value after the preview was drawn.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 75 } });
    await page.getByRole("button", { name: "Yes, undo it" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Someone else changed this setting" })).toBeVisible();
    expect((await settings()).lateFeeGraceDays).toBe(75);
  });

  test("a row change is previewed in its Change sheet before saving and nothing is written by the preview", async ({ page }) => {
    // AR-8: the section form's preview became the row's Change sheet, which
    // shows "From … to …" (and what the change does) before anything saves.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 10 } });
    await page.goto("/desk/settings?section=policies");
    const row = page.locator("#row-lateFeeGraceDays");
    await row.getByRole("button", { name: "Change…" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Days")).toHaveValue("10");
    await sheet.getByLabel("Days").fill("12");
    await expect(sheet.getByText("From 10 to 12")).toBeVisible();
    expect((await settings()).lateFeeGraceDays).toBe(10);
    await page.keyboard.press("Escape");
    await row.getByRole("button", { name: "Change…" }).click();
    await sheet.getByLabel("Days").fill("12");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved Late fee grace days")).toBeVisible();
    await expect.poll(async () => (await settings()).lateFeeGraceDays).toBe(12);
  });

  test("saving from a sheet that is out of date is refused and the newer value is left alone", async ({ page }) => {
    // AR-8: the per-row revision check is the section check's replacement —
    // a sheet opened before someone else saved is refused, in place.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 20 } });
    await page.goto("/desk/settings?section=policies");
    const row = page.locator("#row-lateFeeGraceDays");
    await row.getByRole("button", { name: "Change…" }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet.getByLabel("Days")).toHaveValue("20");
    // Another owner saves the same setting while this sheet stays open.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 30 } });
    await sheet.getByLabel("Days").fill("40");
    await sheet.getByRole("button", { name: "Save" }).click();
    await expect(sheet.getByRole("alert")).toContainText("changed");
    expect((await settings()).lateFeeGraceDays).toBe(30);
    // What was typed is still in the sheet.
    await expect(sheet.getByLabel("Days")).toHaveValue("40");
  });

  test("the undo check passes the accessibility scan on phone and desktop, light and dark", async ({ page }) => {
    const id = await recordChange("lateFeeGraceDays", 50, 52);
    await scanAccessibilityRoute(page, {
      path: "/desk/settings/history", role: "OWNER", fixture: `/desk/settings/history?undo=${id}&key=lateFeeGraceDays`,
    });
  });
});

test("the Switches list shows every customer-facing and money switch, with links that open", async ({ page }) => {
  await page.goto("/desk/settings/switches");
  for (const name of [
    "Email to customers", "Launch-list emails", "Text messages (SMS)", "Automatic renewals", "Paused automations",
    "Card payments (Stripe)", "Colorado tax rate lookup", "Two-step sign-in required for",
    "Owner approval for large money actions", "Books start date",
  ]) await expect(page.getByText(name, { exact: true })).toBeVisible();
  const links = await page.getByRole("link", { name: "Where to change it" }).evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")));
  expect(links.length).toBeGreaterThanOrEqual(10);
  for (const href of new Set(links)) {
    const response = await page.request.get(href!);
    expect(response.status(), `${href} should open`).toBeLessThan(400);
  }
  // No secret key text on the page.
  expect(await page.locator("body").innerText()).not.toMatch(/sk_(live|test)_|rk_(live|test)_/);
});
