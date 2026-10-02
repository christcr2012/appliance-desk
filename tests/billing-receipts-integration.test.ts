import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { createReceiptWithAllocations } from "@/domains/billing/ledger";
import { backfillReceipts } from "../scripts/backfill-receipts";

const target = new URL(
  process.env.DATABASE_URL ?? "postgresql://localhost/unset",
);
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("receipt ledger — real Postgres", () => {
  const tag = randomUUID();
  let userId: string;
  let customerId: string;
  const invoiceIds: string[] = [];

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        email: `receipt-ledger-${tag}@example.test`,
        name: "Receipt Ledger Test",
        role: "CUSTOMER",
        emailVerified: true,
      },
    });
    userId = user.id;
    customerId = (
      await prisma.customer.create({
        data: { userId, referralCode: `RL-${tag}`.slice(0, 20) },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.customer.delete({ where: { id: customerId } });
    await prisma.user.delete({ where: { id: userId } });
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

  it("one receipt allocates across three invoices and leaves one auditable overpayment credit", async () => {
    const [a, b, c] = await Promise.all([invoice(10_000), invoice(8_000), invoice(7_000)]);

    const result = await prisma.$transaction((tx) =>
      createReceiptWithAllocations(tx, {
        customerId,
        source: "MANUAL",
        amountCents: 40_000,
        method: "check",
        receivedOn: new Date("2026-10-01T06:00:00Z"),
        allocations: [
          { invoiceId: a, amountCents: 10_000 },
          { invoiceId: b, amountCents: 8_000 },
          { invoiceId: c, amountCents: 7_000 },
        ],
      }),
    );

    const receipt = await prisma.receipt.findUniqueOrThrow({
      where: { id: result.receiptId },
      include: { payments: true },
    });
    expect(receipt.amountCents).toBe(40_000);
    expect(receipt.payments).toHaveLength(3);
    expect(receipt.payments.reduce((sum, p) => sum + p.amountCents, 0)).toBe(25_000);

    const credit = await prisma.customerCredit.findUniqueOrThrow({
      where: { id: result.overpaymentCreditId! },
    });
    expect(credit).toMatchObject({
      amountCents: 15_000,
      remainingCents: 15_000,
      sourceType: "RECEIPT_OVERPAYMENT",
      sourceId: receipt.id,
      side: null,
    });
  });

  it("same Stripe charge replay resolves to one receipt and one allocation", async () => {
    const invoiceId = await invoice(5_000);
    const input = {
      customerId,
      source: "STRIPE" as const,
      amountCents: 5_000,
      method: "card",
      receivedOn: new Date("2026-10-02T18:00:00Z"),
      stripeChargeId: `ch_${tag}`,
      allocations: [{ invoiceId, amountCents: 5_000 }],
    };

    const first = await prisma.$transaction((tx) => createReceiptWithAllocations(tx, input));
    const second = await prisma.$transaction((tx) => createReceiptWithAllocations(tx, input));
    expect(second.receiptId).toBe(first.receiptId);
    expect(await prisma.receipt.count({ where: { stripeChargeId: input.stripeChargeId } })).toBe(1);
    expect(await prisma.payment.count({ where: { receiptId: first.receiptId } })).toBe(1);
  });

  it("database uniqueness prevents two side-less credits for one source", async () => {
    const sourceId = `receipt-source-${tag}`;
    await prisma.customerCredit.create({
      data: {
        customerId,
        amountCents: 100,
        remainingCents: 100,
        reason: "Overpayment",
        sourceType: "RECEIPT_OVERPAYMENT",
        sourceId,
        side: null,
      },
    });

    await expect(
      prisma.customerCredit.create({
        data: {
          customerId,
          amountCents: 100,
          remainingCents: 100,
          reason: "Overpayment",
          sourceType: "RECEIPT_OVERPAYMENT",
          sourceId,
          side: null,
        },
      }),
    ).rejects.toThrow();
  });

  it("refuses to backfill legacy manual overpayments instead of understating cash", async () => {
    const invoiceId = await invoice(1_000);
    const payment = await prisma.payment.create({
      data: {
        invoiceId,
        amountCents: 1_000,
        method: "check",
        status: "succeeded",
        recordedByUserId: userId,
      },
    });
    const legacyCredit = await prisma.customerCredit.create({
      data: {
        customerId,
        amountCents: 500,
        remainingCents: 500,
        reason: "Overpayment",
        authorizedByUserId: userId,
      },
    });
    const receiptsBefore = await prisma.receipt.count({ where: { customerId } });

    await expect(backfillReceipts(prisma)).rejects.toThrow(/legacy overpayment credit/i);

    expect(await prisma.receipt.count({ where: { customerId } })).toBe(receiptsBefore);
    expect(
      (await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).receiptId,
    ).toBeNull();

    await prisma.customerCredit.delete({ where: { id: legacyCredit.id } });
  });
});
