import { randomUUID } from "node:crypto";
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
  checkoutSessionsList: vi.fn(),
  paymentIntentRetrieve: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    refunds: { create: (...args: unknown[]) => mocks.refundCreate(...args) },
    checkout: {
      sessions: { list: (...args: unknown[]) => mocks.checkoutSessionsList(...args) },
    },
    paymentIntents: {
      retrieve: (...args: unknown[]) => mocks.paymentIntentRetrieve(...args),
    },
  }),
}));

import { prisma } from "@/lib/prisma";
import {
  decideDepositRefund,
  issueInvoiceRefund,
} from "@/domains/billing/refunds";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

type Fixture = {
  userId: string;
  customerId: string;
  addressId: string;
  agreementId: string;
  depositId: string;
  invoiceId: string;
  receiptId: string;
  estimateId?: string;
};

const runTag = randomUUID().replaceAll("-", "");
const ownerId = `refund-owner-${runTag}`;
const staffId = `refund-staff-${runTag}`;
const activeFixtures: Fixture[] = [];

async function createFixture(source: "STRIPE" | "MANUAL" = "MANUAL"): Promise<Fixture> {
  const tag = randomUUID().replaceAll("-", "");
  const user = await prisma.user.create({
    data: {
      id: `refund-customer-user-${tag}`,
      email: `refund-customer-${tag}@example.test`,
      name: "Refund Test Customer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  const customer = await prisma.customer.create({
    data: {
      id: `refund-customer-${tag}`,
      userId: user.id,
      referralCode: `F${tag.slice(0, 18)}`,
    },
  });
  const address = await prisma.serviceAddress.create({
    data: {
      id: `refund-address-${tag}`,
      customerId: customer.id,
      line1: "1 Refund Test Way",
      city: "Greeley",
      zip: "80631",
    },
  });
  const agreement = await prisma.rentalAgreement.create({
    data: {
      id: `refund-agreement-${tag}`,
      customerId: customer.id,
      serviceAddressId: address.id,
      status: "ACTIVE",
      depositCents: 5_000,
    },
  });
  const deposit = await prisma.deposit.create({
    data: {
      id: `refund-deposit-${tag}`,
      agreementId: agreement.id,
      amountCents: 5_000,
      refundable: true,
    },
  });
  const invoice = await prisma.invoice.create({
    data: {
      id: `refund-invoice-${tag}`,
      customerId: customer.id,
      agreementId: agreement.id,
      status: "PAID",
      subtotalCents: 10_000,
      amountDueCents: 10_000,
      amountPaidCents: 10_000,
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
      id: `refund-receipt-${tag}`,
      customerId: customer.id,
      source,
      amountCents: 10_000,
      method: source === "STRIPE" ? "card" : "cash",
      stripeChargeId: source === "STRIPE" ? `ch_refund_${tag}` : null,
      receivedOn: new Date("2026-10-02T18:00:00Z"),
      payments: {
        create: {
          invoiceId: invoice.id,
          amountCents: 10_000,
          method: source === "STRIPE" ? "card" : "cash",
          status: "succeeded",
        },
      },
    },
  });

  const fixture = {
    userId: user.id,
    customerId: customer.id,
    addressId: address.id,
    agreementId: agreement.id,
    depositId: deposit.id,
    invoiceId: invoice.id,
    receiptId: receipt.id,
  };
  activeFixtures.push(fixture);
  return fixture;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const refunds = await prisma.refund.findMany({
    where: { invoiceId: fixture.invoiceId },
    select: { id: true },
  });
  const refundIds = refunds.map((refund) => refund.id);
  await prisma.providerOperation.deleteMany({
    where: {
      OR: [
        { subjectType: "Deposit", subjectId: fixture.depositId },
        ...(refundIds.length
          ? [{ subjectType: "Refund", subjectId: { in: refundIds } }]
          : []),
      ],
    },
  });
  if (refundIds.length) {
    await prisma.customerCredit.deleteMany({
      where: { sourceType: "REFUND_TO_CREDIT", sourceId: { in: refundIds } },
    });
  }
  await prisma.refund.deleteMany({ where: { invoiceId: fixture.invoiceId } });
  await prisma.payment.deleteMany({ where: { invoiceId: fixture.invoiceId } });
  await prisma.deposit.deleteMany({ where: { id: fixture.depositId } });
  await prisma.receipt.deleteMany({ where: { customerId: fixture.customerId } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: fixture.invoiceId } });
  await prisma.invoice.deleteMany({ where: { id: fixture.invoiceId } });
  await prisma.rentalAgreement.deleteMany({ where: { id: fixture.agreementId } });
  if (fixture.estimateId) {
    await prisma.estimate.deleteMany({ where: { id: fixture.estimateId } });
  }
  await prisma.serviceAddress.deleteMany({ where: { id: fixture.addressId } });
  await prisma.customer.deleteMany({ where: { id: fixture.customerId } });
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
}

