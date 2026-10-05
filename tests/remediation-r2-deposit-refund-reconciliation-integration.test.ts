import { randomUUID } from "node:crypto";
import type { Receipt } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
  refundCreate: vi.fn(),
  refundList: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    refunds: {
      create: (...args: unknown[]) => mocks.refundCreate(...args),
      list: (...args: unknown[]) => mocks.refundList(...args),
    },
    checkout: {
      sessions: {
        list: vi.fn().mockResolvedValue({ data: [], has_more: false }),
      },
    },
    paymentIntents: { retrieve: vi.fn() },
  }),
}));

import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const runTag = randomUUID().replaceAll("-", "");
const createdCustomerIds: string[] = [];
const createdUserIds: string[] = [];

async function createCustomerFixture(tag: string) {
  const user = await prisma.user.create({
    data: {
      id: `r2-rec-user-${tag}`,
      email: `r2-rec-${tag}@example.test`,
      name: "R2 Reconciliation Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  createdUserIds.push(user.id);
  const customer = await prisma.customer.create({
    data: {
      id: `r2-rec-customer-${tag}`,
      userId: user.id,
      referralCode: `R2R${tag.slice(0, 17)}`,
    },
  });
  createdCustomerIds.push(customer.id);
  const address = await prisma.serviceAddress.create({
    data: {
      id: `r2-rec-address-${tag}`,
      customerId: customer.id,
      line1: "1 Reconciliation Way",
      city: "Greeley",
      zip: "80631",
    },
  });
  return { customer, address };
}

async function cleanupCustomer(customerId: string): Promise<void> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { customerId },
    select: { id: true },
  });
  const agreementIds = agreements.map((agreement) => agreement.id);
  const deposits = await prisma.deposit.findMany({
    where: { agreementId: { in: agreementIds } },
    select: { id: true },
  });
  const invoices = await prisma.invoice.findMany({
    where: { customerId },
    select: { id: true },
  });
  const invoiceIds = invoices.map((invoice) => invoice.id);

  await prisma.providerOperation.deleteMany({
    where: { subjectId: { in: deposits.map((deposit) => deposit.id) } },
  });
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.deposit.deleteMany({
    where: { agreementId: { in: agreementIds } },
  });
  await prisma.receipt.deleteMany({ where: { customerId } });
  await prisma.invoiceLineItem.deleteMany({
    where: { invoiceId: { in: invoiceIds } },
  });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
  await prisma.rentalAgreement.deleteMany({
    where: { id: { in: agreementIds } },
  });
  await prisma.serviceAddress.deleteMany({ where: { customerId } });
  await prisma.customer.deleteMany({ where: { id: customerId } });
}

