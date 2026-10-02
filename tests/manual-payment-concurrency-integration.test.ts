import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import {
  recordManualPayment,
  writeOffInvoice,
} from "@/domains/billing/manual-payments";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("manual payment ledger concurrency", () => {
  const tag = randomUUID();
  let ownerId: string;
  let customerUserId: string;
  let customerId: string;
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    ownerId = (
      await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })
    ).id;
    const user = await prisma.user.create({
      data: {
        email: `manual-payment-${tag}@example.test`,
        name: "Manual Payment Concurrency",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    customerUserId = user.id;
    customerId = (
      await prisma.customer.create({
        data: {
          userId: user.id,
          referralCode: `MP-${tag}`,
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { entityId: { in: invoiceIds } },
    });
    await prisma.payment.deleteMany({
      where: { invoiceId: { in: invoiceIds } },
    });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: customerUserId } });
  });

  async function invoice(amountDueCents: number) {
    const row = await prisma.invoice.create({
      data: {
        customerId,
        status: "OPEN",
        subtotalCents: amountDueCents,
        amountDueCents,
      },
    });
    invoiceIds.push(row.id);
    return row.id;
  }

  it("two simultaneous payments cannot leave Payment rows ahead of the invoice balance", async () => {
    const invoiceId = await invoice(10_000);

    const [first, second] = await Promise.all([
      recordManualPayment(customerId, ownerId, {
        invoiceId,
        amountCents: 5_000,
        method: "check",
        reference: "concurrent-a",
      }),
      recordManualPayment(customerId, ownerId, {
        invoiceId,
        amountCents: 5_000,
        method: "check",
        reference: "concurrent-b",
      }),
    ]);

    expect(first.totalAppliedCents + second.totalAppliedCents).toBe(10_000);
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    const payments = await prisma.payment.findMany({
      where: { invoiceId, status: "succeeded" },
    });
    expect(payments).toHaveLength(2);
    expect(payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(
      10_000,
    );
    expect(stored.amountPaidCents).toBe(10_000);
    expect(stored.status).toBe("PAID");
    expect(
      await prisma.auditLog.count({
        where: { entityId: invoiceId, action: "billing.manual_payment" },
      }),
    ).toBe(2);
  });

  it("full payment and write-off serialize so exactly one terminal financial decision wins", async () => {
    const invoiceId = await invoice(5_000);

    const results = await Promise.allSettled([
      recordManualPayment(customerId, ownerId, {
        invoiceId,
        amountCents: 5_000,
        method: "bank_transfer",
      }),
      writeOffInvoice(invoiceId, ownerId, "Concurrency test write-off"),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(
      1,
    );
    const stored = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
    });
    expect(["PAID", "WRITTEN_OFF"]).toContain(stored.status);

    const payments = await prisma.payment.findMany({ where: { invoiceId } });
    if (stored.status === "PAID") {
      expect(stored.amountPaidCents).toBe(5_000);
      expect(payments.reduce((sum, payment) => sum + payment.amountCents, 0)).toBe(
        5_000,
      );
    } else {
      expect(stored.amountPaidCents).toBe(0);
      expect(payments).toHaveLength(0);
    }
  });
});
