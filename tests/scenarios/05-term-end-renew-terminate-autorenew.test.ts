// PLAN scenario 5 (BATCH-F WU-F3): a fixed term reaches its end. One rental renews automatically (reminder first, billing carried
// on, renewal takes over); one customer opts out (in both orders against the billing extension, the old end date is what the
// fake Stripe ends up holding: the B2 ordering rule); one customer ends early on an agreed date (the fee is invoiced once).
// The "Automatic renewals" master switch is turned ON inside this test only and restored afterwards. Stripe and email are faked.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
  // What the fake Stripe currently holds as each subscription's cancel_at (null = billing carries on).
  state: new Map<string, number | null>(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel } }),
}));
const emailMock = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: emailMock.send }));

import { prisma } from "@/lib/prisma";
import { runAutoRenewals, extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { setAutoRenew } from "@/domains/agreements/term";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
import { applySubscriptionEnd, recomputeSubscriptionEndInTx } from "@/domains/billing/subscription-end";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";
import { purgeScenarioQueues } from "../helpers/scenario-order";

const scenarioStartedAt = new Date();
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

const termEnd = new Date("2027-11-08T06:59:59Z");
const windowOpen = new Date("2027-10-20T12:00:00Z");
const afterTerm = new Date("2027-11-09T12:00:00Z");
const effectiveOn = new Date("2027-03-08T07:00:00Z");
const onEnding = new Date("2027-03-08T13:00:00Z");
const snapshot = { shape: 1, source: "SYSTEM", capturedAt: "2026-11-01T00:00:00Z", termination: null, autoRenew: { noticeDays: 30, termsText: "Renews month to month.", termsVersion: "sc5" } };

describe.skipIf(!enabled)("scenario 5: term end, renewal, termination and auto-renew", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `sc5-user-${tag}`;
  const customerId = `sc5-customer-${tag}`;
  const addressId = `sc5-address-${tag}`;
  const ids: string[] = [];
  let switchBefore = false;

  async function agreement(extra: { endDate?: Date; renewalPreference?: "AUTO_RENEW" | "NONE"; terminationEffectiveOn?: Date; terminationFeeCents?: number } = {}) {
    const row = await prisma.rentalAgreement.create({
      data: {
        customerId, serviceAddressId: addressId, status: "ACTIVE", termMonths: 12, startDate: new Date("2026-11-08T07:00:00Z"),
        endDate: extra.endDate ?? termEnd, stripeSubscriptionId: `sub_sc5_${tag}_${ids.length}`,
        renewalPreference: extra.renewalPreference ?? "AUTO_RENEW", autoRenewConsentedAt: new Date("2026-11-08T08:00:00Z"), autoRenewTermsVersion: "sc5",
        termsSnapshot: snapshot,
        terminationRequestedAt: extra.terminationEffectiveOn ? new Date("2027-02-01T12:00:00Z") : null,
        terminationEffectiveOn: extra.terminationEffectiveOn ?? null, terminationFeeCents: extra.terminationFeeCents ?? null,
        terminationPolicyVersion: extra.terminationEffectiveOn ? "tp-sc5" : null,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 }, { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 }] },
      },
    });
    ids.push(row.id);
    // A fixed-term subscription is created in Stripe already carrying its end date.
    stripeMock.state.set(row.stripeSubscriptionId!, cancelAtSecondsFor(row));
    return row;
  }
  const get = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const notice = (a: { id: string; endDate: Date | null }) => prisma.customerNotice.findUnique({ where: { dedupeKey: renewalReminderKey(a.id, a.endDate!) } });
  const deliver = (a: { id: string; endDate: Date | null }) =>
    prisma.customerNotice.update({ where: { dedupeKey: renewalReminderKey(a.id, a.endDate!) }, data: { status: "SENT", sentAt: new Date("2027-10-10T15:00:00Z"), sentVia: "HAND: scenario" } });
  const renewals = (id: string) => prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: id } });
  const heldEnd = (a: { stripeSubscriptionId: string | null }) => stripeMock.state.get(a.stripeSubscriptionId!) ?? null;

  beforeEach(() => {
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({ id, status: "active", cancel_at: stripeMock.state.get(id) ?? null }));
    stripeMock.cancel.mockReset().mockImplementation(async (id: string) => ({ id }));
    emailMock.send.mockReset().mockResolvedValue({ sent: false, outcome: "NOT_ATTEMPTED" });
  });

  beforeAll(async () => {
    switchBefore = (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { autoRenewEnabled: true } }))?.autoRenewEnabled === true;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
    await prisma.user.create({ data: { id: userId, email: `${tag}-c@example.test`, name: "SC5 Customer", role: "CUSTOMER", emailVerified: true } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `C${tag.slice(0, 18)}` } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "5 Scenario St", city: "Greeley", zip: "80631" } });
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: switchBefore } });
    const made = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: { in: ids } }, select: { id: true } });
    const all = [...ids, ...made.map((r) => r.id)];
    const invoices = await prisma.invoice.findMany({ where: { agreementId: { in: all } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: all } }, { entityId: { in: invoices.map((i) => i.id) } }] } });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: all } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.customerNotice.deleteMany({ where: { customerId } });
    await prisma.consentRecord.deleteMany({ where: { customerId } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: made.map((r) => r.id) } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("renews automatically only after the customer was reminded, then the renewal takes over the same subscription", async () => {
    const a = await agreement();
    expect(heldEnd(a)).toBe(cancelAtSecondsFor(a));
    // Before the reminder window nothing happens.
    await runAutoRenewals(new Date("2027-09-01T12:00:00Z"));
    expect(await renewals(a.id)).toHaveLength(0);
    // The window opens: one month-to-month renewal is queued with its reminder, and billing's end date is not touched yet.
    expect((await runAutoRenewals(windowOpen)).problems).toEqual([]);
    const [renewal] = await renewals(a.id);
    expect(renewal).toMatchObject({ status: "SCHEDULED", createdByAutoRenew: true, termMonths: null });
    expect((await notice(a))!.status).toBe("PENDING");
    await extendBillingForDeliveredAutoRenewals(windowOpen);
    expect(heldEnd(a)).toBe(cancelAtSecondsFor(a));
    // The renewal cannot start without its reminder; the reminder is sent once; then billing carries on and the renewal starts.
    const held = await startRenewalIfDue(renewal.id, afterTerm);
    expect(held.started).toBe(false);
    await deliver(a); // delivered 29 days ahead, inside the reminder window (hand-recorded delivery)
    expect((await notice(a))!.status).toBe("SENT");
    await extendBillingForDeliveredAutoRenewals(windowOpen);
    expect(heldEnd(a)).toBeNull();
    expect((await startRenewalIfDue(renewal.id, afterTerm)).started).toBe(true);
    expect((await get(a.id)).status).toBe("ENDED");
    const taken = await get(renewal.id);
    expect(taken.status).toBe("ACTIVE");
    expect(taken.stripeSubscriptionId).toBe(a.stripeSubscriptionId);
    // A second night changes nothing: still one renewal, one reminder, one audit row for the schedule.
    await runAutoRenewals(afterTerm);
    expect(await renewals(a.id)).toHaveLength(1);
    expect(await prisma.customerNotice.count({ where: { agreementId: a.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: renewal.id, action: "agreement.auto_renewal_scheduled" } })).toBe(1);
  });

  it("an opt-out wins against the billing extension whichever comes first: Stripe ends up holding the old end date", async () => {
    // Order 1: the opt-out is saved first (its cancellation of the renewal has not run yet), then the extension runs: nothing is extended.
    const first = await agreement();
    await runAutoRenewals(windowOpen);
    await deliver(first);
    await prisma.rentalAgreement.update({ where: { id: first.id }, data: { renewalPreference: "NONE" } });
    stripeMock.update.mockClear();
    await extendBillingForDeliveredAutoRenewals(windowOpen);
    expect(stripeMock.update).not.toHaveBeenCalled();
    expect(heldEnd(first)).toBe(cancelAtSecondsFor(first));

    // Order 2: the extension already carried billing on, then the customer opts out: the old end date is given back.
    const second = await agreement();
    await runAutoRenewals(windowOpen);
    await deliver(second);
    await extendBillingForDeliveredAutoRenewals(windowOpen);
    expect(heldEnd(second)).toBeNull();
    await setAutoRenew({ userId, kind: "customer" }, second.id, { enabled: false, termsVersion: "sc5" });
    expect(heldEnd(second)).toBe(cancelAtSecondsFor(second));
    const [queued] = await renewals(second.id);
    expect(queued.status).toBe("CANCELLED");
    expect((await notice(second))!.status).toBe("SENT"); // already delivered; the record of it stays
    expect((await get(second.id)).renewalPreference).toBe("NONE");
    // At the term end the opted-out rental simply ends; nothing starts by itself.
    expect((await startRenewalIfDue(queued.id, afterTerm)).started).toBe(false);
    expect((await get(second.id)).status).toBe("ACTIVE");
  });

  it("an agreed early ending ends the rental on its date, tells Stripe to stop, and invoices the fee exactly once", async () => {
    const c = await agreement({ renewalPreference: "NONE", terminationEffectiveOn: effectiveOn, terminationFeeCents: 5000 });
    await prisma.$transaction((tx) => recomputeSubscriptionEndInTx(tx, c.stripeSubscriptionId!));
    expect(await applySubscriptionEnd(c.stripeSubscriptionId!)).toBe("APPLIED");
    expect(heldEnd(c)).toBe(Math.floor((effectiveOn.getTime() - 1000) / 1000));
    // Nothing happens before the date.
    expect((await runDueTerminations(new Date("2027-03-01T12:00:00Z"))).ended).toBe(0);
    expect((await get(c.id)).status).toBe("ACTIVE");
    // Two overlapping nightly runs on the date end it once and invoice the fee once.
    await Promise.all([runDueTerminations(onEnding), runDueTerminations(onEnding)]);
    const ended = await get(c.id);
    expect(ended.status).toBe("ENDED");
    expect(ended.endDate?.toISOString()).toBe(new Date(effectiveOn.getTime() - 1000).toISOString());
    const invoices = await prisma.invoice.findMany({ where: { agreementId: c.id }, include: { lineItems: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0]).toMatchObject({ status: "OPEN", amountDueCents: 5000, amountPaidCents: 0, taxCents: 0 });
    expect(invoices[0].lineItems.map((l) => [l.kind, l.amountCents])).toEqual([["EARLY_TERMINATION_FEE", 5000]]);
    expect(await prisma.auditLog.count({ where: { entityId: c.id, action: "agreement.end" } })).toBe(1);
    await runDueTerminations(onEnding);
    expect(await prisma.invoice.count({ where: { agreementId: c.id } })).toBe(1);
  });

  it("asking to end early withdraws a queued automatic renewal", async () => {
    const d = await agreement();
    await runAutoRenewals(windowOpen);
    const [queued] = await renewals(d.id);
    await prisma.rentalAgreement.update({ where: { id: d.id }, data: { terminationRequestedAt: windowOpen, terminationEffectiveOn: effectiveOn } });
    const { cancelWithdrawnAutoRenewals } = await import("@/domains/agreements/auto-renew");
    await cancelWithdrawnAutoRenewals(null, d.id);
    expect((await get(queued.id)).status).toBe("CANCELLED");
  });
});
