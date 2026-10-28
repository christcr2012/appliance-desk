import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { SIZES } from "./support/ar0b-fixtures";

// AR-2 slice 2: approval requests are decided from Today, in place —
// the OWNER-only Sheet, always through the confirmation, with the shared
// outcome words as a toast. Slice 3 adds the task half to this file.

const ownerState = "e2e/.auth/owner.json";
const staffState = "e2e/.auth/staff.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(db.hostname) && db.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(ownerState) ? ownerState : undefined });
test.setTimeout(150_000);

test("owner approves and declines waiting requests from Today's Sheet; staff never sees approvals", async ({ page, browser }) => {
  test.skip(!enabled, "Requires disposable PostgreSQL and authenticated CI sessions.");
  for (const path of [ownerState, staffState]) {
    expect(fs.existsSync(path), path + " must exist").toBe(true);
  }
  const { prisma } = await import("../src/lib/prisma");
  const { submitWriteOff } = await import("../src/domains/approvals");
  const tag = "ar2-" + randomUUID().slice(0, 8);
  const adminId = `${tag}-admin`;
  const customerUserId = `${tag}-cust-user`;
  const customerId = `${tag}-cust`;
  const invoiceIds = [`${tag}-inv-1`, `${tag}-inv-2`];
  const saved = await prisma.businessSettings.findUniqueOrThrow({
    where: { id: "singleton" },
    select: { approvalThresholds: true, approvalExpiryDays: true },
  });
  try {
    await prisma.user.createMany({ data: [
      { id: adminId, name: "Today Admin", email: `${tag}-admin@example.test`, role: "ADMIN", emailVerified: true },
      { id: customerUserId, name: "Today Customer", email: `${tag}-cust@example.test`, role: "CUSTOMER", emailVerified: true },
    ] });
    await prisma.customer.create({ data: { id: customerId, userId: customerUserId, referralCode: `T${tag}`.slice(0, 12) } });
    for (const id of invoiceIds) {
      await prisma.invoice.create({ data: { id, customerId, status: "OPEN", subtotalCents: 5000, amountDueCents: 5000, amountPaidCents: 0 } });
    }
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { approvalThresholds: { WRITE_OFF: 5000 }, approvalExpiryDays: 7 },
    });
    // Both write-offs sit exactly at the limit, so both wait for the owner.
    expect((await submitWriteOff(adminId, invoiceIds[0], "uncollectible")).status).toBe("SENT_FOR_APPROVAL");
    expect((await submitWriteOff(adminId, invoiceIds[1], "uncollectible")).status).toBe("SENT_FOR_APPROVAL");

    await page.goto("/desk/today", { waitUntil: "load" });
    await expect(page.getByText("Requests waiting for your approval (2)")).toBeVisible();
    await page.getByRole("link", { name: "Review requests" }).click();
    const sheet = page.getByRole("dialog", { name: "Waiting for your approval" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Approve…" })).toHaveCount(2);

    // Axe across the five sizes with the Sheet open.
    for (const width of SIZES) {
      await page.setViewportSize({ width, height: 900 });
      const audit = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      expect(audit.violations, `axe at ${width}px`).toEqual([]);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    // Approve the first through its confirmation.
    await sheet.getByRole("button", { name: "Approve…" }).first().click();
    const approveDialog = page.getByRole("alertdialog");
    await expect(approveDialog.getByText("Approve $50.00?")).toBeVisible();
    await approveDialog.getByRole("button", { name: "Approve and do it now" }).click();
    await expect(page.getByText("Approved and done.")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Approve…" })).toHaveCount(1);
    await expect.poll(async () =>
      (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceIds[0] } })).status,
    ).toBe("WRITTEN_OFF");

    // Decline the second; the Sheet closes when none remain.
    await sheet.getByRole("button", { name: "Decline…" }).first().click();
    const declineDialog = page.getByRole("alertdialog");
    await expect(declineDialog.getByText("Decline this request?")).toBeVisible();
    await declineDialog.getByRole("button", { name: "Decline", exact: true }).click();
    await expect(page.getByText("Declined. Nothing was changed.")).toBeVisible();
    await expect(sheet).toBeHidden();
    await expect.poll(async () =>
      (await prisma.approvalRequest.findFirstOrThrow({ where: { requestedByUserId: adminId, status: "DECLINED" } })).status,
    ).toBe("DECLINED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceIds[1] } })).status).toBe("OPEN");

    // Staff never sees the approvals action or the Sheet.
    const staffContext = await browser.newContext({ storageState: staffState });
    try {
      const staffPage = await staffContext.newPage();
      await staffPage.goto("/desk/today", { waitUntil: "load" });
      await expect(staffPage.getByText("Review requests")).toHaveCount(0);
      await expect(staffPage.getByRole("dialog", { name: "Waiting for your approval" })).toHaveCount(0);
    } finally {
      await staffContext.close();
    }
  } finally {
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { approvalThresholds: saved.approvalThresholds as object, approvalExpiryDays: saved.approvalExpiryDays },
    });
    await prisma.approvalRequest.deleteMany({ where: { requestedByUserId: adminId } });
    await prisma.auditLog.deleteMany({ where: { userId: adminId } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, customerUserId] } } });
    await prisma.$disconnect();
  }
});
