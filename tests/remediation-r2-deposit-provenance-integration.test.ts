import { randomUUID } from "node:crypto";
import type { RentalAgreement } from "@prisma/client";
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
const ownerId = `r2-prov-owner-${runTag}`;
const createdCustomerIds: string[] = [];
const createdUserIds: string[] = [];

async function createCustomerFixture(tag: string) {
  const user = await prisma.user.create({
    data: {
      id: `r2-prov-user-${tag}`,
      email: `r2-prov-${tag}@example.test`,
      name: "R2 Provenance Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);

  const customer = await prisma.customer.create({
    data: {
      id: `r2-prov-customer-${tag}`,
      userId: user.id,
      referralCode: `R2P${tag.slice(0, 17)}`,
    },
  });
  createdCustomerIds.push(customer.id);

  const address = await prisma.serviceAddress.create({
    data: {
      id: `r2-prov-address-${tag}`,
      customerId: customer.id,
      line1: "1 Provenance Way",
      city: "Greeley",
      zip: "80631",
    },
  });

  return { user, customer, address };
}

async function cleanupCustomer(customerId: string): Promise<void> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { customerId },
    select: { id: true },
  });
  const agreementIds = agreements.map((agreement) => agreement.id);
  const invoices = await prisma.invoice.findMany({
    where: { customerId },
    select: { id: true },
  });
  const invoiceIds = invoices.map((invoice) => invoice.id);

  await prisma.auditLog.deleteMany({
    where: { OR: [{ userId: ownerId }, { entityId: { in: invoiceIds } }] },
  });
  await prisma.providerOperation.deleteMany({
    where: { subjectId: { in: agreementIds } },
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

describe.skipIf(!enabled)("R06 deposit funding provenance in disposable Postgres", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: {
        id: ownerId,
        email: `r2-prov-owner-${runTag}@example.test`,
        name: "R2 Provenance Owner",
        role: "OWNER",
        emailVerified: true,
      },
    });
  });

  afterAll(async () => {
    for (const customerId of createdCustomerIds) {
      await cleanupCustomer(customerId);
    }
    await prisma.auditLog.deleteMany({ where: { userId: ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: [...createdUserIds, ownerId] } } });
  });

  it.each([2, 3])(
    "keeps the original Stripe receipt across a %i-agreement renewal chain",
    async (chainLength) => {
      const tag = randomUUID().replaceAll("-", "");
      const { customer, address } = await createCustomerFixture(tag);
      const agreements: RentalAgreement[] = [];

      for (let index = 0; index < chainLength; index += 1) {
        const prior = agreements[index - 1];
        agreements.push(
          await prisma.rentalAgreement.create({
            data: {
              id: `r2-prov-agreement-${index}-${tag}`,
              customerId: customer.id,
              serviceAddressId: address.id,
              status: index === 0 ? "ACTIVE" : "DRAFT",
              depositCents: 5_000,
              renewedFromAgreementId: prior?.id ?? null,
            },
          }),
        );
      }

      const original = agreements[0]!;
      const current = agreements.at(-1)!;
      const invoice = await prisma.invoice.create({
        data: {
          id: `r2-prov-invoice-${tag}`,
          customerId: customer.id,
          agreementId: original.id,
          status: "PAID",
          subtotalCents: 5_000,
          amountDueCents: 5_000,
          amountPaidCents: 5_000,
          lineItems: {
            create: {
              kind: "DEPOSIT",
              description: "Security deposit",
              amountCents: 5_000,
            },
          },
        },
      });
      const receipt = await prisma.receipt.create({
        data: {
          id: `r2-prov-receipt-${tag}`,
          customerId: customer.id,
          source: "STRIPE",
          amountCents: 5_000,
          method: "card",
          stripeChargeId: `ch_r2_prov_${tag}`,
          receivedOn: new Date("2026-10-01T18:00:00Z"),
          payments: {
            create: {
              invoiceId: invoice.id,
              amountCents: 5_000,
              method: "card",
              status: "SUCCEEDED",
            },
          },
        },
      });
      const deposit = await prisma.deposit.create({
        data: {
          id: `r2-prov-deposit-${tag}`,
          agreementId: original.id,
          sourceReceiptId: receipt.id,
          amountCents: 5_000,
          refundable: true,
        },
      });

      await prisma.deposit.update({
        where: { id: deposit.id },
        data: { agreementId: current.id },
      });

      const moved = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
      expect(moved.agreementId).toBe(current.id);
      expect(moved.sourceReceiptId).toBe(receipt.id);
      await expect(resolveDepositRefundRail(deposit.id)).resolves.toEqual({
        kind: "STRIPE",
        receiptId: receipt.id,
        stripeChargeId: `ch_r2_prov_${tag}`,
      });
    },
  );

  it("links a manual cash/check receipt to the deposit it funds", async () => {
    const tag = randomUUID().replaceAll("-", "");
    const { customer, address } = await createCustomerFixture(tag);
    const agreement = await prisma.rentalAgreement.create({
      data: {
        id: `r2-manual-agreement-${tag}`,
        customerId: customer.id,
        serviceAddressId: address.id,
        status: "ACTIVE",
        depositCents: 5_000,
      },
    });
    const deposit = await prisma.deposit.create({
      data: {
        id: `r2-manual-deposit-${tag}`,
        agreementId: agreement.id,
        amountCents: 5_000,
        refundable: true,
      },
    });
    const invoice = await prisma.invoice.create({
      data: {
        id: `r2-manual-invoice-${tag}`,
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
      amountCents: 5_000,
      method: "check",
      reference: "CHECK-106",
      receivedOn: new Date("2026-10-03T06:00:00Z"),
    });

    const payment = await prisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id, status: "succeeded" },
      include: { receipt: true },
    });
    const linked = await prisma.deposit.findUniqueOrThrow({ where: { id: deposit.id } });
    expect(payment.receipt?.source).toBe("MANUAL");
    expect(linked.sourceReceiptId).toBe(payment.receiptId);
    await expect(resolveDepositRefundRail(deposit.id)).resolves.toEqual({
      kind: "MANUAL",
      receiptId: payment.receiptId,
    });
  });
});
