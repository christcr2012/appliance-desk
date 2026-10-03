import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBalanceTransaction: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    customers: {
      createBalanceTransaction: (...args: unknown[]) =>
        mocks.createBalanceTransaction(...args),
    },
  }),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: (...args: unknown[]) => mocks.sendEmail(...args),
}));

import { prisma } from "@/lib/prisma";
import { applyCreditToInvoice } from "@/domains/billing/ledger";
import {
  rewardReferralOnFirstPaidInvoice,
  settleReferralCredits,
} from "@/domains/referrals";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

type Fixture = {
  referralId: string;
  referrerUserId: string;
  referredUserId: string;
  referrerCustomerId: string;
  referredCustomerId: string;
};

type BalanceTransactionParams = {
  metadata?: { creditId?: string };
};

const fixtures: Fixture[] = [];

async function createFixture(options?: {
  referrerStripe?: boolean;
  referredStripe?: boolean;
}): Promise<Fixture> {
  const tag = randomUUID().replaceAll("-", "");
  const referrerUser = await prisma.user.create({
    data: {
      id: `referrer-user-${tag}`,
      email: `referrer-${tag}@example.test`,
      name: "Referral Referrer",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  const referredUser = await prisma.user.create({
    data: {
      id: `referred-user-${tag}`,
      email: `referred-${tag}@example.test`,
      name: "Referral Referred",
      role: "CUSTOMER",
      emailVerified: true,
    },
  });
  const referrer = await prisma.customer.create({
    data: {
      id: `referrer-customer-${tag}`,
      userId: referrerUser.id,
      referralCode: `R${tag.slice(0, 18)}`,
      stripeCustomerId:
        options?.referrerStripe === false ? null : `cus_referrer_${tag}`,
    },
  });
  const referred = await prisma.customer.create({
    data: {
      id: `referred-customer-${tag}`,
      userId: referredUser.id,
      referralCode: `D${tag.slice(0, 18)}`,
      stripeCustomerId:
        options?.referredStripe === false ? null : `cus_referred_${tag}`,
    },
  });
  const referral = await prisma.referral.create({
    data: {
      referrerCustomerId: referrer.id,
      referredCustomerId: referred.id,
    },
  });

  const fixture = {
    referralId: referral.id,
    referrerUserId: referrerUser.id,
    referredUserId: referredUser.id,
    referrerCustomerId: referrer.id,
    referredCustomerId: referred.id,
  };
  fixtures.push(fixture);
  return fixture;
}

async function cleanupFixture(fixture: Fixture): Promise<void> {
  const credits = await prisma.customerCredit.findMany({
    where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
    select: { id: true },
  });
  if (credits.length > 0) {
    await prisma.providerOperation.deleteMany({
      where: {
        subjectType: "CustomerCredit",
        subjectId: { in: credits.map((credit) => credit.id) },
      },
    });
  }
  await prisma.customerCredit.deleteMany({
    where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
  });
  await prisma.referral.deleteMany({ where: { id: fixture.referralId } });
  await prisma.customer.deleteMany({
    where: {
      id: { in: [fixture.referrerCustomerId, fixture.referredCustomerId] },
    },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [fixture.referrerUserId, fixture.referredUserId] } },
  });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe.skipIf(!enabled)("referral reward ledger in disposable Postgres", () => {
  beforeEach(async () => {
    mocks.createBalanceTransaction.mockReset();
    mocks.sendEmail.mockReset().mockResolvedValue({ sent: true });
    const settings = await prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { id: true },
    });
    if (!settings) {
      await prisma.businessSettings.create({ data: { id: "singleton" } });
    }
  });

  afterAll(async () => {
    for (const fixture of fixtures.reverse()) {
      await cleanupFixture(fixture);
    }
  });

  it("lets exactly one of two concurrent first-paid claims mint the two local credits", async () => {
    const fixture = await createFixture();
    const results = await Promise.all([
      prisma.$transaction((tx) =>
        rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
      ),
      prisma.$transaction((tx) =>
        rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
      ),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
    const credits = await prisma.customerCredit.findMany({
      where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
      orderBy: { side: "asc" },
    });
    expect(credits).toHaveLength(2);
    expect(new Set(credits.map((credit) => credit.side))).toEqual(
      new Set(["referrer", "referred"]),
    );
    expect(credits.every((credit) => credit.remainingCents === credit.amountCents)).toBe(true);

    const referral = await prisma.referral.findUniqueOrThrow({
      where: { id: fixture.referralId },
    });
    expect(referral.status).toBe("REWARDING");

    await expect(
      prisma.$transaction((tx) =>
        rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
      ),
    ).resolves.toBeNull();
    expect(
      await prisma.customerCredit.count({
        where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
      }),
    ).toBe(2);
  });

  it("settles both sides through durable provider operations and marks the referral REWARDED", async () => {
    const fixture = await createFixture();
    await prisma.$transaction((tx) =>
      rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
    );
    let providerCounter = 0;
    mocks.createBalanceTransaction.mockImplementation(async () => ({
      id: `cbtxn_${++providerCounter}`,
    }));

    await settleReferralCredits(fixture.referralId);

    expect(mocks.createBalanceTransaction).toHaveBeenCalledTimes(2);
    const credits = await prisma.customerCredit.findMany({
      where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
    });
    expect(credits.every((credit) => credit.remainingCents === 0)).toBe(true);
    expect(credits.every((credit) => credit.appliedViaStripeAt !== null)).toBe(true);

    const operations = await prisma.providerOperation.findMany({
      where: {
        subjectType: "CustomerCredit",
        subjectId: { in: credits.map((credit) => credit.id) },
      },
    });
    expect(operations).toHaveLength(2);
    expect(operations.every((operation) => operation.status === "SUCCEEDED")).toBe(true);

    const referral = await prisma.referral.findUniqueOrThrow({
      where: { id: fixture.referralId },
    });
    expect(referral.status).toBe("REWARDED");
    expect(mocks.sendEmail).toHaveBeenCalledTimes(2);

    await settleReferralCredits(fixture.referralId);
    expect(mocks.createBalanceTransaction).toHaveBeenCalledTimes(2);
  });

  it("rejects local spending while a Stripe balance-credit request is in flight", async () => {
    const fixture = await createFixture();
    await prisma.$transaction((tx) =>
      rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
    );
    const credit = await prisma.customerCredit.findFirstOrThrow({
      where: {
        sourceType: "REFERRAL",
        sourceId: fixture.referralId,
        customerId: fixture.referrerCustomerId,
      },
    });
    const invoiceId = `referral-race-invoice-${randomUUID()}`;
    await prisma.invoice.create({
      data: {
        id: invoiceId,
        customerId: fixture.referrerCustomerId,
        status: "OPEN",
        subtotalCents: credit.amountCents,
        amountDueCents: credit.amountCents,
        amountPaidCents: 0,
      },
    });

    const providerStarted = deferred();
    const allowProvider = deferred();
    mocks.createBalanceTransaction.mockImplementation(
      async (_customerId: unknown, params: BalanceTransactionParams) => {
        if (params.metadata?.creditId === credit.id) {
          providerStarted.resolve();
          await allowProvider.promise;
        }
        return { id: `cbtxn_${params.metadata?.creditId ?? randomUUID()}` };
      },
    );

    const settlement = settleReferralCredits(fixture.referralId);
    await providerStarted.promise;

    await expect(
      prisma.$transaction((tx) =>
        applyCreditToInvoice(tx, {
          creditId: credit.id,
          invoiceId,
          amountCents: credit.amountCents,
          appliedByUserId: "owner-race-test",
        }),
      ),
    ).rejects.toThrow(/reserved for Stripe settlement/i);

    allowProvider.resolve();
    await settlement;

    expect(
      await prisma.creditApplication.count({ where: { creditId: credit.id } }),
    ).toBe(0);
    await prisma.invoiceLineItem.deleteMany({ where: { invoiceId } });
    await prisma.invoice.delete({ where: { id: invoiceId } });
  });

  it("fails settlement so the webhook retries when Stripe delivery fails", async () => {
    const fixture = await createFixture();
    await prisma.$transaction((tx) =>
      rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
    );
    mocks.createBalanceTransaction.mockRejectedValueOnce(new Error("provider rejected test credit"));

    await expect(settleReferralCredits(fixture.referralId)).rejects.toThrow(/must retry/i);

    const operationsAfterFailure = await prisma.providerOperation.findMany({
      where: {
        subjectType: "CustomerCredit",
        subjectId: {
          in: (
            await prisma.customerCredit.findMany({
              where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
              select: { id: true },
            })
          ).map((credit) => credit.id),
        },
      },
    });
    expect(operationsAfterFailure.some((operation) => operation.status === "FAILED")).toBe(true);
    expect(
      (await prisma.referral.findUniqueOrThrow({ where: { id: fixture.referralId } })).status,
    ).toBe("REWARDING");

    mocks.createBalanceTransaction.mockResolvedValue({ id: `cbtxn_retry_${randomUUID()}` });
    await settleReferralCredits(fixture.referralId);
    expect(
      (await prisma.referral.findUniqueOrThrow({ where: { id: fixture.referralId } })).status,
    ).toBe("REWARDED");
  });

  it("keeps a no-Stripe-customer side local while completing the referral after the other side settles", async () => {
    const fixture = await createFixture({ referrerStripe: false });
    await prisma.$transaction((tx) =>
      rewardReferralOnFirstPaidInvoice(tx, fixture.referredCustomerId),
    );
    mocks.createBalanceTransaction.mockResolvedValue({ id: "cbtxn_referred_only" });

    await settleReferralCredits(fixture.referralId);

    expect(mocks.createBalanceTransaction).toHaveBeenCalledTimes(1);
    const credits = await prisma.customerCredit.findMany({
      where: { sourceType: "REFERRAL", sourceId: fixture.referralId },
      include: { customer: { select: { stripeCustomerId: true } } },
    });
    const localOnly = credits.find((credit) => credit.customer.stripeCustomerId === null);
    const providerApplied = credits.find((credit) => credit.customer.stripeCustomerId !== null);
    expect(localOnly?.remainingCents).toBe(localOnly?.amountCents);
    expect(localOnly?.appliedViaStripeAt).toBeNull();
    expect(providerApplied?.remainingCents).toBe(0);
    expect(providerApplied?.appliedViaStripeAt).not.toBeNull();

    expect(
      (await prisma.referral.findUniqueOrThrow({ where: { id: fixture.referralId } })).status,
    ).toBe("REWARDED");
  });
});
