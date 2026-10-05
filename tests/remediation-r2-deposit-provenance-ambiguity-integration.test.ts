import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { recordManualPayment } from "@/domains/billing/manual-payments";
import { resolveDepositRefundRail } from "@/domains/billing/deposit-provenance";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const runTag = randomUUID().replaceAll("-", "");
const ownerId = `r2-amb-owner-${runTag}`;
const customerIds: string[] = [];
const userIds: string[] = [];

async function fixture(tag: string) {
  const user = await prisma.user.create({
    data: {
      id: `r2-amb-user-${tag}`,
      email: `r2-amb-${tag}@example.test`,
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  userIds.push(user.id);
  const customer = await prisma.customer.create({
    data: {
      id: `r2-amb-customer-${tag}`,
      userId: user.id,
      referralCode: `R2A${tag.slice(0, 17)}`,
    },
  });
  customerIds.push(customer.id);
  const address = await prisma.serviceAddress.create({
    data: {
      id: `r2-amb-address-${tag}`,
      customerId: customer.id,
      line1: "2 Provenance Way",
      city: "Greeley",
      zip: "80631",
    },
  });
  const agreement = await prisma.rentalAgreement.create({
    data: {
      id: `r2-amb-agreement-${tag}`,
      customerId: customer.id,
      serviceAddressId: address.id,
      status: "ACTIVE",
      depositCents: 5_000,
    },
  });
  const deposit = await prisma.deposit.create({
    data: {
      id: `r2-amb-deposit-${tag}`,
      agreementId: agreement.id,
      amountCents: 5_000,
      refundable: true,
    },
  });
  return { customer, agreement, deposit };
}

async function cleanupCustomer(customerId: string): Promise<void> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { customerId },
    select: { id: true },
  });
  const agreementIds = agreements.map((row) => row.id);
  const invoices = await prisma.invoice.findMany({
    where: { customerId },
    select: { id: true },
  });
  const invoiceIds = invoices.map((row) => row.id);

  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { userId: ownerId },
        { entityId: { in: [...agreementIds, ...invoiceIds] } },
      ],
    },
  });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.deposit.deleteMany({ where: { agreementId: { in: agreementIds } } });
  await prisma.receipt.deleteMany({ where: { customerId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
  await prisma.serviceAddress.deleteMany({ where: { customerId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
}

describe.skipIf(!enabled)("R06 ambiguous deposit provenance in disposable Postgres", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `r2-amb-owner-${runTag}@example.test`,
        role: "OWNER",
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    for (const customerId of customerIds) await cleanupCustomer(customerId);
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [...userIds, ownerId] } } });
  });

  it("does not make a small remainder payment the source of a larger deposit", async () => {
    const tag = randomUUID().replaceAll("-", "");
    const { customer, agreement, deposit } = await fixture(tag);
    const invoice = await prisma.invoice.create({
      data: {
        id: `r2-amb-partial-invoice-${tag}`,
        customerId: customer.id,
        agreementId: agreement.id,
        status: "OPEN",
        subtotalCents: 1_000,
        amountDueCents: 1_000,
        amountPaidCents: 0,
        lineItems: {
          createMany: {
            data: [
              {
                kind: "DEPOSIT",
                description: "Security deposit",
                amountCents: 5_000,
              },
              {
                kind: "CREDIT",
                description: "Prior account credit",
                amountCents: -4_000,
              },
            ],
          },
        },
      },
    });

    await recordManualPayment(customer.id, ownerId, {
      invoiceId: invoice.id,
      amountCents: 1_000,
      method: "check",
    });

    const stored = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(stored.sourceReceiptId).toBeNull();
    await expect(resolveDepositRefundRail(deposit.id)).rejects.toThrow(
      /needs reconciliation/i,
    );
  });

  it("leaves split deposit payments unresolved instead of picking one receipt", async () => {
    const tag = randomUUID().replaceAll("-", "");
    const { customer, agreement, deposit } = await fixture(tag);
    const invoice = await prisma.invoice.create({
      data: {
        id: `r2-amb-split-invoice-${tag}`,
        customerId: customer.id,
        agreementId: agreement.id,
        status: "OPEN",
        subtotalCents: 5_000,
        amountDueCents: 5_000,
        amountPaidCents: 0,
        lineItems: {
          create: {
            kind: "DEPOSIT",
            description: "Security deposit",
            amountCents: 5_000,
          },
        },
      },
    });

    await recordManualPayment(customer.id, ownerId, {
      invoiceId: invoice.id,
      amountCents: 2_500,
      method: "check",
      reference: "SPLIT-1",
    });
    await recordManualPayment(customer.id, ownerId, {
      invoiceId: invoice.id,
      amountCents: 2_500,
      method: "check",
      reference: "SPLIT-2",
    });

    expect(
      await prisma.receipt.count({
        where: { payments: { some: { invoiceId: invoice.id } } },
      }),
    ).toBe(2);
    const stored = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(stored.sourceReceiptId).toBeNull();
    await expect(resolveDepositRefundRail(deposit.id)).rejects.toThrow(
      /needs reconciliation/i,
    );
  });
});
