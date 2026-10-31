import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { enabled } from "./support/ar0b-fixtures";

// AR-13 (docs/build-specs/engines/NOTIFICATIONS.md section 8): the bell end to end — a public lead
// lands on the owner's bell, opening it clears the count on the lead; the preferences page saves;
// staff get no notifications yet. Serial: the tests share the owner's bell state in order.
const ownerState = "e2e/.auth/owner.json";
const staffState = "e2e/.auth/staff.json";

test.describe.configure({ mode: "serial" });

test.describe("Notifications bell and preferences (AR-13)", () => {
  test.skip(!enabled, "Disposable Postgres required.");

  test("a website lead rings the owner's bell once, and opening it clears the count", async ({ browser }) => {
    test.skip(!fs.existsSync(ownerState), "A saved owner session is required.");
    const tag = randomUUID().replaceAll("-", "").slice(0, 8);
    const name = `Bell Lead ${tag}`;

    const ownerContext = await browser.newContext({ storageState: ownerState });
    const ownerPage = await ownerContext.newPage();
    // Baseline: clear anything already unread so the new lead is the only unread one.
    await ownerPage.goto("/desk/today");
    const bell = ownerPage.getByRole("button", { name: /Notifications/ });
    await bell.click();
    const markAll = ownerPage.getByRole("button", { name: "Mark all as read" });
    await markAll.or(ownerPage.getByText("Nothing new.")).first().waitFor();
    if (await markAll.isVisible().catch(() => false)) await markAll.click();
    await ownerPage.keyboard.press("Escape");
    await expect(ownerPage.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();

    // A visitor submits the public lead form (no sign-in).
    const publicContext = await browser.newContext();
    const form = await publicContext.newPage();
    await form.goto("/contact");
    await form.getByLabel("Your name").fill(name);
    await form.getByLabel("Phone number").fill("303-555-0142");
    await form.getByLabel("Email").fill(`bell-${tag}@example.com`);
    await form.getByRole("checkbox", { name: /Washer|Dryer/ }).first().check();
    await form.getByLabel(/I agree to the/).check();
    await form.getByRole("button", { name: "Request a quote" }).click();
    await expect(form.getByRole("heading", { name: /Thanks/ })).toBeVisible();
    await publicContext.close();

    // The owner's bell now shows exactly one unread, and it is that lead.
    await ownerPage.reload();
    const bellOne = ownerPage.getByRole("button", { name: "Notifications, 1 unread" });
    await expect(bellOne).toBeVisible();
    await bellOne.click();
    const row = ownerPage.getByRole("button", { name: new RegExp(`New lead: ${name}`) });
    await expect(row).toBeVisible();
    await row.click();
    await expect(ownerPage).toHaveURL(/\/desk\/leads\/[^/]+$/);
    await expect(ownerPage.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();

    // Clean up the lead and its notifications.
    const leadId = ownerPage.url().split("/").pop()!;
    const { prisma } = await import("../src/lib/prisma");
    await prisma.notification.deleteMany({ where: { entityId: leadId } });
    await prisma.consentRecord.deleteMany({ where: { details: { path: ["leadId"], equals: leadId } } });
    await prisma.auditLog.deleteMany({ where: { entityId: leadId } });
    await prisma.leadNote.deleteMany({ where: { leadId } });
    await prisma.lead.deleteMany({ where: { id: leadId } });
    await ownerContext.close();
  });

  test("the preferences page saves a switch and keeps it after a reload", async ({ browser }) => {
    test.skip(!fs.existsSync(ownerState), "A saved owner session is required.");
    const context = await browser.newContext({ storageState: ownerState });
    const page = await context.newPage();
    await page.goto("/desk/account/notifications");
    await expect(page.getByText("Email is off to start so your inbox stays quiet")).toBeVisible();
    const emailSwitch = page.getByRole("switch", { name: "By email" }).first();
    const before = await emailSwitch.getAttribute("aria-checked");
    await emailSwitch.click();
    await expect(emailSwitch).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
    // The save toast confirms the server action finished before the reload checks what stuck.
    await expect(
      page.getByText(before === "true" ? "New lead won't be emailed to you." : "New lead will also be emailed to you."),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("switch", { name: "By email" }).first()).toHaveAttribute(
      "aria-checked",
      before === "true" ? "false" : "true",
    );
    // Put it back the way it was, and wait for that save too.
    await page.getByRole("switch", { name: "By email" }).first().click();
    await expect(
      page.getByText(before === "true" ? "New lead will also be emailed to you." : "New lead won't be emailed to you."),
    ).toBeVisible();
    await context.close();
  });

  test("staff get no notifications yet and no bell count", async ({ browser }) => {
    test.skip(!fs.existsSync(staffState), "A saved staff session is required.");
    const context = await browser.newContext({ storageState: staffState });
    const page = await context.newPage();
    await page.goto("/desk/account/notifications");
    await expect(page.getByText("You don't get notifications yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Notifications", exact: true })).toBeVisible();
    await context.close();
  });

  test("the bell opens by keyboard, Escape returns focus, and the open panel passes axe", async ({ browser }) => {
    test.skip(!fs.existsSync(ownerState), "A saved owner session is required.");
    const context = await browser.newContext({ storageState: ownerState });
    const page = await context.newPage();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/desk/today");
    const bell = page.getByRole("button", { name: /Notifications/ });
    await bell.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("link", { name: "Choose what you get" })).toBeVisible();
    // Same WCAG tag scope as every other axe scan in this repo (accessibility-route-helpers.ts
    // AXE_TAGS). The unscoped default ruleset also runs best-practice rules (heading-order fired on
    // this page's own h3s in CI), which the house standard deliberately excludes.
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("link", { name: "Choose what you get" })).toBeHidden();
    await expect(bell).toBeFocused();
    await context.close();
  });
});
