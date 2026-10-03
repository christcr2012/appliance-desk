import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));

import { prisma } from "@/lib/prisma";
import { getRevenueRecords } from "@/domains/billing/revenue-records";

it.skipIf(!process.env.CI)(
  "reconciles real receipts, overpayment cash, refunds and unpaid attempts",
  async () => {
    const target = new URL(process.env.DATABASE_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(target.hostname);
    expect(target.pathname).toBe("/appliance_desk_test");

    const run = randomUUID();
    const user = await prisma.user.create({
      data: {
        name: "Revenue fixture",
        email: `revenue-${run}@example.test`,
        role: "CUSTOMER",
      },
    });
    let customerId: string | undefined;
    let invoiceId: string | undefined;

    try {
      const customer = await prisma.customer.create({
        data: { userId: user.id, referralCode: run.slice(0, 20) },
      });
      customerId = customer.id;
      const date = new Date("2001-06-10T12:00:00Z");
      const invoice = await prisma.invoice.create({
        data: {
          customerId,
          status: "PAID",
          amountDueCents: 5400,
          amountPaidCents: 5400,
          lineItems: {
            create: [
              { kind: "RENTAL", description: "Rent", amountCents: 4400 },
              { kind: "DEPOSIT", description: "Deposit", amountCents: 1000 },
            ],
          },
          refunds: {
            create: { amountCents: 600, reason: "OTHER", createdAt: date },
          },
        },
      });
      invoiceId = invoice.id;

      const providerReceipt = await prisma.receipt.create({
        data: {
          customerId,
          source: "STRIPE",
          amountCents: 4000,
          method: "card",
          stripeChargeId: `ch_${run.replaceAll("-", "").slice(0, 20)}`,
          receivedOn: date,
        },
      });
      const manualOverpayment = await prisma.receipt.create({
        data: {
          customerId,
          source: "MANUAL",
          amountCents: 2400,
          method: "cash",
          receivedOn: date,
          notes: "$14 allocated + $10 overpayment credit",
        },
      });
      const futureReceipt = await prisma.receipt.create({
        data: {
          customerId,
          source: "STRIPE",
          amountCents: 2500,
          method: "card",
          stripeChargeId: `ch_future_${run.replaceAll("-", "").slice(0, 16)}`,
          receivedOn: new Date("2001-07-01T12:00:00Z"),
        },
      });

      await prisma.payment.createMany({
        data: [
          {
            invoiceId,
            receiptId: providerReceipt.id,
            amountCents: 4000,
            status: "succeeded",
            createdAt: date,
          },
          {
            invoiceId,
            receiptId: manualOverpayment.id,
            amountCents: 1400,
            status: "succeeded",
            method: "cash",
            recordedByUserId: user.id,
            createdAt: date,
          },
          { invoiceId, amountCents: 2500, status: "pending", createdAt: date },
          { invoiceId, amountCents: 2500, status: "failed", createdAt: date },
          {
            invoiceId,
            receiptId: futureReceipt.id,
            amountCents: 2500,
            status: "succeeded",
            createdAt: new Date("2001-07-01T12:00:00Z"),
          },
        ],
      });

      const asOf = new Date("2001-06-15T12:00:00Z");
      const receipts = await getRevenueRecords("payments", true, "1", asOf);
      expect(receipts.totalCents).toBe(6400);
      expect(receipts.meta.totalCount).toBe(2);
      expect(
        receipts.rows.reduce((sum, row) => sum + row.amountCents, 0),
      ).toBe(receipts.totalCents);
      expect(receipts.rows.every((row) => row.invoice?.id === invoice.id)).toBe(true);
      expect(receipts.rows.map((row) => row.basis)).toContain(
        "Owner-recorded cash receipt",
      );
      // The extra $10 in the manual receipt is cash even though only $14 was
      // allocated to this invoice.
      expect(receipts.totalCents).toBeGreaterThan(invoice.amountPaidCents);

      const refunds = await getRevenueRecords("refunds", true, "1", asOf);
      expect(refunds.totalCents).toBe(600);
      expect(refunds.meta.totalCount).toBe(1);
    } finally {
      if (invoiceId) {
        await prisma.refund.deleteMany({ where: { invoiceId } });
        await prisma.payment.deleteMany({ where: { invoiceId } });
        await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
        await prisma.invoice.delete({ where: { id: invoiceId } });
      }
      if (customerId) {
        await prisma.receipt.deleteMany({ where: { customerId } });
        await prisma.customer.delete({ where: { id: customerId } });
      }
      await prisma.user.delete({ where: { id: user.id } });
    }
  },
);
