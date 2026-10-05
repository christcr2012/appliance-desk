import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  // What the fake Stripe currently holds as each subscription's cancel_at (null = none).
  state: new Map<string, number | null>(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve } }),
}));

import { prisma } from "@/lib/prisma";
import { finishPendingProviderOperations } from "@/domains/billing/reconciliation";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";

const cancelAtFor = (endDate: Date) => cancelAtSecondsFor({ termMonths: 12, endDate });
import { endAgreement, cancelAgreement, endAgreementOnAgreedDate } from "@/domains/agreements";
import { startDueRenewals, startRenewalIfDue } from "@/domains/agreements/renewal-start";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const termEnd = new Date("2027-11-08T06:59:59Z");
const renewalStart = new Date("2027-11-08T07:00:00Z");
const beforeStart = new Date("2027-11-01T12:00:00Z");
const onStart = new Date("2027-11-08T13:00:00Z");

describe.skipIf(!enabled)("a signed renewal starts on its start date and hands everything over", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `rs-owner-${tag}`;
  const userId = `rs-user-${tag}`;
  const customerId = `rs-customer-${tag}`;
  const addressId = `rs-address-${tag}`;
  const typeId = `rs-type-${tag}`;
  const agreementIds: string[] = [];
  const applianceIds: string[] = [];

  async function pair(
    opts: {
      oldStatus?: "ACTIVE" | "ENDED";
      sub?: boolean;
      renewalLines?: "same" | "different" | "extra";
      renewalTermMonths?: number | null;
    } = {},
  ) {
    const n = agreementIds.length;
    const old = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: opts.oldStatus ?? "ACTIVE",
        termMonths: 12,
        startDate: new Date("2026-11-08T07:00:00Z"),
        endDate: termEnd,
        nextBillingDate: new Date("2027-11-08T19:00:00Z"),
        billingStartedAt: new Date("2026-11-09T19:00:00Z"),
        stripeSubscriptionId: opts.sub === false ? null : `sub_${tag}_${n}`,
        lines: {
          create: [
            { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 },
            { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 },
          ],
        },
      },
      include: { lines: true },
    });
    const renewal = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "SCHEDULED",
        termMonths: opts.renewalTermMonths === undefined ? 12 : opts.renewalTermMonths,
        startDate: renewalStart,
        endDate: opts.renewalTermMonths === null ? null : new Date("2028-11-07T06:59:59Z"),
        renewedFromAgreementId: old.id,
        lines: {
          create:
            opts.renewalLines === "different"
              ? [{ label: "Fridge", monthlyPriceCents: 4000, listPriceCents: 4000 }]
              : [
                  ...(opts.renewalLines === "extra"
                    ? [{ label: "Fridge", monthlyPriceCents: 4000, listPriceCents: 4000 }]
                    : []),
                  { label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 },
                  { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 },
                ],
        },
      },
    });
    agreementIds.push(old.id, renewal.id);
    if (old.stripeSubscriptionId) stripeMock.state.set(old.stripeSubscriptionId, cancelAtFor(termEnd));
    const washerLine = old.lines.find((l) => l.label === "Washer")!;
    const appliance = await prisma.appliance.create({
      data: { assetNumber: `RS-${tag}-${n}`, applianceTypeId: typeId, status: "RENTED" },
    });
    applianceIds.push(appliance.id);
    await prisma.applianceAssignment.create({ data: { rentalLineId: washerLine.id, applianceId: appliance.id } });
    await prisma.deposit.create({ data: { agreementId: old.id, amountCents: 5000 } });
    return { old, renewal, appliance };
  }

  const get = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });

  beforeEach(() => {
    stripeMock.state.clear();
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({
      id,
      status: "active",
      cancel_at: stripeMock.state.get(id) ?? null,
    }));
  });

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "RS Owner", role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-c@example.test`, name: "RS Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `R${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
    await prisma.applianceType.create({ data: { id: typeId, name: `RS Type ${tag}`, slug: `rs-type-${tag}` } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: agreementIds } } });
    await prisma.applianceCustodyEpisode.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.deposit.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId: { in: applianceIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: applianceIds } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { renewedFromAgreementId: { in: agreementIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("changes nothing before the start date: only the old rental is active and the appliance stays with it", async () => {
    const { old, renewal, appliance } = await pair();
    const result = await startRenewalIfDue(renewal.id, beforeStart);
    expect(result).toMatchObject({ started: false, reason: "NOT_YET" });
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
    const active = await prisma.rentalAgreement.count({
      where: { customerId, status: "ACTIVE", id: { in: [old.id, renewal.id] } },
    });
    expect(active).toBe(1);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: appliance.id } })).status).toBe("RENTED");
  });

  it("on the start date: renewal active, old ended, appliance moved without a pickup, billing and deposit carried over", async () => {
    const { old, renewal, appliance } = await pair();
    const result = await startRenewalIfDue(renewal.id, onStart);
    expect(result).toMatchObject({ started: true, appliancesMoved: 1, endedAgreementId: old.id });

    const o = await get(old.id);
    const r = await get(renewal.id);
    expect(o.status).toBe("ENDED");
    expect(o.endDate?.toISOString()).toBe(termEnd.toISOString());
    expect(o.stripeSubscriptionId).toBeNull();
    expect(r.status).toBe("ACTIVE");
    expect(r.stripeSubscriptionId).toBe(`sub_${tag}_${agreementIds.indexOf(old.id)}`);
    expect(r.nextBillingDate?.toISOString()).toBe("2027-11-08T19:00:00.000Z");
    expect(r.billingStartedAt?.toISOString()).toBe(renewalStart.toISOString());

    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: appliance.id } })).status).toBe("RENTED");
    const assignments = await prisma.applianceAssignment.findMany({
      where: { applianceId: appliance.id },
      include: { rentalLine: true },
    });
    const open = assignments.filter((a) => a.unassignedAt === null);
    expect(open).toHaveLength(1);
    expect(open[0].rentalLine.agreementId).toBe(renewal.id);
    expect(open[0].rentalLine.label).toBe("Washer");
    expect(assignments.find((a) => a.unassignedAt !== null)?.unassignReason).toMatch(/renewal/i);

    expect(await prisma.deposit.count({ where: { agreementId: renewal.id } })).toBe(1);
    expect(await prisma.deposit.count({ where: { agreementId: old.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: renewal.id, action: "agreement.renewal_started" } })).toBe(1);
  });

  async function openEpisode(applianceId: string, agreementId: string) {
    return prisma.applianceCustodyEpisode.create({
      data: { applianceId, customerId, serviceAddressId: addressId, agreementId, startedOn: new Date("2026-11-08T07:00:00Z"), startEvidence: "JOB" },
    });
  }

  it("custody-survives-renewal-start: the customer's stay is the same open record after the renewal starts", async () => {
    const { old, renewal, appliance } = await pair();
    const episode = await openEpisode(appliance.id, old.id);
    expect(await startRenewalIfDue(renewal.id, onStart)).toMatchObject({ started: true });
    const after = await prisma.applianceCustodyEpisode.findMany({ where: { applianceId: appliance.id } });
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: episode.id, closedAt: null, startedOn: episode.startedOn, agreementId: old.id });
  });

  it("custody-survives-close-agreement-null-user: ending a rental (even by the system) leaves the stay open until the pickup", async () => {
    const byOwner = await pair({ sub: false });
    const byOwnerEpisode = await openEpisode(byOwner.appliance.id, byOwner.old.id);
    await prisma.rentalAgreement.delete({ where: { id: byOwner.renewal.id } }).catch(() => undefined);
    await endAgreement(ownerId, byOwner.old.id);
    const bySystem = await pair({ sub: false });
    const bySystemEpisode = await openEpisode(bySystem.appliance.id, bySystem.old.id);
    await prisma.rentalAgreement.delete({ where: { id: bySystem.renewal.id } }).catch(() => undefined);
    await endAgreementOnAgreedDate(bySystem.old.id, new Date("2027-11-08T06:59:59Z"));
    for (const [appliance, episode] of [[byOwner.appliance, byOwnerEpisode], [bySystem.appliance, bySystemEpisode]] as const) {
      expect((await prisma.appliance.findUniqueOrThrow({ where: { id: appliance.id } })).status).toBe("AWAITING_PICKUP");
      expect(await prisma.applianceCustodyEpisode.findUniqueOrThrow({ where: { id: episode.id } })).toMatchObject({ closedAt: null, endEvidence: null });
    }
  });

  it("two starts at the same moment hand over exactly once", async () => {
    const { renewal, appliance } = await pair();
    const results = await Promise.all([startRenewalIfDue(renewal.id, onStart), startRenewalIfDue(renewal.id, onStart)]);
    expect(results.filter((r) => r.started)).toHaveLength(1);
    // The second caller is turned away either because the first already started it, or because the first is still
    // finishing the billing hand-off (it simply tries again later). Either way it never starts a second time.
    const loser = results.find((r) => !r.started);
    expect(loser && !loser.started ? loser.reason : null).toMatch(/^(NOT_SCHEDULED|BILLING_NOT_READY)$/);
    const open = await prisma.applianceAssignment.count({ where: { applianceId: appliance.id, unassignedAt: null } });
    expect(open).toBe(1);
  });

  it("will not start if the rental it renews was already ended, and says why", async () => {
    const { old, renewal } = await pair({ oldStatus: "ENDED" });
    const result = await startRenewalIfDue(renewal.id, onStart);
    expect(result).toMatchObject({ started: false, reason: "OLD_NOT_ACTIVE" });
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
    expect((await get(old.id)).status).toBe("ENDED");
  });

  it("changes nothing at all when the renewal's lines do not match the old ones", async () => {
    const { old, renewal, appliance } = await pair({ renewalLines: "different" });
    await expect(startRenewalIfDue(renewal.id, onStart)).rejects.toThrow(/different number of rental lines/);
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(old.id)).stripeSubscriptionId).not.toBeNull();
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
    expect(await prisma.applianceAssignment.count({ where: { applianceId: appliance.id, unassignedAt: null } })).toBe(1);
  });

  it("the nightly job starts what is due, reports what is stuck, and a second run starts nothing", async () => {
    const good = await pair();
    const stuck = await pair({ oldStatus: "ENDED" });
    const first = await startDueRenewals(onStart);
    expect((await get(good.renewal.id)).status).toBe("ACTIVE");
    expect(first.blocked.map((b) => b.renewalId)).toContain(stuck.renewal.id);
    const second = await startDueRenewals(onStart);
    expect(second.started).toBe(0);
  });

  it("refuses to end or cancel a rental while its signed renewal is waiting", async () => {
    const { old, renewal } = await pair();
    await expect(endAgreement(ownerId, old.id)).rejects.toThrow(/signed renewal waiting/);
    await expect(cancelAgreement(ownerId, old.id)).rejects.toThrow(/signed renewal waiting/);
    expect((await get(old.id)).status).toBe("ACTIVE");
    // Cancelling the renewal first frees the old rental to be ended.
    await cancelAgreement(ownerId, renewal.id);
    expect((await get(renewal.id)).status).toBe("CANCELLED");
    await endAgreement(ownerId, old.id);
    expect((await get(old.id)).status).toBe("ENDED");
  });

  it("moves the subscription's end date to the renewal's end before handing over", async () => {
    const { renewal } = await pair();
    await startRenewalIfDue(renewal.id, onStart);
    expect(stripeMock.update).toHaveBeenCalledTimes(1);
    const [subId, params] = stripeMock.update.mock.calls[0]!;
    expect(subId).toMatch(/^sub_/);
    expect(params.cancel_at).toBe(cancelAtFor(new Date("2028-11-07T06:59:59Z")));
    expect(await prisma.providerOperation.count({ where: { subjectType: "StripeSubscription", subjectId: subId, status: "SUCCEEDED" } })).toBe(1);
  });

  it("a month-to-month renewal removes the subscription's end date", async () => {
    const { renewal } = await pair({ renewalTermMonths: null });
    await startRenewalIfDue(renewal.id, onStart);
    expect(stripeMock.update.mock.calls[0]![1]).toEqual({ cancel_at: "" });
  });

  it("does not start while Stripe has not confirmed the new end date, then starts once it has", async () => {
    const { old, renewal } = await pair();
    stripeMock.update.mockRejectedValueOnce(Object.assign(new Error("card processor down"), { type: "StripeConnectionError" }));
    const blocked = await startRenewalIfDue(renewal.id, onStart);
    expect(blocked).toMatchObject({ started: false, reason: "BILLING_NOT_READY" });
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(old.id)).stripeSubscriptionId).not.toBeNull();
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
    // The reconciliation pass reads Stripe, sees the old end date, and retries the change.
    await finishPendingProviderOperations(200);
    expect(
      await prisma.providerOperation.count({
        where: { subjectType: "StripeSubscription", subjectId: (await get(old.id)).stripeSubscriptionId!, status: "SUCCEEDED" },
      }),
    ).toBe(1);
    expect(await startRenewalIfDue(renewal.id, onStart)).toMatchObject({ started: true });
  });

  it("when the renewal is cancelled before it starts, the old end date goes back on the subscription", async () => {
    const { old, renewal } = await pair();
    await startRenewalIfDue(renewal.id, beforeStart); // signing-time extension
    stripeMock.update.mockClear();
    await cancelAgreement(ownerId, renewal.id);
    expect(stripeMock.update).toHaveBeenCalledTimes(1);
    expect(stripeMock.update.mock.calls[0]![1].cancel_at).toBe(cancelAtFor(termEnd));
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(renewal.id)).status).toBe("CANCELLED");
  });

  it("refuses to start when the renewal has an extra line the carried-over subscription would not bill", async () => {
    const { old, renewal } = await pair({ renewalLines: "extra" });
    await expect(startRenewalIfDue(renewal.id, onStart)).rejects.toThrow(/different number of rental lines/);
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
  });

  it("refuses to start when equipment was reserved directly on the renewal's lines", async () => {
    const { old, renewal } = await pair();
    const line = await prisma.rentalLine.findFirstOrThrow({ where: { agreementId: renewal.id } });
    const extra = await prisma.appliance.create({
      data: { assetNumber: `RS-X-${tag}`, applianceTypeId: typeId, status: "RESERVED" },
    });
    applianceIds.push(extra.id);
    await prisma.applianceAssignment.create({ data: { rentalLineId: line.id, applianceId: extra.id } });
    await expect(startRenewalIfDue(renewal.id, onStart)).rejects.toThrow(/already has equipment assigned/);
    expect((await get(old.id)).status).toBe("ACTIVE");
    expect((await get(renewal.id)).status).toBe("SCHEDULED");
  });

  it("gives the renewal its own billing start and keeps its term end", async () => {
    const { renewal } = await pair();
    await startRenewalIfDue(renewal.id, onStart);
    const r = await get(renewal.id);
    expect(r.billingStartedAt?.toISOString()).toBe(renewalStart.toISOString());
    expect(r.endDate?.toISOString()).toBe("2028-11-07T06:59:59.000Z");
  });
});
