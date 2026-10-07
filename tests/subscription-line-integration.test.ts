import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// A simulated Stripe subscription: no network, but the update call honours its idempotency key (the same key never
// applies twice) and can be told to fail, so "reduces exactly one subscription item, once" is measured on the
// simulated provider and not only on call counts.
const sim = vi.hoisted(() => {
  type Item = { id: string; price: { unit_amount: number; product: { id: string; metadata: { rentalLineId: string } } }; tax_rates: Array<{ id: string }> };
  const state = {
    subscriptions: new Map<string, { id: string; items: { data: Item[] } }>(),
    updateCalls: [] as Array<{ subscriptionId: string; params: { items: Array<Record<string, unknown>> }; key: string }>,
    cancelCalls: [] as Array<{ subscriptionId: string; key: string }>,
    seenKeys: new Set<string>(),
    failUpdates: false,
    failRefunds: false,
    refundCalls: [] as Array<{ charge: string; amount: number; key: string }>,
    balanceCalls: 0,
  };
  const client = {
    subscriptions: {
      retrieve: async (id: string) => {
        const found = state.subscriptions.get(id);
        if (!found) throw Object.assign(new Error("No such subscription"), { type: "StripeInvalidRequestError", code: "resource_missing" });
        return structuredClone(found);
      },
      update: async (id: string, params: { items: Array<Record<string, unknown>> }, options: { idempotencyKey: string }) => {
        state.updateCalls.push({ subscriptionId: id, params, key: options.idempotencyKey });
        if (state.failUpdates) throw Object.assign(new Error("Stripe refused the change"), { type: "StripeInvalidRequestError" });
        const found = state.subscriptions.get(id)!;
        if (state.seenKeys.has(options.idempotencyKey)) return structuredClone(found);
        state.seenKeys.add(options.idempotencyKey);
        for (const change of params.items) {
          if (change.deleted) {
            found.items.data = found.items.data.filter((item) => item.id !== change.id);
          } else {
            const target = found.items.data.find((item) => item.id === change.id)!;
            target.price.unit_amount = (change.price_data as { unit_amount: number }).unit_amount;
          }
        }
        return structuredClone(found);
      },
      cancel: async (id: string, _params: unknown, options: { idempotencyKey: string }) => {
        state.cancelCalls.push({ subscriptionId: id, key: options.idempotencyKey });
        state.subscriptions.delete(id);
        return { id };
      },
    },
    refunds: {
      create: async (params: { charge: string; amount: number }, options: { idempotencyKey: string }) => {
        state.refundCalls.push({ charge: params.charge, amount: params.amount, key: options.idempotencyKey });
        if (state.failRefunds) throw Object.assign(new Error("Stripe refund failed"), { type: "StripeAPIError" });
        return { id: `re_${state.refundCalls.length}_${options.idempotencyKey.slice(-6)}` };
      },
    },
    customers: {
      retrieve: async (id: string) => ({ id }),
      createBalanceTransaction: async () => {
        state.balanceCalls += 1;
        return { id: `cbtxn_${state.balanceCalls}` };
      },
    },
  };
  return { state, client };
});