describe.skipIf(!enabled)("refund decisions in disposable Postgres", () => {
  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        {
          id: ownerId,
          email: `refund-owner-${runTag}@example.test`,
          name: "Refund Owner",
          role: "OWNER",
          emailVerified: true,
        },
        {
          id: staffId,
          email: `refund-staff-${runTag}@example.test`,
          name: "Refund Staff",
          role: "STAFF",
          emailVerified: true,
        },
      ],
    });
  });

  beforeEach(() => {
    mocks.refundCreate.mockReset().mockResolvedValue({ id: `re_${randomUUID()}` });
    mocks.checkoutSessionsList.mockReset().mockResolvedValue({ data: [] });
    mocks.paymentIntentRetrieve.mockReset();
  });

  afterEach(async () => {
    while (activeFixtures.length) {
      await cleanupFixture(activeFixtures.pop()!);
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({
      where: { userId: { in: [ownerId, staffId] } },
    });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("requires a reason for a partial deposit refund and rejects over-refunds", async () => {
    const fixture = await createFixture();

    await expect(
      decideDepositRefund(ownerId, {
        depositId: fixture.depositId,
        refundCents: 4_000,
      }),
    ).rejects.toThrow(/deduction reason/i);
    await expect(
      decideDepositRefund(ownerId, {
        depositId: fixture.depositId,
        refundCents: 5_001,
        deductionReason: "Impossible over-refund",
      }),
    ).rejects.toThrow(/cannot exceed/i);

    const deposit = await prisma.deposit.findUniqueOrThrow({
      where: { id: fixture.depositId },
    });
    expect(deposit.refundedAt).toBeNull();
    expect(deposit.refundedAmountCents).toBeNull();
  });

  it("rejects a second deposit refund decision", async () => {
    const fixture = await createFixture();
    await decideDepositRefund(ownerId, {
      depositId: fixture.depositId,
      refundCents: 5_000,
    });

    await expect(
      decideDepositRefund(ownerId, {
        depositId: fixture.depositId,
        refundCents: 5_000,
      }),
    ).rejects.toThrow(/already has a refund decision/i);
  });

  it("persists an UNKNOWN Stripe outcome without losing the local deposit decision", async () => {
    const fixture = await createFixture("STRIPE");
    mocks.refundCreate.mockRejectedValue({
      type: "StripeConnectionError",
      message: "simulated connection loss",
    });

    const result = await decideDepositRefund(ownerId, {
      depositId: fixture.depositId,
      refundCents: 4_000,
      deductionReason: "Documented damage deduction",
      disputeNotes: "Customer disputed the deduction; owner reviewed photos.",
    });

    expect(result.providerOpId).not.toBeNull();
    const deposit = await prisma.deposit.findUniqueOrThrow({
      where: { id: fixture.depositId },
    });
    expect(deposit.refundedAt).not.toBeNull();
    expect(deposit.refundedAmountCents).toBe(4_000);
    expect(deposit.deductionReason).toBe("Documented damage deduction");
    expect(deposit.stripeRefundId).toBeNull();

    const operation = await prisma.providerOperation.findUniqueOrThrow({
      where: { idempotencyKey: `deposit-refund-${fixture.depositId}` },
    });
    expect(operation.status).toBe("UNKNOWN");
  });

  it("recovers the Stripe charge for a prepaid estimate deposit after conversion", async () => {
    const fixture = await createFixture("STRIPE");
    const estimateId = `refund-estimate-${randomUUID()}`;
    fixture.estimateId = estimateId;
    await prisma.estimate.create({
      data: {
        id: estimateId,
        customerId: fixture.customerId,
        status: "CONVERTED",
        title: "Legacy prepaid deposit",
        depositCents: 5_000,
        depositPaidAt: new Date("2026-10-01T18:00:00Z"),
        createdByUserId: ownerId,
      },
    });
    await prisma.customer.update({
      where: { id: fixture.customerId },
      data: { stripeCustomerId: "cus_estimate_refund_test" },
    });
    await prisma.rentalAgreement.update({
      where: { id: fixture.agreementId },
      data: { sourceEstimateId: estimateId },
    });
    await prisma.invoice.update({
      where: { id: fixture.invoiceId },
      data: { agreementId: null },
    });
    await prisma.receipt.update({
      where: { id: fixture.receiptId },
      data: { stripeChargeId: "ch_estimate_deposit" },
    });
    await prisma.payment.updateMany({
      where: { invoiceId: fixture.invoiceId },
      data: { stripePaymentIntentId: "pi_estimate_deposit" },
    });
    mocks.checkoutSessionsList.mockResolvedValue({
      data: [
        {
          id: "cs_estimate_deposit",
          metadata: { estimateId },
          payment_status: "paid",
          payment_intent: "pi_estimate_deposit",
        },
      ],
    });
    mocks.paymentIntentRetrieve.mockResolvedValue({
      id: "pi_estimate_deposit",
      latest_charge: "ch_estimate_deposit",
    });
    mocks.refundCreate.mockResolvedValue({ id: "re_estimate_deposit" });

    await decideDepositRefund(ownerId, {
      depositId: fixture.depositId,
      refundCents: 5_000,
    });

    expect(mocks.checkoutSessionsList).toHaveBeenCalledWith({
      customer: "cus_estimate_refund_test",
      limit: 100,
    });
    expect(mocks.refundCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        charge: "ch_estimate_deposit",
        amount: 5_000,
      }),
      expect.any(Object),
    );
    expect(
      (await prisma.deposit.findUniqueOrThrow({ where: { id: fixture.depositId } })).stripeRefundId,
    ).toBe("re_estimate_deposit");
  });

  it("turns an invoice refund into exactly one local credit when requested", async () => {
    const fixture = await createFixture();

    const result = await issueInvoiceRefund(ownerId, {
      invoiceId: fixture.invoiceId,
      amountCents: 2_500,
      reason: "GOODWILL",
      notes: "Keep as account credit",
      toCredit: true,
    });

    expect(result.providerOpId).toBeNull();
    expect(mocks.refundCreate).not.toHaveBeenCalled();
    const credits = await prisma.customerCredit.findMany({
      where: { sourceType: "REFUND_TO_CREDIT", sourceId: result.refundId },
    });
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      customerId: fixture.customerId,
      amountCents: 2_500,
      remainingCents: 2_500,
      side: null,
    });
  });

  it("uses the next Stripe charge after an earlier partial refund reserved capacity", async () => {
    const fixture = await createFixture("STRIPE");
    await prisma.payment.deleteMany({ where: { invoiceId: fixture.invoiceId } });
    await prisma.receipt.deleteMany({ where: { id: fixture.receiptId } });
    const chargeOne = `ch_one_${randomUUID().replaceAll("-", "")}`;
    const chargeTwo = `ch_two_${randomUUID().replaceAll("-", "")}`;
    await prisma.receipt.create({
      data: {
        customerId: fixture.customerId,
        source: "STRIPE",
        amountCents: 5_000,
        method: "card",
        stripeChargeId: chargeOne,
        receivedOn: new Date("2026-10-01T18:00:00Z"),
        payments: {
          create: {
            invoiceId: fixture.invoiceId,
            amountCents: 5_000,
            method: "card",
            status: "succeeded",
          },
        },
      },
    });
    await prisma.receipt.create({
      data: {
        customerId: fixture.customerId,
        source: "STRIPE",
        amountCents: 5_000,
        method: "card",
        stripeChargeId: chargeTwo,
        receivedOn: new Date("2026-10-02T18:00:00Z"),
        payments: {
          create: {
            invoiceId: fixture.invoiceId,
            amountCents: 5_000,
            method: "card",
            status: "succeeded",
          },
        },
      },
    });
    mocks.refundCreate
      .mockResolvedValueOnce({ id: "re_first" })
      .mockResolvedValueOnce({ id: "re_second" });

    await issueInvoiceRefund(ownerId, {
      invoiceId: fixture.invoiceId,
      amountCents: 3_000,
      reason: "GOODWILL",
    });
    await issueInvoiceRefund(ownerId, {
      invoiceId: fixture.invoiceId,
      amountCents: 3_000,
      reason: "GOODWILL",
    });

    expect(mocks.refundCreate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ charge: chargeOne, amount: 3_000 }),
      expect.any(Object),
    );
    expect(mocks.refundCreate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ charge: chargeTwo, amount: 3_000 }),
      expect.any(Object),
    );
    const operations = await prisma.providerOperation.findMany({
      where: { kind: "REFUND_CREATE", subjectType: "Refund" },
      select: { idempotencyKey: true },
    });
    expect(operations.some((operation) => operation.idempotencyKey.endsWith(chargeOne))).toBe(true);
    expect(operations.some((operation) => operation.idempotencyKey.endsWith(chargeTwo))).toBe(true);
  });

  it("rejects refunds that exceed paid amount remaining after earlier refunds", async () => {
    const fixture = await createFixture();
    await issueInvoiceRefund(ownerId, {
      invoiceId: fixture.invoiceId,
      amountCents: 8_000,
      reason: "GOODWILL",
      toCredit: true,
    });

    await expect(
      issueInvoiceRefund(ownerId, {
        invoiceId: fixture.invoiceId,
        amountCents: 2_001,
        reason: "GOODWILL",
        toCredit: true,
      }),
    ).rejects.toThrow(/eligible for refund/i);
  });

  it("rejects STAFF before any refund mutation", async () => {
    const fixture = await createFixture();

    await expect(
      decideDepositRefund(staffId, {
        depositId: fixture.depositId,
        refundCents: 5_000,
      }),
    ).rejects.toThrow(/no longer has access/i);
    await expect(
      issueInvoiceRefund(staffId, {
        invoiceId: fixture.invoiceId,
        amountCents: 1_000,
        reason: "OTHER",
      }),
    ).rejects.toThrow(/no longer has access/i);

    expect(
      await prisma.refund.count({ where: { invoiceId: fixture.invoiceId } }),
    ).toBe(0);
    expect(
      (await prisma.deposit.findUniqueOrThrow({ where: { id: fixture.depositId } })).refundedAt,
    ).toBeNull();
  });
});