import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyDueSubscriptionEnds,
  applySubscriptionEnd,
  recomputeSubscriptionEndInTx,
} from "@/domains/billing/subscription-end";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
import { prisma } from "@/lib/prisma";
import { __setStripeClientForTests } from "@/lib/stripe";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const oldEnd = new Date("2027-11-08T06:59:59.000Z");
const renewalStart = new Date("2027-11-08T07:00:00.000Z");
const renewalEndA = new Date("2028-11-08T06:59:59.000Z");
const renewalEndB = new Date("2029-11-08T06:59:59.000Z");
const reminderSentAt = new Date("2027-10-09T18:00:00.000Z");

function cancelAt(termMonths: number | null, endDate: Date | null) {
  return cancelAtSecondsFor({ termMonths, endDate });
}

type StripeState = { cancel_at: number | null; status: "active" | "canceled" };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe.skipIf(!enabled)("Batch B2 subscription-end convergence (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `b2-sub-owner-${tag}`;
  const userId = `b2-sub-user-${tag}`;
  const customerId = `b2-sub-customer-${tag}`;
  const addressId = `b2-sub-address-${tag}`;
  const agreementIds: string[] = [];
  const subscriptionIds: string[] = [];
  const states = new Map<string, StripeState>();
  const retrieve = vi.fn(async (id: string) => {
    const state = states.get(id);
    if (!state) throw new Error(`Missing fake Stripe subscription ${id}`);
    return { id, status: state.status, cancel_at: state.cancel_at };
  });
  const update = vi.fn(async (id: string, payload: { cancel_at: number | "" }) => {
    const state = states.get(id);
    if (!state) throw new Error(`Missing fake Stripe subscription ${id}`);
    state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
    return { id, status: state.status, cancel_at: state.cancel_at };
  });
  let originalAutoRenew = false;

  async function setAutoRenew(enabled: boolean) {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: enabled } });
  }

  async function makePair(input: {
    automatic?: boolean;
    renewalEnd?: Date | null;
    stripeCancelAt?: number | null;
    oldEndDate?: Date;
  } = {}) {
    const n = agreementIds.length;
    const subscriptionId = `sub_b2_${tag}_${n}`;
    subscriptionIds.push(subscriptionId);
    const endDate = input.oldEndDate ?? oldEnd;
    const automatic = input.automatic ?? false;
    const old = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        startDate: new Date("2026-11-08T07:00:00.000Z"),
        endDate,
        stripeSubscriptionId: subscriptionId,
        renewalPreference: automatic ? "AUTO_RENEW" : null,
        autoRenewConsentedAt: automatic ? new Date("2026-11-08T07:00:00.000Z") : null,
      },
    });
    agreementIds.push(old.id);
    const renewal = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "SCHEDULED",
        termMonths: input.renewalEnd === null ? null : 12,
        startDate: renewalStart,
        endDate: input.renewalEnd === null ? null : input.renewalEnd ?? renewalEndA,
        renewedFromAgreementId: old.id,
        createdByAutoRenew: automatic,
      },
    });
    agreementIds.push(renewal.id);
    if (automatic) {
      await prisma.customerNotice.create({
        data: {
          customerId,
          agreementId: old.id,
          kind: "RENEWAL_REMINDER",
          dedupeKey: renewalReminderKey(old.id, endDate),
          subject: "Renewal reminder",
          body: "Your rental renewal reminder.",
          status: "SENT",
          sentAt: reminderSentAt,
          sentVia: "EMAIL",
        },
      });
    }
    states.set(subscriptionId, {
      cancel_at: input.stripeCancelAt === undefined ? cancelAt(12, endDate) : input.stripeCancelAt,
      status: "active",
    });
    return { old, renewal, subscriptionId };
  }

  beforeAll(async () => {
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    originalAutoRenew = settings.autoRenewEnabled;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-owner@example.test`, role: "OWNER", emailVerified: true },
        { id: userId, email: `${tag}-customer@example.test`, role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `SE${tag.slice(0, 16)}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Convergence Way", city: "Greeley", zip: "80631" },
    });
  });

  beforeEach(async () => {
    states.clear();
    retrieve.mockClear();
    update.mockClear();
    update.mockImplementation(async (id: string, payload: { cancel_at: number | "" }) => {
      const state = states.get(id);
      if (!state) throw new Error(`Missing fake Stripe subscription ${id}`);
      state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
      return { id, status: state.status, cancel_at: state.cancel_at };
    });
    __setStripeClientForTests({ subscriptions: { retrieve, update } } as never);
    await setAutoRenew(true);
  });

  afterAll(async () => {
    __setStripeClientForTests(null);
    await setAutoRenew(originalAutoRenew);
    await prisma.customerNotice.deleteMany({ where: { customerId } });
    await prisma.providerOperation.deleteMany({
      where: { subjectType: "StripeSubscription", subjectId: { in: subscriptionIds } },
    });
    await prisma.subscriptionEndIntent.deleteMany({ where: { stripeSubscriptionId: { in: subscriptionIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, userId] } } });
  });

  it("sub-end-extend-paused-then-optout-final-state-is-old-end", async () => {
    const { old, subscriptionId } = await makePair({ automatic: true });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));

    const entered = deferred();
    const release = deferred();
    update.mockImplementationOnce(async (id: string, payload: { cancel_at: number | "" }) => {
      entered.resolve();
      await release.promise;
      const state = states.get(id)!;
      state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
      return { id, status: state.status, cancel_at: state.cancel_at };
    });

    const worker = applySubscriptionEnd(subscriptionId);
    await entered.promise;
    await prisma.$transaction(async (tx) => {
      await tx.rentalAgreement.update({
        where: { id: old.id },
        data: { renewalPreference: "NONE", autoRenewConsentedAt: null },
      });
      await recomputeSubscriptionEndInTx(tx, subscriptionId);
    });
    release.resolve();

    expect(await worker).toBe("APPLIED");
    expect(states.get(subscriptionId)?.cancel_at).toBe(cancelAt(12, oldEnd));
    const intent = await prisma.subscriptionEndIntent.findUniqueOrThrow({ where: { stripeSubscriptionId: subscriptionId } });
    expect(intent.version).toBe(2);
    expect(intent.appliedVersion).toBe(2);
  });

  it("sub-end-old-revert-retried-after-new-renewal-does-not-stop-billing", async () => {
    const { old, renewal, subscriptionId } = await makePair();
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    expect(await applySubscriptionEnd(subscriptionId)).toBe("APPLIED");

    await prisma.rentalAgreement.update({ where: { id: renewal.id }, data: { status: "CANCELLED" } });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    update.mockImplementationOnce(async () => {
      throw Object.assign(new Error("connection lost"), { type: "StripeConnectionError" });
    });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("RETRY");
    const failedVersion = (await prisma.subscriptionEndIntent.findUniqueOrThrow({ where: { stripeSubscriptionId: subscriptionId } })).version;

    const newer = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "SCHEDULED",
        termMonths: 12,
        startDate: renewalStart,
        endDate: renewalEndB,
        renewedFromAgreementId: old.id,
      },
    });
    agreementIds.push(newer.id);
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    await prisma.subscriptionEndIntent.update({ where: { stripeSubscriptionId: subscriptionId }, data: { nextAttemptAt: null } });
    await applyDueSubscriptionEnds();

    expect(states.get(subscriptionId)?.cancel_at).toBe(cancelAt(12, renewalEndB));
    const oldOp = await prisma.providerOperation.findUnique({
      where: { idempotencyKey: `subscription-end-${subscriptionId}-v${failedVersion}` },
    });
    expect(oldOp?.status).toBe("SUPERSEDED");
  });

  it("sub-end-consent-withdrawn-while-cancel-step-fails", async () => {
    const { old, subscriptionId } = await makePair({ automatic: true });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    await applySubscriptionEnd(subscriptionId);
    expect(states.get(subscriptionId)?.cancel_at).toBe(cancelAt(12, renewalEndA));

    await prisma.$transaction(async (tx) => {
      await tx.rentalAgreement.update({ where: { id: old.id }, data: { autoRenewConsentedAt: null, renewalPreference: "NONE" } });
      await recomputeSubscriptionEndInTx(tx, subscriptionId);
    });
    update.mockImplementationOnce(async () => {
      throw new Error("provider refused");
    });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("RETRY");
    await prisma.subscriptionEndIntent.update({ where: { stripeSubscriptionId: subscriptionId }, data: { nextAttemptAt: null } });
    await applyDueSubscriptionEnds();
    expect(states.get(subscriptionId)?.cancel_at).toBe(cancelAt(12, oldEnd));
  });

  it("sub-end-crash-after-decision-commit-recovered-by-sweep", async () => {
    const { subscriptionId } = await makePair({ stripeCancelAt: null });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    expect(update).not.toHaveBeenCalled();
    const result = await applyDueSubscriptionEnds();
    expect(result.applied).toBeGreaterThanOrEqual(1);
    expect(states.get(subscriptionId)?.cancel_at).toBe(cancelAt(12, renewalEndA));
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("sub-end-two-workers-one-lease", async () => {
    const { subscriptionId } = await makePair({ stripeCancelAt: null });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    const entered = deferred();
    const release = deferred();
    update.mockImplementationOnce(async (id: string, payload: { cancel_at: number | "" }) => {
      entered.resolve();
      await release.promise;
      const state = states.get(id)!;
      state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
      return { id, status: state.status, cancel_at: state.cancel_at };
    });
    const first = applySubscriptionEnd(subscriptionId);
    await entered.promise;
    expect(await applySubscriptionEnd(subscriptionId)).toBe("BUSY");
    release.resolve();
    expect(await first).toBe("APPLIED");
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("sub-end-stale-worker-result-discarded-after-takeover", async () => {
    const { subscriptionId } = await makePair({ stripeCancelAt: null });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    const entered = deferred();
    const release = deferred();
    let calls = 0;
    update.mockImplementation(async (id: string, payload: { cancel_at: number | "" }) => {
      calls += 1;
      if (calls === 1) {
        entered.resolve();
        await release.promise;
      }
      const state = states.get(id)!;
      state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
      return { id, status: state.status, cancel_at: state.cancel_at };
    });
    const first = applySubscriptionEnd(subscriptionId);
    await entered.promise;
    await prisma.subscriptionEndIntent.update({
      where: { stripeSubscriptionId: subscriptionId },
      data: { leaseUntil: new Date(Date.now() - 1_000) },
    });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("APPLIED");
    release.resolve();
    expect(await first).toBe("TAKEN_OVER");
    expect((await prisma.subscriptionEndIntent.findUniqueOrThrow({ where: { stripeSubscriptionId: subscriptionId } })).appliedVersion).toBe(1);
  });

  it("sub-end-unknown-resolved-by-read", async () => {
    const { subscriptionId } = await makePair({ stripeCancelAt: null });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    update.mockImplementationOnce(async (id: string, payload: { cancel_at: number | "" }) => {
      const state = states.get(id)!;
      state.cancel_at = payload.cancel_at === "" ? null : payload.cancel_at;
      throw Object.assign(new Error("lost response"), { type: "StripeConnectionError" });
    });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("RETRY");
    expect(update).toHaveBeenCalledTimes(1);
    await prisma.subscriptionEndIntent.update({ where: { stripeSubscriptionId: subscriptionId }, data: { nextAttemptAt: null } });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("APPLIED");
    expect(update).toHaveBeenCalledTimes(1);
    const op = await prisma.providerOperation.findFirst({
      where: { subjectType: "StripeSubscription", subjectId: subscriptionId },
      orderBy: { requestedAt: "desc" },
    });
    expect(op?.status).toBe("SUCCEEDED");
  });

  it("sub-end-past-end-never-sent", async () => {
    const past = new Date("2025-01-01T06:59:59.000Z");
    const n = agreementIds.length;
    const subscriptionId = `sub_b2_${tag}_${n}`;
    subscriptionIds.push(subscriptionId);
    const agreement = await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: addressId,
        status: "ACTIVE",
        termMonths: 12,
        startDate: new Date("2024-01-01T07:00:00.000Z"),
        endDate: past,
        stripeSubscriptionId: subscriptionId,
      },
    });
    agreementIds.push(agreement.id);
    states.set(subscriptionId, { cancel_at: null, status: "active" });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    expect(await applySubscriptionEnd(subscriptionId)).toBe("PAST_END");
    expect(update).not.toHaveBeenCalled();
  });

  it("sub-end-renewal-start-moves-holder-no-stripe-call", async () => {
    const { old, renewal, subscriptionId } = await makePair({ stripeCancelAt: cancelAt(12, renewalEndA) });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, subscriptionId));
    expect(await applySubscriptionEnd(subscriptionId)).toBe("APPLIED");
    expect(update).not.toHaveBeenCalled();

    await prisma.$transaction(async (tx) => {
      await tx.rentalAgreement.update({ where: { id: old.id }, data: { status: "ENDED", stripeSubscriptionId: null } });
      await tx.rentalAgreement.update({ where: { id: renewal.id }, data: { status: "ACTIVE", stripeSubscriptionId: subscriptionId } });
      await recomputeSubscriptionEndInTx(tx, subscriptionId);
    });
    expect(await applySubscriptionEnd(subscriptionId)).toBe("APPLIED");
    expect(update).not.toHaveBeenCalled();
  });
});