vi.mock("@/lib/stripe", () => ({ getStripeClient: () => sim.client }));
vi.mock("@/domains/referrals", () => ({ rewardReferralIfEligible: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { completeJob } from "@/domains/jobs";
import { substituteWaitingItem } from "@/domains/jobs/substitution";
import { isSupersededAssignment, removeUndeliveredItem } from "@/domains/billing/pickup-billing-events";
import { retryLineReduction } from "@/domains/billing/subscription-line";
import { detectDrift } from "@/domains/billing/reconciliation";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe("never-delivered wording helper", () => {
  it("S7 never-delivered and replaced-only assignments are not priced items of their own", () => {
    expect(isSupersededAssignment("Never delivered")).toBe(true);
    expect(isSupersededAssignment("Replaced by LD-0042")).toBe(true);
    expect(isSupersededAssignment("Swapped for LD-0042")).toBe(true);
    expect(isSupersededAssignment("Returned")).toBe(false);
    expect(isSupersededAssignment(null)).toBe(false);
  });
});

describe.skipIf(!enabled)("a waiting item and the Stripe subscription (real Postgres, simulated Stripe)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `sl-owner-${tag}`;
  const userId = `sl-user-${tag}`;
  const customerId = `sl-customer-${tag}`;
  const addressId = `sl-address-${tag}`;
  const typeId = `sl-type-${tag}`;
  const otherTypeId = `sl-other-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];
  const jobIds: string[] = [];
  const lineIds: string[] = [];
  const invoiceIds: string[] = [];
  const receiptIds: string[] = [];
  const taxJurisdictionId = `sl-tax-jurisdiction-${tag}`;
  const taxRateVersionId = `sl-tax-rate-${tag}`;
  let counter = 0;

  type Scenario = Awaited<ReturnType<typeof build>>;

  /**
   * One agreement billing since 2026-09-01 with a Stripe subscription. Line A ($60) holds the washer and the dryer;
   * the dryer is waiting for delivery. Optional line B ($20) is a second item that is already out.
   */
  async function build(options: { lineB?: boolean; bothWaiting?: boolean; threeOnA?: boolean; laterList?: boolean } = {}) {
    const n = (counter += 1);
    const agreementId = `sl-agreement-${n}-${tag}`;
    const lineA = `sl-lineA-${n}-${tag}`;
    const lineB = `sl-lineB-${n}-${tag}`;
    const subscription = `sub_sl_${n}_${tag}`;
    const originalJobId = `sl-job0-${n}-${tag}`;
    const laterJobId = `sl-job1-${n}-${tag}`;
    const asset = (label: string) => `SL${n}${label}-${tag.slice(0, 6)}`;
    const ids = {
      washer: `sl-w-${n}-${tag}`,
      dryer: `sl-d-${n}-${tag}`,
      third: `sl-t-${n}-${tag}`,
      spare: `sl-s-${n}-${tag}`,
      other: `sl-x-${n}-${tag}`,
      filler: `sl-f-${n}-${tag}`,
    };
    agreementIds.push(agreementId);
    jobIds.push(originalJobId, laterJobId);
    lineIds.push(lineA, lineB);

    await prisma.rentalAgreement.create({
      data: {
        id: agreementId,
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        stripeSubscriptionId: subscription,
        billingStartedAt: businessDateFromKey("2026-09-01")!,
        lines: {
          create: [
            { id: lineA, label: "Washer/Dryer set", monthlyPriceCents: options.threeOnA ? 9000 : 6000, listPriceCents: 6000 },
            ...(options.lineB ? [{ id: lineB, label: "Freezer", monthlyPriceCents: 2000, listPriceCents: 2000 }] : []),
          ],
        },
      },
    });
    const make = async (id: string, label: string, status: "RENTED" | "RESERVED" | "AVAILABLE", typeFor = typeId) => {
      applianceIds.push(id);
      await prisma.appliance.create({ data: { id, assetNumber: asset(label), applianceTypeId: typeFor, status } });
    };
    await make(ids.washer, "W", options.bothWaiting ? "RESERVED" : "RENTED");
    await make(ids.dryer, "D", "RESERVED");
    if (options.threeOnA) await make(ids.third, "T", "RESERVED");
    await make(ids.spare, "S", "AVAILABLE");
    await make(ids.other, "X", "AVAILABLE", otherTypeId);
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineA, applianceId: ids.washer, assignedAt: businessDateFromKey("2026-09-01")! } });
    await prisma.applianceAssignment.create({ data: { rentalLineId: lineA, applianceId: ids.dryer, assignedAt: businessDateFromKey("2026-09-01")! } });
    if (options.threeOnA) await prisma.applianceAssignment.create({ data: { rentalLineId: lineA, applianceId: ids.third, assignedAt: businessDateFromKey("2026-09-01")! } });
    if (options.lineB) {
      await make(ids.filler, "F", options.laterList ? "RESERVED" : "RENTED", otherTypeId);
      await prisma.applianceAssignment.create({ data: { rentalLineId: lineB, applianceId: ids.filler, assignedAt: businessDateFromKey("2026-09-01")! } });
    }
    await prisma.job.create({ data: { id: originalJobId, type: "DELIVERY", status: "COMPLETED", customerId, agreementId } });
    await prisma.job.create({
      data: {
        id: laterJobId,
        type: "DELIVERY",
        status: "IN_PROGRESS",
        customerId,
        agreementId,
        ...(options.laterList ? { appliances: { create: [{ applianceId: ids.filler }] } } : {}),
      },
    });
    const waiting = async (applianceId: string) =>
      prisma.pendingDelivery.create({
        data: { agreementId, rentalLineId: lineA, applianceId, originalJobId, originalDeliveryDate: businessDateFromKey("2026-09-01")! },
      });
    const pending = await waiting(ids.dryer);
    const pendingWasher = options.bothWaiting ? await waiting(ids.washer) : null;
    const pendingThird = options.threeOnA ? await waiting(ids.third) : null;

    sim.state.subscriptions.set(subscription, {
      id: subscription,
      items: {
        data: [
          { id: `si_${lineA}`, price: { unit_amount: options.threeOnA ? 9000 : 6000, product: { id: `prod_${lineA}`, metadata: { rentalLineId: lineA } } }, tax_rates: [] },
          ...(options.lineB
            ? [{ id: `si_${lineB}`, price: { unit_amount: 2000, product: { id: `prod_${lineB}`, metadata: { rentalLineId: lineB } } }, tax_rates: [] }]
            : []),
        ],
      },
    });
    return { n, agreementId, lineA, lineB, subscription, originalJobId, laterJobId, ids, pending, pendingWasher, pendingThird, asset };
  }

  const finishLater = (s: Scenario, results: Array<{ applianceId: string; result: "DELIVERED" | "NOT_DELIVERED" }>) =>
    completeJob(ownerId, {
      jobId: s.laterJobId,
      expectedVersion: 1,
      completionKey: `sl-key-${randomUUID()}`,
      performedOn: businessDateFromKey("2026-09-11"),
      completionNotes: null,
      results,
    });

  const itemAmount = (s: Scenario, line: string) =>
    sim.state.subscriptions.get(s.subscription)?.items.data.find((item) => item.price.product.metadata.rentalLineId === line)?.price.unit_amount;
  const lineOp = (s: Scenario, pendingId: string) =>
    prisma.providerOperation.findUnique({ where: { idempotencyKey: `subscription-line-reduce-${pendingId}` } });

  /** A historical monthly invoice for line A, paid fully or partially through Stripe or by hand. */
  async function payInvoice(
    s: Scenario,
    input: {
      cents: number;
      periodStart: string;
      via: "STRIPE" | "MANUAL";
      chargeId?: string;
      taxCents?: number;
    },
  ) {
    const id = `sl-inv-${s.n}-${input.periodStart}-${tag}`;
    const baseCents = 6000;
    const taxCents = input.taxCents ?? 0;
    const amountDueCents = baseCents + taxCents;
    invoiceIds.push(id);
    await prisma.invoice.create({
      data: {
        id,
        customerId,
        agreementId: s.agreementId,
        status: input.cents >= amountDueCents ? "PAID" : "PARTIALLY_PAID",
        billingPeriodStart: businessDateFromKey(input.periodStart)!,
        subtotalCents: baseCents,
        taxCents,
        amountDueCents,
        amountPaidCents: input.cents,
      },
    });
    const line = await prisma.invoiceLineItem.create({
      data: {
        invoiceId: id,
        kind: "RENTAL",
        description: "Washer/Dryer set",
        amountCents: baseCents,
        quantity: 1,
        rentalLineId: s.lineA,
      },
    });
    if (taxCents > 0) {
      await prisma.invoiceTaxLine.create({
        data: {
          invoiceId: id,
          invoiceLineItemId: line.id,
          jurisdictionId: taxJurisdictionId,
          rateVersionId: taxRateVersionId,
          category: "RENTAL",
          taxableCents: baseCents,
          taxCents,
          source: "STRIPE",
        },
      });
    }
    const receiptId = `sl-rec-${s.n}-${input.periodStart}-${tag}`;
    receiptIds.push(receiptId);
    await prisma.receipt.create({
      data: {
        id: receiptId,
        customerId,
        source: input.via,
        amountCents: input.cents,
        method: input.via === "STRIPE" ? "card" : "cash",
        stripeChargeId: input.via === "STRIPE" ? input.chargeId! : null,
        receivedOn: new Date(`${input.periodStart}T18:00:00Z`),
        payments: { create: { invoiceId: id, amountCents: input.cents, method: input.via === "STRIPE" ? "card" : "cash", status: "succeeded" } },
      },
    });
    return id;
  }
  const withTax = (s: Scenario) => prisma.rentalAgreement.update({ where: { id: s.agreementId }, data: { taxRateMilliPercent: 8000 } });

  beforeEach(() => {
    sim.state.updateCalls = [];
    sim.state.cancelCalls = [];
    sim.state.failUpdates = false;
    sim.state.failRefunds = false;
    sim.state.refundCalls = [];
    sim.state.balanceCalls = 0;
  });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "Owner fixture", role: "OWNER" } });
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Line fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `S${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "9 Test St", city: "Denver", zip: "80201" } });
    await prisma.taxJurisdiction.create({
      data: {
        id: taxJurisdictionId,
        code: `SL-${tag.slice(0, 8)}`,
        name: "Subscription-line historical tax",
        level: "CITY",
        administration: "STATE_COLLECTED",
        reviewStatus: "REVIEWED",
      },
    });
    await prisma.taxRateVersion.create({
      data: {
        id: taxRateVersionId,
        jurisdictionId: taxJurisdictionId,
        rateMilliPercent: 8000,
        effectiveFrom: businessDateFromKey("2026-09-01")!,
        source: "MANUAL",
      },
    });
    await prisma.applianceType.create({ data: { id: typeId, name: `Dryer ${tag}`, slug: `sl-dryer-${tag}`, monthlyPriceCents: 3000 } });
    await prisma.applianceType.create({ data: { id: otherTypeId, name: `Freezer ${tag}`, slug: `sl-freezer-${tag}`, monthlyPriceCents: 2000 } });
  });

  afterAll(async () => {
    const pendingIds = (await prisma.pendingDelivery.findMany({ where: { agreementId: { in: agreementIds } }, select: { id: true } })).map((r) => r.id);
    const creditIds = (await prisma.customerCredit.findMany({ where: { customerId }, select: { id: true } })).map((r) => r.id);
    const refundRowIds = (await prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds } }, select: { id: true } })).map((r) => r.id);
    await prisma.providerOperation.deleteMany({
      where: {
        OR: [
          { subjectType: "RentalLine", subjectId: { in: lineIds } },
          { subjectType: "RentalAgreement", subjectId: { in: agreementIds } },
          { subjectType: "CustomerCredit", subjectId: { in: creditIds } },
          { subjectType: "Refund", subjectId: { in: refundRowIds } },
        ],
      },
    });
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" DISABLE TRIGGER "RentalLineAmendment_append_only"'),
      prisma.rentalLineAmendment.deleteMany({ where: { rentalLineId: { in: lineIds } } }),
      prisma.$executeRawUnsafe('ALTER TABLE "RentalLineAmendment" ENABLE TRIGGER "RentalLineAmendment_append_only"'),
    ]);
    await prisma.refund.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await prisma.receipt.deleteMany({ where: { id: { in: receiptIds } } });
    await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await prisma.staffTask.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.jobBillingHandoff.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.pendingDelivery.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.customerCredit.deleteMany({ where: { customerId } });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { userId: ownerId },
          { entityId: { in: [...agreementIds, ...pendingIds, ...creditIds, ...applianceIds, ...jobIds] } },
        ],
      },
    });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.jobAppliance.deleteMany({ where: { jobId: { in: jobIds } } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: [typeId, otherTypeId] } } });
    await prisma.taxRateVersion.deleteMany({ where: { id: taxRateVersionId } });
    await prisma.taxJurisdiction.deleteMany({ where: { id: taxJurisdictionId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, ownerId] } } });
  });

  it("S1 late-delivery-leaves-subscription-unchanged", async () => {
    const s = await build();
    await finishLater(s, [{ applianceId: s.ids.dryer, result: "DELIVERED" }]);
    expect(sim.state.updateCalls).toHaveLength(0);
    expect(sim.state.cancelCalls).toHaveLength(0);
    expect(itemAmount(s, s.lineA)).toBe(6000);
    expect((await prisma.rentalLine.findUniqueOrThrow({ where: { id: s.lineA } })).monthlyPriceCents).toBe(6000);
    expect(await prisma.rentalLineAmendment.count({ where: { rentalLineId: s.lineA } })).toBe(0);
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceId: s.pending.id } });
    expect(credit.amountCents).toBe(1000);
  });

  it("S2 same-type-swap-leaves-subscription-unchanged-and-credits-to-replacement-date", async () => {
    const s = await build({ lineB: true, laterList: true });
    await substituteWaitingItem(ownerId, { pendingDeliveryId: s.pending.id, replacementApplianceId: s.ids.spare, deliveryJobId: s.laterJobId });
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.spare } })).status).toBe("RESERVED");
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).substituteApplianceId).toBe(s.ids.spare);

    await finishLater(s, [
      { applianceId: s.ids.filler, result: "DELIVERED" },
      { applianceId: s.ids.spare, result: "DELIVERED" },
    ]);

    expect(sim.state.updateCalls).toHaveLength(0);
    expect(itemAmount(s, s.lineA)).toBe(6000);
    expect(itemAmount(s, s.lineB)).toBe(2000);
    const original = await prisma.applianceAssignment.findFirstOrThrow({ where: { applianceId: s.ids.dryer } });
    expect(original.unassignReason).toBe(`Replaced by ${s.asset("S")}`);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.dryer } })).status).toBe("AVAILABLE");
    const replacement = await prisma.applianceAssignment.findFirstOrThrow({ where: { applianceId: s.ids.spare } });
    expect(replacement.rentalLineId).toBe(s.lineA);
    expect(replacement.unassignedAt).toBeNull();
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.spare } })).status).toBe("RENTED");
    // The credit is for the days the item was missing, counted to the day the replacement arrived (Sep 1 to Sep 11).
    const credit = await prisma.customerCredit.findFirstOrThrow({ where: { customerId, sourceId: s.pending.id } });
    expect(credit.amountCents).toBe(1000);
    expect(credit.reason).toContain(s.asset("S"));
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } });
    expect(row.deliveredOn).not.toBeNull();
  });

  it("S2b different-type-substitute-refused", async () => {
    const s = await build({ lineB: true, laterList: true });
    await expect(
      substituteWaitingItem(ownerId, { pendingDeliveryId: s.pending.id, replacementApplianceId: s.ids.other, deliveryJobId: s.laterJobId }),
    ).rejects.toThrow("Different type: ask the owner.");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.other } })).status).toBe("AVAILABLE");
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).substituteApplianceId).toBeNull();
  });

  it("a substitute that is not delivered goes back on the shelf and the item waits for its own unit again", async () => {
    const s = await build({ lineB: true, laterList: true });
    await substituteWaitingItem(ownerId, { pendingDeliveryId: s.pending.id, replacementApplianceId: s.ids.spare, deliveryJobId: s.laterJobId });
    await finishLater(s, [
      { applianceId: s.ids.filler, result: "DELIVERED" },
      { applianceId: s.ids.spare, result: "NOT_DELIVERED" },
    ]);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.spare } })).status).toBe("AVAILABLE");
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } });
    expect(row.substituteApplianceId).toBeNull();
    expect(row.deliveredOn).toBeNull();
    expect(row.removedAt).toBeNull();
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.dryer } })).status).toBe("RESERVED");
  });

  it("S3 cancel-reduces-exactly-one-subscription-item-once-and-retry-is-noop", async () => {
    const s = await build({ lineB: true });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);

    expect(sim.state.updateCalls).toHaveLength(1);
    expect(sim.state.updateCalls[0]!.subscriptionId).toBe(s.subscription);
    expect(sim.state.updateCalls[0]!.params.items).toHaveLength(1);
    expect(itemAmount(s, s.lineA)).toBe(3000);
    expect(itemAmount(s, s.lineB)).toBe(2000);
    expect((await prisma.rentalLine.findUniqueOrThrow({ where: { id: s.lineA } })).monthlyPriceCents).toBe(3000);

    const amendment = await prisma.rentalLineAmendment.findFirstOrThrow({ where: { pendingDeliveryId: s.pending.id } });
    expect(amendment.previousMonthlyPriceCents).toBe(6000);
    expect(amendment.newMonthlyPriceCents).toBe(3000);
    // Takes effect at the start of the next billing period, never retroactively.
    expect(businessDateKey(amendment.effectiveFrom)).toBe("2026-11-01");
    const op = await lineOp(s, s.pending.id);
    expect(op?.status).toBe("SUCCEEDED");

    // A retry (the nightly pass) reads Stripe, sees it already matches, and sends nothing more.
    expect(await retryLineReduction(op!, s.pending.id)).toBe(true);
    expect(sim.state.updateCalls).toHaveLength(1);
    // Asking again is refused and nothing doubles.
    await expect(removeUndeliveredItem(ownerId, s.pending.id)).rejects.toThrow(/already/);
    expect(await prisma.rentalLineAmendment.count({ where: { rentalLineId: s.lineA } })).toBe(1);
    expect(sim.state.updateCalls).toHaveLength(1);
  });

  it("two people cancelling the same waiting item at once reduce the line only once", async () => {
    const s = await build({ lineB: true });
    const settled = await Promise.allSettled([
      removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!),
      removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!),
    ]);
    expect(settled.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(settled.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await prisma.rentalLineAmendment.count({ where: { rentalLineId: s.lineA } })).toBe(1);
    expect(await prisma.customerCredit.count({ where: { customerId, sourceId: s.pending.id } })).toBe(0);
    expect(sim.state.updateCalls).toHaveLength(1);
    expect(itemAmount(s, s.lineA)).toBe(3000);
  });

  it("S4 stripe-failure-leaves-visible-pending-operation", async () => {
    const s = await build({ lineB: true });
    sim.state.failUpdates = true;
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);

    // The local decision stands: the line is cheaper, the item is off the agreement, the credit exists.
    expect((await prisma.rentalLine.findUniqueOrThrow({ where: { id: s.lineA } })).monthlyPriceCents).toBe(3000);
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).removedAt).not.toBeNull();
    // Stripe still has the old amount, and the unfinished operation is on record for the owner to see.
    expect(itemAmount(s, s.lineA)).toBe(6000);
    const op = await lineOp(s, s.pending.id);
    expect(op?.status).toBe("FAILED");
    expect(op?.lastError).toBeTruthy();

    // It heals on its own once Stripe accepts the change.
    sim.state.failUpdates = false;
    expect(await retryLineReduction(op!, s.pending.id)).toBe(true);
    expect(itemAmount(s, s.lineA)).toBe(3000);
    expect((await lineOp(s, s.pending.id))?.status).toBe("SUCCEEDED");
  });

  it("S5 drift-shows-mismatch-until-stripe-matches", async () => {
    const s = await build({ lineB: true });
    // Stripe has no item for this line at all (someone removed it by hand).
    const sub = sim.state.subscriptions.get(s.subscription)!;
    const removedItem = sub.items.data.find((item) => item.price.product.metadata.rentalLineId === s.lineA)!;
    sub.items.data = sub.items.data.filter((item) => item !== removedItem);
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);

    expect(sim.state.updateCalls).toHaveLength(0);
    const op = await lineOp(s, s.pending.id);
    expect(op?.status).toBe("FAILED");
    const shown = (await detectDrift(500)).filter((row) => row.subjectType === "RentalLine" && row.subjectId === s.lineA);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.detail).toMatch(/No Stripe subscription item/);

    // The owner fixes it by hand in Stripe: the next pass sees the match and the drift row clears itself.
    sub.items.data.push({ ...removedItem, price: { ...removedItem.price, unit_amount: 3000 } });
    expect(await retryLineReduction(op!, s.pending.id)).toBe(true);
    expect(sim.state.updateCalls).toHaveLength(0);
    expect((await lineOp(s, s.pending.id))?.status).toBe("SUCCEEDED");
    expect((await detectDrift(500)).filter((row) => row.subjectType === "RentalLine" && row.subjectId === s.lineA)).toHaveLength(0);
  });

  it("S6 all-items-cancelled-ends-agreement-through-closeAgreement", async () => {
    const s = await build({ bothWaiting: true });
    const now = businessDateFromKey("2026-10-03")!;
    await removeUndeliveredItem(ownerId, s.pending.id, now);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: s.agreementId } })).status).toBe("ACTIVE");
    expect(sim.state.updateCalls).toHaveLength(1);
    expect(sim.state.cancelCalls).toHaveLength(0);

    await removeUndeliveredItem(ownerId, s.pendingWasher!.id, now);
    // Nothing was ever delivered, so the agreement is cancelled (not "ended"), and the whole subscription goes.
    const agreement = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: s.agreementId } });
    expect(agreement.status).toBe("CANCELLED");
    expect(sim.state.updateCalls).toHaveLength(1);
    expect(sim.state.cancelCalls).toEqual([{ subscriptionId: s.subscription, key: `subscription-cancel-${s.agreementId}` }]);
    const cancelOp = await prisma.providerOperation.findUnique({ where: { idempotencyKey: `subscription-cancel-${s.agreementId}` } });
    expect(cancelOp?.status).toBe("SUCCEEDED");
    expect(await prisma.applianceAssignment.count({ where: { unassignedAt: null, rentalLine: { agreementId: s.agreementId } } })).toBe(0);
    for (const id of [s.ids.washer, s.ids.dryer]) {
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("AVAILABLE");
    }
  });

  it("S7 remaining-item-share-after-removal-excludes-never-delivered-and-replaced-only", async () => {
    // $90 line with three units: washer (out), two waiting. Each of the three is worth $30.
    const s = await build({ threeOnA: true });
    const now = businessDateFromKey("2026-10-03")!;
    await removeUndeliveredItem(ownerId, s.pending.id, now);
    expect(itemAmount(s, s.lineA)).toBe(6000);
    // The first cancelled unit no longer counts, so the remaining two are $30 each and the next cancel takes $30, not $20.
    await removeUndeliveredItem(ownerId, s.pendingThird!.id, now);
    expect(itemAmount(s, s.lineA)).toBe(3000);
    const amendments = await prisma.rentalLineAmendment.findMany({ where: { rentalLineId: s.lineA }, orderBy: { createdAt: "asc" } });
    expect(amendments.map((a) => [a.previousMonthlyPriceCents, a.newMonthlyPriceCents])).toEqual([
      [9000, 6000],
      [6000, 3000],
    ]);
  });

  it("R1 never-delivered refunds what was paid (price plus tax) to the original card, newest invoice first, and makes no account credit", async () => {
    const s = await build({ lineB: true });
    await withTax(s);
    // $60 + 8% tax = $64.80 per month for the whole agreement. The item's share is $30 + $2.40 tax = $32.40 a month, two months billed.
    await payInvoice(s, { cents: 6480, periodStart: "2026-09-01", via: "STRIPE", chargeId: `ch_sep_${s.n}`, taxCents: 480 });
    await payInvoice(s, { cents: 4000, periodStart: "2026-10-01", via: "STRIPE", chargeId: `ch_oct_${s.n}`, taxCents: 480 });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);

    expect(sim.state.refundCalls.map((c) => [c.charge, c.amount])).toEqual([
      [`ch_oct_${s.n}`, 3240],
      [`ch_sep_${s.n}`, 3240],
    ]);
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } });
    expect(row).toMatchObject({ refundedCents: 6480, refundByHandCents: 0, creditId: null });
    expect(await prisma.customerCredit.count({ where: { customerId, sourceId: s.pending.id } })).toBe(0);
    expect(sim.state.balanceCalls).toBe(0);
    const refunds = await prisma.refund.findMany({ where: { invoiceId: { in: invoiceIds.filter((id) => id.includes(`-${s.n}-`)) } } });
    expect(refunds).toHaveLength(2);
    expect(refunds.every((r) => r.stripeRefundId && r.reason === "BILLING_ERROR")).toBe(true);
    const ops = await prisma.providerOperation.findMany({ where: { kind: "REFUND_CREATE", subjectId: { in: refunds.map((r) => r.id) } } });
    expect(ops.map((o) => o.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
    // Future billing for the item stops: the line is lowered, so no later month charges for it.
    expect(itemAmount(s, s.lineA)).toBe(3000);
  });

  it("R2 money paid by cash or check is not sent to Stripe: it is recorded for the owner to pay back by hand", async () => {
    const s = await build({ lineB: true });
    await withTax(s);
    await payInvoice(s, { cents: 6480, periodStart: "2026-09-01", via: "MANUAL", taxCents: 480 });
    await payInvoice(s, { cents: 6480, periodStart: "2026-10-01", via: "MANUAL", taxCents: 480 });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);
    expect(sim.state.refundCalls).toHaveLength(0);
    const row = await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } });
    expect(row).toMatchObject({ refundedCents: 0, refundByHandCents: 6480 });
    const refunds = await prisma.refund.findMany({
      where: { invoiceId: { in: invoiceIds.filter((id) => id.includes(`-${s.n}-`)) } },
      orderBy: { createdAt: "asc" },
    });
    expect(refunds).toHaveLength(2);
    expect(refunds.every((refund) => refund.stripeRefundId === null)).toBe(true);
    expect(refunds.map((refund) => refund.amountCents).sort((a, b) => a - b)).toEqual([3240, 3240]);
  });

  it("R3 a failed Stripe refund stays on record as unfinished and is never counted as done", async () => {
    const s = await build({ lineB: true });
    await payInvoice(s, { cents: 6000, periodStart: "2026-10-01", via: "STRIPE", chargeId: `ch_fail_${s.n}` });
    sim.state.failRefunds = true;
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);
    const refund = await prisma.refund.findFirstOrThrow({ where: { invoiceId: `sl-inv-${s.n}-2026-10-01-${tag}` } });
    expect(refund.stripeRefundId).toBeNull();
    const op = await prisma.providerOperation.findFirstOrThrow({ where: { kind: "REFUND_CREATE", subjectId: refund.id } });
    expect(op.status).not.toBe("SUCCEEDED");
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).removedAt).not.toBeNull();
  });

  it("R4 only what was actually paid is refunded; an unpaid month is left alone", async () => {
    const s = await build({ lineB: true });
    await payInvoice(s, { cents: 3000, periodStart: "2026-09-01", via: "STRIPE", chargeId: `ch_short_${s.n}` });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);
    // Two months at $30, no tax: $60 owed, but only $30 was ever paid.
    expect(sim.state.refundCalls.map((c) => c.amount)).toEqual([3000]);
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).refundedCents).toBe(3000);
  });

  it("R5 a rental paid in advance is not refunded automatically and its price is left for the owner to settle", async () => {
    const s = await build({ lineB: true });
    await prisma.rentalAgreement.update({ where: { id: s.agreementId }, data: { paidInFullInAdvance: true } });
    await payInvoice(s, { cents: 72000, periodStart: "2026-09-01", via: "STRIPE", chargeId: `ch_adv_${s.n}` });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);
    expect(sim.state.refundCalls).toHaveLength(0);
    expect(sim.state.updateCalls).toHaveLength(0);
    expect(await prisma.rentalLineAmendment.count({ where: { rentalLineId: s.lineA } })).toBe(0);
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).removedAt).not.toBeNull();
  });

  it("a rental line amendment can never be changed or deleted", async () => {
    const s = await build({ lineB: true });
    await removeUndeliveredItem(ownerId, s.pending.id, businessDateFromKey("2026-10-03")!);
    const amendment = await prisma.rentalLineAmendment.findFirstOrThrow({ where: { pendingDeliveryId: s.pending.id } });
    await expect(prisma.rentalLineAmendment.update({ where: { id: amendment.id }, data: { newMonthlyPriceCents: 0 } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(prisma.rentalLineAmendment.delete({ where: { id: amendment.id } })).rejects.toThrow(/cannot be changed or deleted/);
  });

  it("cancelling an agreement gives back a unit set aside as a substitute", async () => {
    const s = await build({ lineB: true, laterList: true });
    await substituteWaitingItem(ownerId, { pendingDeliveryId: s.pending.id, replacementApplianceId: s.ids.spare, deliveryJobId: s.laterJobId });
    const { cancelAgreement } = await import("@/domains/agreements");
    await cancelAgreement(ownerId, s.agreementId);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: s.ids.spare } })).status).toBe("AVAILABLE");
    expect((await prisma.pendingDelivery.findUniqueOrThrow({ where: { id: s.pending.id } })).substituteApplianceId).toBeNull();
  });
});
