import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { InvoiceLineItemKind } from "@prisma/client";
import { categorizeLine, totalsByCategory } from "@/domains/billing/categories";
import { collectedBetween } from "@/domains/billing/collected";
import { prisma } from "@/lib/prisma";

const ALL_KINDS: InvoiceLineItemKind[] = [
  "RENTAL", "DELIVERY_FEE", "INSTALLATION_FEE", "REMOVAL_FEE", "DAMAGE_WAIVER", "DEPOSIT",
  "TAX", "LATE_FEE", "PREPAY_DISCOUNT", "CREDIT", "ADJUSTMENT",
];

describe("invoice line categories", () => {
  it("maps every line kind to exactly one owner-facing group", () => {
    expect(categorizeLine("RENTAL")).toBe("RENT");
    for (const kind of ["DELIVERY_FEE", "INSTALLATION_FEE", "REMOVAL_FEE", "DAMAGE_WAIVER"] as const) {
      expect(categorizeLine(kind)).toBe("FEES");
    }
    expect(categorizeLine("DEPOSIT")).toBe("DEPOSIT");
    expect(categorizeLine("TAX")).toBe("TAX");
    expect(categorizeLine("LATE_FEE")).toBe("LATE_FEE");
    expect(categorizeLine("PREPAY_DISCOUNT")).toBe("DISCOUNT");
    expect(categorizeLine("CREDIT")).toBe("CREDIT");
    expect(categorizeLine("ADJUSTMENT")).toBe("ADJUSTMENT");
    for (const kind of ALL_KINDS) expect(() => categorizeLine(kind)).not.toThrow();
  });

  it("rejects a kind it has never heard of rather than guessing", () => {
    expect(() => categorizeLine("MYSTERY" as InvoiceLineItemKind)).toThrow(/Unknown invoice line kind/);
  });

  it("totals signed amounts per group and leaves empty groups out", () => {
    expect(
      totalsByCategory([
        { kind: "RENTAL", amountCents: 4000 },
        { kind: "RENTAL", amountCents: 2000 },
        { kind: "DELIVERY_FEE", amountCents: 500 },
        { kind: "DAMAGE_WAIVER", amountCents: 1500 },
        { kind: "PREPAY_DISCOUNT", amountCents: -600 },
        { kind: "TAX", amountCents: 438 },
      ]),
    ).toEqual({ RENT: 6000, FEES: 2000, DISCOUNT: -600, TAX: 438 });
  });
});

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("collectedBetween on a real database", () => {
  it("counts receipts by received date, nets cash refunds, ignores credit refunds, and covers overpayments", async () => {
    const run = randomUUID();
    const user = await prisma.user.create({
      data: { name: "Collected fixture", email: `collected-${run}@example.test`, role: "CUSTOMER" },
    });
    const other = await prisma.user.create({
      data: { name: "Other fixture", email: `collected-other-${run}@example.test`, role: "CUSTOMER" },
    });
    const customer = await prisma.customer.create({ data: { userId: user.id, referralCode: `A${run.slice(0, 18)}` } });
    const otherCustomer = await prisma.customer.create({ data: { userId: other.id, referralCode: `B${run.slice(0, 18)}` } });
    try {
      const invoice = await prisma.invoice.create({
        data: { customerId: customer.id, status: "PAID", amountDueCents: 5000, amountPaidCents: 5000 },
      });
      const inJune = new Date("2002-06-10T18:00:00Z");
      const receipts = [
        { customerId: customer.id, source: "STRIPE" as const, amountCents: 5000, method: "card", receivedOn: inJune },
        // Overpayment: 4000 received, none allocated to an invoice. Still cash collected.
        { customerId: customer.id, source: "MANUAL" as const, amountCents: 4000, method: "check", receivedOn: inJune },
        // 2002-07-01 06:30 UTC is 00:30 on July 1 in Denver: just after June ends in Colorado.
        { customerId: customer.id, source: "MANUAL" as const, amountCents: 700, method: "cash", receivedOn: new Date("2002-07-01T06:30:00Z") },
        // Also July in Denver: outside June.
        { customerId: customer.id, source: "MANUAL" as const, amountCents: 9999, method: "cash", receivedOn: new Date("2002-07-02T00:00:00Z") },
        // Someone else's money in June.
        { customerId: otherCustomer.id, source: "MANUAL" as const, amountCents: 1234, method: "cash", receivedOn: inJune },
      ];
      await prisma.receipt.createMany({ data: receipts });
      await prisma.refund.create({ data: { invoiceId: invoice.id, amountCents: 1000, reason: "OTHER", createdAt: inJune } });
      const credit = await prisma.refund.create({ data: { invoiceId: invoice.id, amountCents: 800, reason: "GOODWILL", createdAt: inJune } });
      await prisma.customerCredit.create({
        data: { customerId: customer.id, amountCents: 800, remainingCents: 800, reason: "Invoice refund", sourceType: "REFUND_TO_CREDIT", sourceId: credit.id, side: null },
      });

      // June in Colorado: June 1 00:00 MDT (06:00Z) up to, not including, July 1 00:00 MDT.
      const from = new Date("2002-06-01T06:00:00Z");
      const to = new Date("2002-07-01T06:00:00Z");
      const mine = await collectedBetween(customer.id, from, to);
      expect(mine).toEqual({
        grossCents: 5000 + 4000,
        refundedCents: 1000,
        refundedToCreditCents: 800,
        netCents: 9000 - 1000,
        byMethod: { card: 5000, check: 4000 },
      });
      // Widening the end by an hour pulls in the 06:30Z receipt, which shows the end of the period is exclusive.
      const wider = await collectedBetween(customer.id, from, new Date("2002-07-01T07:00:00Z"));
      expect(wider.grossCents).toBe(9700);
      expect(wider.byMethod.cash).toBe(700);

      // Business-wide includes the other customer; scoping by customer excludes them.
      const everyone = await collectedBetween(null, from, to);
      expect(everyone.grossCents).toBeGreaterThanOrEqual(mine.grossCents + 1234);
      await expect(collectedBetween(customer.id, to, from)).rejects.toThrow(/before its end/);
    } finally {
      await prisma.customerCredit.deleteMany({ where: { customerId: customer.id } });
      await prisma.refund.deleteMany({ where: { invoice: { customerId: customer.id } } });
      await prisma.invoice.deleteMany({ where: { customerId: customer.id } });
      await prisma.receipt.deleteMany({ where: { customerId: { in: [customer.id, otherCustomer.id] } } });
      await prisma.customer.deleteMany({ where: { id: { in: [customer.id, otherCustomer.id] } } });
      await prisma.user.deleteMany({ where: { id: { in: [user.id, other.id] } } });
    }
  });
});
