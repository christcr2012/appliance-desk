import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getRevenueRecords } from "@/domains/billing/revenue-records";

it.skipIf(!process.env.CI)(
  "reconciles real receipts (including an overpayment), allocations and refunds kept as credit",
  async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
    expect(target.pathname).toBe("/appliance_desk_test");
    const run = randomUUID();
    const user = await prisma.user.create({
      data: { name: "Revenue fixture", email: `revenue-${run}@example.test`, role: "CUSTOMER" },
    });
    let customerId: string | undefined;
    let invoiceId: string | undefined;
    try {
      const customer = await prisma.customer.create({
        data: { userId: user.id, referralCode: run.slice(0, 20) },
      });
      customerId = customer.id;
      const june = new Date("2001-06-10T12:00:00Z");
      const invoice = await prisma.invoice.create({
        data: {
          customerId,
          status: "PAID",
          amountDueCents: 5400,
          amountPaidCents: 5400,
          lineItems: { create: [{ kind: "RENTAL", description: "Rent", amountCents: 5400 }] },
        },
      });
      invoiceId = invoice.id;
      // A 4000 card payment, and a 3000 check of which only 1400 paid the invoice (1600 overpaid).
      const card = await prisma.receipt.create({
        data: { customerId, source: "STRIPE", amountCents: 4000, method: "card", receivedOn: june },
      });
      const check = await prisma.receipt.create({
        data: { customerId, source: "MANUAL", amountCents: 3000, method: "check", receivedOn: june, recordedByUserId: user.id },
      });
      // Received in July: outside the June window.
      await prisma.receipt.create({
        data: { customerId, source: "MANUAL", amountCents: 2500, method: "cash", receivedOn: new Date("2001-07-01T12:00:00Z") },
      });
      await prisma.payment.createMany({
        data: [
          { invoiceId, receiptId: card.id, amountCents: 4000, status: "succeeded", method: "card" },
          { invoiceId, receiptId: check.id, amountCents: 1400, status: "succeeded", method: "check" },
          { invoiceId, amountCents: 2500, status: "failed" },
        ],
      });
      const cashRefund = await prisma.refund.create({
        data: { invoiceId, amountCents: 600, reason: "OTHER", createdAt: june },
      });
      const creditRefund = await prisma.refund.create({
        data: { invoiceId, amountCents: 300, reason: "GOODWILL", createdAt: june },
      });
      await prisma.customerCredit.create({
        data: {
          customerId, amountCents: 300, remainingCents: 300, reason: "Invoice refund",
          sourceType: "REFUND_TO_CREDIT", sourceId: creditRefund.id, side: null, createdAt: june,
        },
      });

      const asOf = new Date("2001-06-15T00:00:00Z");
      const payments = await getRevenueRecords("payments", true, "1", asOf);
      // Receipts for this customer only: filter out any other test data by customer id.
      const mine = payments.rows.filter((r) => r.customerId === customerId);
      expect(mine.map((r) => r.amountCents).sort((a, b) => a - b)).toEqual([3000, 4000]);
      const checkRow = mine.find((r) => r.id === check.id)!;
      expect(checkRow).toMatchObject({ unallocatedCents: 1600, method: "check", basis: "Owner-recorded payment" });
      expect(checkRow.invoices).toEqual([{ id: invoiceId, invoiceNumber: invoice.invoiceNumber, amountCents: 1400 }]);
      expect(mine.find((r) => r.id === card.id)!.basis).toBe("Card or Stripe payment");

      const refunds = await getRevenueRecords("refunds", true, "1", asOf);
      const myRefunds = refunds.rows.filter((r) => r.customerId === customerId);
      expect(myRefunds.find((r) => r.id === cashRefund.id)!.basis).toBe("Refund returned to the customer");
      expect(myRefunds.find((r) => r.id === creditRefund.id)!.basis).toBe(
        "Refund kept as account credit (no cash returned)",
      );
      expect(refunds.toCreditCents).toBeGreaterThanOrEqual(300);
    } finally {
      if (customerId) {
        await prisma.customerCredit.deleteMany({ where: { customerId } });
        await prisma.refund.deleteMany({ where: { invoice: { customerId } } });
        await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
        await prisma.receipt.deleteMany({ where: { customerId } });
        await prisma.invoiceLineItem.deleteMany({ where: { invoice: { customerId } } });
        await prisma.invoice.deleteMany({ where: { customerId } });
        await prisma.customer.delete({ where: { id: customerId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
    }
  },
);
