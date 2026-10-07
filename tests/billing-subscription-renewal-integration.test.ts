import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A simulated Stripe: no network, but it honours idempotency keys the way the
// real API does (same key -> same object back), so "Stripe created exactly one
// subscription" is measured on the simulated provider, not just on call counts.
const stripeSim = vi.hoisted(() => {
  const state = {
    clientRequests: 0,
    subscriptionCreateCalls: [] as Array<{ params: Record<string, unknown>; key: string }>,
    subscriptionsByKey: new Map<string, { id: string }>(),
    productsByKey: new Map<string, { id: string }>(),
    productCreateCalls: 0,
    otherCalls: [] as string[],
    seq: 0,
  };
  const delay = () => new Promise((resolve) => setTimeout(resolve, 75));
  const client = {
    subscriptions: {
      create: async (params: Record<string, unknown>, options: { idempotencyKey: string }) => {
        state.subscriptionCreateCalls.push({ params, key: options.idempotencyKey });
        await delay();
        const existing = state.subscriptionsByKey.get(options.idempotencyKey);
        if (existing) return existing;
        const created = { id: `sub_sim_${(state.seq += 1)}_${options.idempotencyKey.slice(-8)}` };
        state.subscriptionsByKey.set(options.idempotencyKey, created);
        return created;
      },
    },
    products: {
      create: async (_params: Record<string, unknown>, options: { idempotencyKey: string }) => {
        state.productCreateCalls += 1;
        await delay();
        const existing = state.productsByKey.get(options.idempotencyKey);
        if (existing) return existing;
        const created = { id: `prod_sim_${(state.seq += 1)}` };
        state.productsByKey.set(options.idempotencyKey, created);
        return created;
      },
    },
    taxRates: {
      list: async () => {
        state.otherCalls.push("taxRates.list");
        return { data: [], has_more: false };
      },
      create: async () => {
        state.otherCalls.push("taxRates.create");
        return { id: "txr_sim" };
      },
    },
    customers: {
      create: async () => {
        state.otherCalls.push("customers.create");
        return { id: "cus_sim_unexpected" };
      },
    },
    checkout: {
      sessions: {
        create: async () => {
          state.otherCalls.push("checkout.sessions.create");
          return { url: "https://stripe.invalid/session" };
        },
      },
    },
  };
  const reset = () => {
    state.clientRequests = 0;
    state.subscriptionCreateCalls = [];
    state.subscriptionsByKey = new Map();
    state.productsByKey = new Map();
    state.productCreateCalls = 0;
    state.otherCalls = [];
    state.seq = 0;
  };
  return { state, client, reset };
});

vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => {
    stripeSim.state.clientRequests += 1;
    return stripeSim.client;
  },
}));
vi.mock("@/domains/referrals", () => ({ rewardReferralIfEligible: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { startRecurringBillingForAgreement } from "@/domains/billing/checkout";
import { renewAgreement } from "@/domains/agreements/term";
import { seedTaxReadyContext } from "./helpers/tax-ready";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("subscription start and renewal against disposable Postgres with a simulated Stripe", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `subren-owner-${tag}`;
  const customerUserId = `subren-user-${tag}`;
  const customerId = `subren-customer-${tag}`;
  const addressId = `subren-address-${tag}`;
  const stripeCustomerId = `cus_sim_${tag}`;
  const paymentMethodId = `pm_sim_${tag}`;
  const deliveredOn = new Date("2026-10-01T06:00:00Z");
  const agreementIds: string[] = [];
  const opKeys: string[] = [];
  let taxReady: Awaited<ReturnType<typeof seedTaxReadyContext>> | null = null;

  async function newAgreement(overrides: Record<string, unknown> = {}) {
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: null,
        startDate: new Date("2026-10-08T19:00:00Z"),
        nextBillingDate: new Date("2026-11-08T19:00:00Z"),
        firstDeliveredOn: deliveredOn,
        depositCents: 0,
        damageWaiverCents: 0,
        taxRateMilliPercent: 0,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 4000, listPriceCents: 4000 }] },
        ...overrides,
      },
    });
    agreementIds.push(agreement.id);
    opKeys.push(`subscription-create-${agreement.id}`);
    return agreement;
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, name: "SubRen Owner", role: "OWNER", emailVerified: true },
        { id: customerUserId, email: `${tag}-cust@example.test`, name: "SubRen Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({
      data: {
        id: customerId,
        userId: customerUserId,
        referralCode: `S${tag.slice(0, 18)}`,
        stripeCustomerId,
        stripeDefaultPaymentMethodId: paymentMethodId,
      },
    });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "2 Test St", city: "Greeley", zip: "80631" },
    });
    taxReady = await seedTaxReadyContext(addressId);
  });

  beforeEach(() => {
    stripeSim.reset();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    const ids = agreementIds;
    await prisma.providerOperation.deleteMany({
      where: { OR: [{ idempotencyKey: { in: opKeys } }, { subjectId: { in: ids } }] },
    });
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await taxReady?.cleanup();
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, customerUserId] } } });
  });

  describe("startRecurringBillingForAgreement", () => {
    it("five concurrent calls create exactly one Stripe subscription, one stored id and one SUBSCRIPTION_CREATE operation", async () => {
      const agreement = await newAgreement();
      const key = `subscription-create-${agreement.id}`;

      // The function reports lost races by recording a blocker, never by throwing.
      const attempts = await Promise.allSettled(
        Array.from({ length: 5 }, () => startRecurringBillingForAgreement(agreement.id)),
      );
      expect(attempts.filter((a) => a.status === "rejected")).toEqual([]);

      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(1);
      expect(stripeSim.state.subscriptionCreateCalls[0]!.key).toBe(key);
      expect(stripeSim.state.subscriptionsByKey.size).toBe(1);
      expect(stripeSim.state.otherCalls).toEqual(["taxRates.create"]);

      const [{ params }] = stripeSim.state.subscriptionCreateCalls;
      expect(params).toMatchObject({
        customer: stripeCustomerId,
        default_payment_method: paymentMethodId,
        metadata: { agreementId: agreement.id, firstDeliveredOn: deliveredOn.toISOString() },
      });
      // IN-28: Stripe starts at Colorado midnight of the real delivery day.
      expect(params).toHaveProperty("backdate_start_date");
      expect(params).toHaveProperty("billing_mode", { type: "flexible" });
      expect(params).not.toHaveProperty("billing_cycle_anchor");
      expect(params).not.toHaveProperty("billing_cycle_anchor_config");
      const items = params.items as Array<{ price_data: { unit_amount: number; currency: string } }>;
      expect(items).toHaveLength(1);
      expect(items[0]!.price_data).toMatchObject({ unit_amount: 4000, currency: "usd" });
      expect(params).not.toHaveProperty("cancel_at");

      const createdId = [...stripeSim.state.subscriptionsByKey.values()][0]!.id;
      const saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.stripeSubscriptionId).toBe(createdId);
      expect(saved.billingStartedAt?.getTime()).toBe(deliveredOn.getTime());
      expect(saved.billingBlockedReason).toBeNull();

      const ops = await prisma.providerOperation.findMany({
        where: { subjectType: "RentalAgreement", subjectId: agreement.id },
      });
      expect(ops).toHaveLength(1);
      expect(ops[0]).toMatchObject({
        kind: "SUBSCRIPTION_CREATE",
        idempotencyKey: key,
        status: "SUCCEEDED",
        providerObjectId: createdId,
        attempts: 1,
      });

      // A later call is a pure local no-op: nothing more goes to Stripe.
      const callsBefore = stripeSim.state.clientRequests;
      await startRecurringBillingForAgreement(agreement.id);
      expect(stripeSim.state.clientRequests).toBe(callsBefore);
      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(1);
      expect(await prisma.providerOperation.count({ where: { subjectId: agreement.id } })).toBe(1);
    });

    it("heals after Stripe succeeded but the local write failed, without a second Stripe subscription", async () => {
      const agreement = await newAgreement();
      const key = `subscription-create-${agreement.id}`;

      // Fail the first local transaction after Stripe has created the subscription:
      // this targets subscription finalization semantically even when tax-rate
      // preparation adds its own transactions before the provider call.
      const realTransaction = prisma.$transaction.bind(prisma) as (...args: unknown[]) => Promise<unknown>;
      let failedFinalization = false;
      vi.spyOn(prisma, "$transaction").mockImplementation(((...args: unknown[]) => {
        if (!failedFinalization && stripeSim.state.subscriptionCreateCalls.length === 1) {
          failedFinalization = true;
          return Promise.reject(new Error("simulated local database failure"));
        }
        return realTransaction(...args);
      }) as never);

      await expect(startRecurringBillingForAgreement(agreement.id)).rejects.toThrow(/simulated local database failure/);
      vi.restoreAllMocks();

      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(1);
      expect(stripeSim.state.subscriptionsByKey.size).toBe(1);
      const stripeSideId = [...stripeSim.state.subscriptionsByKey.values()][0]!.id;

      // Local state: no id stored, the claim is still PENDING.
      let saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.stripeSubscriptionId).toBeNull();
      let op = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(op).toMatchObject({ status: "PENDING", attempts: 1, providerObjectId: null });

      // An immediate retry is refused by the fresh claim: it does not touch Stripe.
      await startRecurringBillingForAgreement(agreement.id);
      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(1);
      saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.stripeSubscriptionId).toBeNull();
      expect(saved.billingBlockedReason).toMatch(/already being started/i);

      // Once the stale-claim window passes (120s default), the next call takes the
      // claim over and repeats the Stripe request with the SAME idempotency key;
      // Stripe returns the subscription it already made rather than a second one.
      await prisma.$executeRaw`
        UPDATE "ProviderOperation"
        SET "updatedAt" = now() - interval '10 minutes'
        WHERE "idempotencyKey" = ${key}
      `;
      await startRecurringBillingForAgreement(agreement.id);

      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(2);
      expect(stripeSim.state.subscriptionCreateCalls.map((c) => c.key)).toEqual([key, key]);
      expect(stripeSim.state.subscriptionsByKey.size).toBe(1);

      saved = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: agreement.id } });
      expect(saved.stripeSubscriptionId).toBe(stripeSideId);
      expect(saved.billingStartedAt?.getTime()).toBe(deliveredOn.getTime());
      expect(saved.billingBlockedReason).toBeNull();
      op = await prisma.providerOperation.findUniqueOrThrow({ where: { idempotencyKey: key } });
      expect(op).toMatchObject({ status: "SUCCEEDED", attempts: 2, providerObjectId: stripeSideId });
      expect(await prisma.providerOperation.count({ where: { subjectId: agreement.id } })).toBe(1);

      // Fully healed: further calls never reach Stripe again.
      await startRecurringBillingForAgreement(agreement.id);
      expect(stripeSim.state.subscriptionCreateCalls).toHaveLength(2);
    });
  });

  describe("renewAgreement", () => {
    it("drafts a no-deposit linked renewal, sends nothing to Stripe, leaves the old agreement untouched, and refuses a second renewal", async () => {
      const old = await newAgreement({
        termMonths: 12,
        endDate: new Date("2027-11-08T06:59:59Z"),
        depositCents: 5000,
        damageWaiverCents: 300,
        taxRateMilliPercent: 7300,
        stripeSubscriptionId: `sub_sim_existing_${tag}`,
        billingStartedAt: deliveredOn,
      });
      await prisma.deposit.create({ data: { agreementId: old.id, amountCents: 5000 } });

      const before = await prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: old.id },
        include: { lines: true },
      });
      const depositsBefore = await prisma.deposit.count({ where: { agreement: { customerId } } });
      const opsBefore = await prisma.providerOperation.count({ where: { subjectId: old.id } });

      const { newAgreementId } = await renewAgreement(ownerId, old.id, {
        termMonths: 12,
        startOn: new Date("2027-11-08T19:00:00Z"),
      });
      agreementIds.push(newAgreementId);

      const renewal = await prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: newAgreementId },
        include: { lines: true },
      });
      expect(renewal).toMatchObject({
        status: "DRAFT",
        renewedFromAgreementId: old.id,
        customerId,
        depositCents: 0,
        damageWaiverCents: 300,
        taxRateMilliPercent: 7300,
        paidInFullInAdvance: false,
        stripeSubscriptionId: null,
        billingStartedAt: null,
      });
      expect(renewal.lines.map((l) => [l.label, l.monthlyPriceCents])).toEqual([["Washer", 4000]]);

      // No new deposit and no deposit invoice line anywhere for the renewal.
      expect(await prisma.deposit.count({ where: { agreementId: newAgreementId } })).toBe(0);
      expect(await prisma.deposit.count({ where: { agreement: { customerId } } })).toBe(depositsBefore);
      expect(await prisma.invoice.count({ where: { agreementId: newAgreementId } })).toBe(0);
      expect(
        await prisma.invoiceLineItem.count({
          where: { kind: "DEPOSIT", invoice: { agreementId: newAgreementId } },
        }),
      ).toBe(0);

      // Nothing provider-side: no ProviderOperation rows, and Stripe was never even constructed.
      expect(await prisma.providerOperation.count({ where: { subjectId: { in: [old.id, newAgreementId] } } })).toBe(opsBefore);
      expect(opsBefore).toBe(0);
      expect(stripeSim.state.clientRequests).toBe(0);
      expect(stripeSim.state.subscriptionCreateCalls).toEqual([]);
      expect(stripeSim.state.productCreateCalls).toBe(0);
      expect(stripeSim.state.otherCalls).toEqual([]);

      // Old agreement is byte-for-byte what it was: still ACTIVE, same subscription, same deposit.
      const after = await prisma.rentalAgreement.findUniqueOrThrow({
        where: { id: old.id },
        include: { lines: true },
      });
      expect(after).toEqual(before);
      expect(after.status).toBe("ACTIVE");
      expect(after.stripeSubscriptionId).toBe(`sub_sim_existing_${tag}`);
      expect(after.depositCents).toBe(5000);

      // A second renewal attempt is rejected and creates nothing.
      await expect(
        renewAgreement(ownerId, old.id, { termMonths: 12, startOn: new Date("2027-11-08T19:00:00Z") }),
      ).rejects.toThrow(/already has a renewal/);
      expect(await prisma.rentalAgreement.count({ where: { renewedFromAgreementId: old.id } })).toBe(1);
      expect(stripeSim.state.clientRequests).toBe(0);
      expect(await prisma.providerOperation.count({ where: { subjectId: { in: [old.id, newAgreementId] } } })).toBe(0);
    });
  });
});