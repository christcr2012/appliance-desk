import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getRevenueRecords } from "@/domains/billing/revenue-records";

it.skipIf(!process.env.CI)(
  "reconciles real succeeded/manual payments, refunds, deposits and unpaid attempts",
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
          payments: {
            create: [
              { amountCents: 4000, status: "succeeded", createdAt: date },
              {
                amountCents: 1400,
                status: "succeeded",
                method: "cash",
                recordedByUserId: user.id,
                createdAt: date,
              },
              { amountCents: 2500, status: "pending", createdAt: date },
              { amountCents: 2500, status: "failed", createdAt: date },
              {
                amountCents: 2500,
                status: "succeeded",
                createdAt: new Date("2001-07-01T00:00:00Z"),
              },
            ],
          },
          refunds: {
            create: { amountCents: 600, reason: "OTHER", createdAt: date },
          },
        },
      });
      invoiceId = invoice.id;
      const asOf = new Date("2001-06-15T00:00:00Z");
      const payments = await getRevenueRecords("payments", true, "1", asOf);
      expect(payments.rows.map((row) => row.id)).toEqual(
        payments.rows
          .map((row) => row.id)
          .sort()
          .reverse(),
      );
      expect(payments.totalCents).toBe(5400);
      expect(payments.meta.totalCount).toBe(2);
      expect(
        payments.rows.map((r) => r.amountCents).reduce((a, b) => a + b, 0),
      ).toBe(payments.totalCents);
      expect(
        payments.rows.every(
          (r) =>
            r.invoice.id === invoice.id && r.invoice.customerId === customer.id,
        ),
      ).toBe(true);
      expect(payments.rows.map((r) => r.basis)).toContain(
        "Owner-recorded payment",
      );
      const refunds = await getRevenueRecords("refunds", true, "1", asOf);
      expect(refunds.totalCents).toBe(600);
      expect(refunds.meta.totalCount).toBe(1);
      // Deposit remains part of gross invoice cash; neither this sum nor gross-minus-refund claims to be rent/profit.
      expect(payments.totalCents).not.toBe(4400);
    } finally {
      if (invoiceId) {
        await prisma.refund.deleteMany({ where: { invoiceId } });
        await prisma.payment.deleteMany({ where: { invoiceId } });
        await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
        await prisma.invoice.delete({ where: { id: invoiceId } });
      }
      if (customerId)
        await prisma.customer.delete({ where: { id: customerId } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  },
);
