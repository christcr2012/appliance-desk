import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { prisma } from "@/lib/prisma";

// Owner controls end to end on the real screens, on a phone-sized window, by keyboard where it matters, with the
// accessibility scan: goals, approval limits and the approvals inbox, per-admin permissions, and the private workspace
// (pinned shortcuts). Each test puts back what it changed.
const state = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const isolated = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe.configure({ mode: "serial" });
test.use({ storageState: fs.existsSync(state) ? state : undefined, viewport: { width: 360, height: 800 } });
test.beforeEach(() => {
  if (process.env.CI) expect(fs.existsSync(state)).toBe(true);
  test.skip(!isolated || !fs.existsSync(state), "Disposable CI owner session required.");
});

async function phoneKeyboardAndAxe(page: Page) {
  // A server-action RSC refresh may show the saved row before Next has finished setting its streamed title.
  // Require a real document title before scanning; a permanently missing title still fails the test.
  await expect(page).toHaveTitle(/\S/, { timeout: 15000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
}

test("goals: set a cash target, see progress against it, then remove it", async ({ page }) => {
  await page.goto("/desk/settings/goals");
  await expect(page.getByRole("heading", { name: "Goals and alerts", level: 1 })).toBeVisible();
  const cash = page.getByLabel("Target (dollars)");
  await cash.fill("5000");
  await cash.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByLabel("Target (dollars)")).toHaveValue("5000.00");
  await expect(page.getByText(/of \$5,000\.00/)).toBeVisible();
  await phoneKeyboardAndAxe(page);

  // A target that is not a number is refused in plain words and nothing changes.
  await page.getByLabel("Target (dollars)").fill("lots");
  await page.getByRole("button", { name: "Save target" }).first().click();
  await expect(page.getByRole("alert").filter({ hasText: /plain number/ })).toBeVisible();

  await page.getByRole("button", { name: "Remove target" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Remove target" })).toHaveCount(0);
});

test("approval limits: fill in the suggested amount, save it, reload to see it kept, then turn every limit off", async ({ page }) => {
  await page.goto("/desk/settings/approvals");
  await expect(page.getByRole("heading", { name: "Approval limits", level: 1 })).toBeVisible();
  const firstBox = page.getByLabel(/ask me at or above \(dollars\)/).first();
  await expect(firstBox).toHaveValue("");
  await page.getByRole("button", { name: /^Fill in \$/ }).first().click();
  await expect(firstBox).not.toHaveValue("");
  const filled = await firstBox.inputValue();
  // Pressing the helper button does not save anything by itself.
  await page.reload();
  await expect(page.getByLabel(/ask me at or above \(dollars\)/).first()).toHaveValue("");
  await page.getByRole("button", { name: /^Fill in \$/ }).first().click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  // Reload until the value shown comes from the database (the save may still be finishing), so a broken save is caught.
  await expect.poll(async () => {
    await page.reload();
    return page.getByLabel(/ask me at or above \(dollars\)/).first().inputValue();
  }, { timeout: 15000 }).toBe(filled);
  await phoneKeyboardAndAxe(page);
  await page.getByRole("button", { name: /Turn all limits off/ }).click();
  await expect(page.getByLabel(/ask me at or above \(dollars\)/).first()).toHaveValue("");

  // The inbox itself opens and, with nothing waiting, says so.
  await page.goto("/desk/approvals");
  await expect(page.getByRole("heading", { name: "Approvals", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Waiting for you \(0\)/ })).toBeVisible();
  await phoneKeyboardAndAxe(page);
});

test("permissions: take one thing away from an admin, see it, and give it back", async ({ page }) => {
  test.slow();
  const tag = randomUUID().slice(0, 8);
  const email = `perm-${tag}@example.test`;
  const adminId = execFileSync("npx", ["tsx", "scripts/create-ci-login.ts", email, `Fixture-${tag}!`, "ADMIN"], { encoding: "utf8", env: process.env }).trim();
  try {
    await page.goto("/desk/settings/permissions");
    const card = page.locator("section", { has: page.getByText(email) });
    const row = card.getByRole("listitem").filter({ hasText: "Post or void an expense" });
    await expect(row).toContainText("Currently allowed.");
    await row.getByRole("button", { name: "Take this away" }).click();
    await expect(page.locator("section", { has: page.getByText(email) }).getByRole("listitem").filter({ hasText: "Post or void an expense" })).toContainText("Currently not allowed.");
    expect(await prisma.staffCapabilityOverride.count({ where: { userId: adminId, capability: "POST_EXPENSES", allowed: false } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: adminId, action: "staff.capability" } })).toBe(1);
    await phoneKeyboardAndAxe(page);
    await page.locator("section", { has: page.getByText(email) }).getByRole("listitem").filter({ hasText: "Post or void an expense" }).getByRole("button", { name: "Give it back" }).click();
    await expect(page.locator("section", { has: page.getByText(email) }).getByRole("listitem").filter({ hasText: "Post or void an expense" })).toContainText("Currently allowed.");
    expect(await prisma.staffCapabilityOverride.count({ where: { userId: adminId } })).toBe(0);
  } finally {
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: adminId } });
    await prisma.user.updateMany({ where: { id: adminId }, data: { archivedAt: new Date() } });
  }
});

test("workspace: pin a shortcut, see it under My workspace, unpin it, and reset", async ({ page }) => {
  await page.goto("/desk/control-center");
  await expect(page.getByRole("heading", { name: "Manage my business", level: 1 })).toBeVisible();
  await expect(page.getByText("None yet. Use the Pin button on any card above.")).toBeVisible();
  const pin = page.getByRole("button", { name: /^Pin / }).first();
  const label = ((await pin.getAttribute("aria-label")) ?? "").replace(/^Pin /, "");
  expect(label).not.toBe("");
  await pin.click();
  const workspace = page.locator("#my-workspace");
  await expect(workspace.getByRole("button", { name: `Unpin ${label}` })).toBeVisible();
  await expect(page.getByText("None yet. Use the Pin button on any card above.")).toHaveCount(0);
  await phoneKeyboardAndAxe(page);
  await workspace.getByRole("button", { name: `Unpin ${label}` }).click();
  await expect(page.getByText("None yet. Use the Pin button on any card above.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset my workspace" })).toBeDisabled();
});

test.afterAll(async () => {
  if (!isolated) return;
  const owner = await prisma.user.findFirst({ where: { role: "OWNER" }, select: { id: true } });
  if (owner) await prisma.ownerWorkspacePreference.deleteMany({ where: { userId: owner.id } });
});
