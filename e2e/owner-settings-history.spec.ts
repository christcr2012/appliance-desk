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

  test("a section can be previewed before saving and nothing is written by the preview", async ({ page }) => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 10 } });
    await page.goto("/desk/settings?section=policies");
    const grace = page.getByLabel("Days to pay before a late fee (at least 10)");
    // The form's saved values are put into the inputs when the page's script starts. Filling before that can leave
    // the saved "10" and the typed "12" joined as "1012" (seen in CI as "Too big: expected number to be <=90"), so
    // wait until the saved value shows, as the out-of-date test below already does.
    await expect(grace).toHaveValue("10");
    await grace.fill("12");
    await expect(grace).toHaveValue("12");
    await page.getByRole("button", { name: "Preview changes" }).click();
    const panel = page.getByLabel("What saving would change");
    await expect(panel).toContainText("Late fee grace days: 10 → 12");
    await expect(panel).toContainText("nothing is saved yet");
    expect((await settings()).lateFeeGraceDays).toBe(10);
    await page.getByRole("button", { name: "Save this section" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Settings saved." })).toBeVisible();
    await expect.poll(async () => (await settings()).lateFeeGraceDays).toBe(12);
  });

  test("saving from a page that is out of date is refused with a reload message", async ({ page }) => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 20, referralRewardCents: 2500 } });
    await page.goto("/desk/settings?section=policies");
    await expect(page.getByLabel("Days to pay before a late fee (at least 10)")).toHaveValue("20");
    // Another owner saves the same section while this page stays open.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { lateFeeGraceDays: 30 } });
    await page.getByLabel("Referral reward — same amount for both people").fill("40");
    await page.getByRole("button", { name: "Save this section" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Reload the page" })).toBeVisible();
    const after = await settings();
    expect(after.lateFeeGraceDays).toBe(30);
    expect(after.referralRewardCents).toBe(2500);
    // What was typed is still in the form.
    await expect(page.getByLabel("Referral reward — same amount for both people")).toHaveValue("40");
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