async function createDepositWithFailedRefund(
  tag: string,
  options: { linkSource: boolean; withReceipts?: boolean },
) {
  const withReceipts = options.withReceipts ?? true;
  const { customer, address } = await createCustomerFixture(tag);
  const agreement = await prisma.rentalAgreement.create({
    data: {
      id: `r2-rec-agreement-${tag}`,
      customerId: customer.id,
      serviceAddressId: address.id,
      status: "ACTIVE",
      depositCents: 5_000,
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      id: `r2-rec-invoice-${tag}`,
      customerId: customer.id,
      agreementId: agreement.id,
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

  let olderReceipt: Receipt | null = null;
  let sourceReceipt: Receipt | null = null;
  if (withReceipts) {
    // An OLDER, SMALLER successful receipt on the very same deposit invoice. The
    // retired "oldest successful payment" lookup would have picked this charge.
    olderReceipt = await prisma.receipt.create({
      data: {
        id: `r2-rec-older-receipt-${tag}`,
        customerId: customer.id,
        source: "STRIPE",
        amountCents: 1_000,
        method: "card",
        stripeChargeId: `ch_older_${tag}`,
        receivedOn: new Date("2026-10-01T15:00:00Z"),
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        receiptId: olderReceipt.id,
        amountCents: 1_000,
        method: "card",
        status: "succeeded",
        createdAt: new Date("2026-10-01T15:00:00Z"),
      },
    });

    sourceReceipt = await prisma.receipt.create({
      data: {
        id: `r2-rec-source-receipt-${tag}`,
        customerId: customer.id,
        source: "STRIPE",
        amountCents: 5_000,
        method: "card",
        stripeChargeId: `ch_source_${tag}`,
        receivedOn: new Date("2026-10-02T15:00:00Z"),
      },
    });
    await prisma.payment.create({
      data: {
        invoiceId: invoice.id,
        receiptId: sourceReceipt.id,
        amountCents: 5_000,
        method: "card",
        status: "SUCCEEDED",
        createdAt: new Date("2026-10-02T15:00:00Z"),
      },
    });
  }

  const deposit = await prisma.deposit.create({
    data: {
      id: `r2-rec-deposit-${tag}`,
      agreementId: agreement.id,
      sourceReceiptId: options.linkSource ? (sourceReceipt?.id ?? null) : null,
      amountCents: 5_000,
      refundable: true,
      refundedAmountCents: 5_000,
      refundedAt: new Date("2026-10-04T12:00:00Z"),
    },
  });
  const operation = await prisma.providerOperation.create({
    data: {
      kind: "REFUND_CREATE",
      subjectType: "Deposit",
      subjectId: deposit.id,
      idempotencyKey: `deposit-refund-${deposit.id}`,
      status: "FAILED",
      attempts: 1,
      lastError: "simulated definite provider failure",
      requestedAt: new Date(Date.now() - 3_600_000),
    },
  });
  return { deposit, operation, sourceReceipt, olderReceipt };
}

describe.skipIf(!enabled)(
  "R06 deposit refund recovery uses the immutable receipt",
  () => {
    beforeAll(() => undefined);

    beforeEach(() => {
      vi.clearAllMocks();
      mocks.refundList.mockResolvedValue({ data: [], has_more: false });
      mocks.refundCreate.mockImplementation(async () => ({
        id: `re_${randomUUID()}`,
      }));
    });

    afterEach(() => vi.clearAllMocks());

    afterAll(async () => {
      for (const customerId of createdCustomerIds) {
        await cleanupCustomer(customerId);
      }
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    });

    it("retries a same-agreement FAILED refund on the source receipt's charge, not the oldest payment", async () => {
      const tag = `${runTag.slice(0, 12)}a`;
      const { deposit, operation, sourceReceipt, olderReceipt } =
        await createDepositWithFailedRefund(tag, { linkSource: true });

      await finishPendingProviderOperations(200);

      expect(mocks.refundCreate).toHaveBeenCalledTimes(1);
      const [params, options] = mocks.refundCreate.mock.calls[0] as [
        { charge: string; amount: number; metadata: Record<string, string> },
        { idempotencyKey: string },
      ];
      expect(params.charge).toBe(sourceReceipt!.stripeChargeId);
      expect(params.charge).not.toBe(olderReceipt!.stripeChargeId);
      expect(params.amount).toBe(5_000);
      expect(params.metadata).toEqual({ depositId: deposit.id });
      expect(options.idempotencyKey).toBe(operation.idempotencyKey);

      const after = await prisma.deposit.findUniqueOrThrow({
        where: { id: deposit.id },
      });
      expect(after.stripeRefundId).toMatch(/^re_/);
      const finished = await prisma.providerOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      expect(finished.status).toBe("SUCCEEDED");
    });

    it("never retries a deposit refund against a guessed charge when no receipt proves the source", async () => {
      const tag = `${runTag.slice(0, 12)}b`;
      const { deposit, operation } = await createDepositWithFailedRefund(tag, {
        linkSource: false,
        withReceipts: false,
      });

      await finishPendingProviderOperations(200);

      // No immutable link and no receipt evidence on any invoice: the source is
      // unprovable, so nothing may be sent to Stripe (and the operation stays
      // visible for the owner to reconcile).
      expect(mocks.refundCreate).not.toHaveBeenCalled();
      const after = await prisma.deposit.findUniqueOrThrow({
        where: { id: deposit.id },
      });
      expect(after.stripeRefundId).toBeNull();
      const stillOpen = await prisma.providerOperation.findUniqueOrThrow({
        where: { id: operation.id },
      });
      expect(stillOpen.status).toBe("FAILED");
    });
  },
);
