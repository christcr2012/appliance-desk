import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled } from "./support/ar0b-fixtures";

// DEC-2 / FEE-1: the owner waives a recorded late fee from the bill page, with a reason, and it never comes back.
const owner = "e2e/.auth/owner.json";

async function lateFeeFixture() {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const userId = `lfw-u-${tag}`;
  const customerId = `lfw-c-${tag}`;
  const name = `Late Fee Waiver ${tag}`;
  await prisma.user.create({ data: { id: userId, email: `lfw-${tag}@example.test`, name, role: "CUSTOMER" } });
  await prisma.customer.create({ data: { id: customerId, userId, referralCode: `LFW${tag}`, phone: "970-555-0143" } });
  const address = await prisma.serviceAddress.create({ data: { customerId, line1: "1402 10th Ave", city: "Greeley", zip: "80631" } });
  const agreement = await prisma.rentalAgreement.create({
    data: { customerId, serviceAddressId: address.id, status: "ACTIVE", lateFeeCents: 500, lateFeeGraceDays: 10 },
  });
  const bill = await prisma.invoice.create({
    data: { customerId, agreementId: agreement.id, status: "OPEN", dueDate: new Date(Date.now() - 20 * 86_400_000), amountDueCents: 7000 },
  });
  const charge = await prisma.pendingCharge.create({
    data: { customerId, agreementId: agreement.id, kind: "LATE_FEE", amountCents: 500, forInvoiceId: bill.id },
  });
  return {
    name, customerId, billId: bill.id, chargeId: charge.id,
    url: `/desk/billing/customer/${customerId}/invoice/${bill.id}`,
    async state() {
      return prisma.pendingCharge.findUniqueOrThrow({ where: { id: charge.id } });
    },
    async cleanup() {
      await prisma.auditLog.deleteMany({ where: { entityId: charge.id } });
      await prisma.pendingCharge.deleteMany({ where: { customerId } });
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.rentalAgreement.deleteMany({ where: { customerId } });
      await prisma.serviceAddress.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}

test.describe("Waive a late fee", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("owner waives from the bill page with a reason; the fee is marked waived and stays waived", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    const fixture = await lateFeeFixture();
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(fixture.url, { waitUntil: "load" });
      const box = page.getByRole("region", { name: /Late fee/ });
      await expect(box).toContainText("Late fee of $5 will be added to the customer's next bill");

      // A reason is required: the form does not send without one.
      await box.getByRole("button", { name: "Waive the fee" }).click();
      expect((await fixture.state()).waivedAt).toBeNull();

      await box.getByLabel("Why waive it?").fill("First time late, long-time customer");
      await box.getByRole("button", { name: "Waive the fee" }).click();
      await expect(page.getByRole("region", { name: /Late fee/ })).toContainText("Late fee waived — First time late, long-time customer");

      const waived = await fixture.state();
      expect(waived.waivedAt).not.toBeNull();
      expect(waived.waivedReason).toBe("First time late, long-time customer");

      // It never comes back: reloading still shows it waived, and no waive form is offered again.
      await page.reload({ waitUntil: "load" });
      const again = page.getByRole("region", { name: /Late fee/ });
      await expect(again).toContainText("Late fee waived");
      await expect(again.getByRole("button", { name: "Waive the fee" })).toHaveCount(0);
      expect((await fixture.state()).waivedAt?.getTime()).toBe(waived.waivedAt?.getTime());

      await scanAccessibilityRoute(page, {
        path: "/desk/billing/customer/[id]/invoice/[invoiceId]", role: "OWNER", fixture: fixture.url,
      }, [390, 1280]);
    } finally {
      await fixture.cleanup();
    }
  });
});
