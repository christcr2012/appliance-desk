// PLAN scenario 11 (BATCH-F WU-F3): a fixed term ends into month-to-month. Billing carries on under the SAME subscription (no
// second agreement for the money, no new subscription), then the customer ends it online with the notice the terms require. The
// ending date is a Colorado billing anniversary, the unscheduled pickup visit is created once, Stripe is told to stop one second
// before that date, nothing is charged for ending, and the rental ends on the date. Another customer cannot end it.
// The "Automatic renewals" master switch is turned ON inside this test only and restored afterwards. Stripe is faked.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({ update: vi.fn(), retrieve: vi.fn(), cancel: vi.fn(), create: vi.fn(), state: new Map<string, number | null>() }));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({ subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel, create: stripeMock.create } }),
}));
vi.mock("@/lib/customer-email", () => ({ sendCustomerEmail: async () => ({ sent: false, outcome: "NOT_ATTEMPTED" }) }));

import { prisma } from "@/lib/prisma";
import { runAutoRenewals, extendBillingForDeliveredAutoRenewals } from "@/domains/agreements/auto-renew";
import { startRenewalIfDue } from "@/domains/agreements/renewal-start";
import { getMonthToMonthEndQuote, requestMonthToMonthEnd } from "@/domains/agreements/month-to-month";
import { runDueTerminations } from "@/domains/agreements/termination-execution";
import { renewalReminderKey } from "@/domains/notices/renewal-reminder";
import { cancelAtSecondsFor } from "@/domains/billing/subscription-term";
import { purgeScenarioQueues } from "../helpers/scenario-order";
const scenarioStartedAt = new Date();

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

const termEnd = new Date("2027-11-08T06:59:59Z");
const windowOpen = new Date("2027-10-20T12:00:00Z");
const afterTerm = new Date("2027-11-09T12:00:00Z");
const snapshot = { shape: 1, source: "SYSTEM", capturedAt: "2026-11-01T00:00:00Z", termination: null, autoRenew: { noticeDays: 30, termsText: "Renews month to month.", termsVersion: "sc11" } };

describe.skipIf(!enabled)("scenario 11: month-to-month continuation and ending online", () => {
  const tag = randomUUID().replaceAll("-", "");
  const mk = (n: string) => ({ user: `sc11-${n}-u-${tag}`, customer: `sc11-${n}-c-${tag}`, address: `sc11-${n}-a-${tag}` });
  const A = mk("a");
  const B = mk("b");
  const ids: string[] = [];
  let switchBefore = false;
  let createdTerms: number | null = null;

  beforeEach(() => {
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({ id, status: "active", cancel_at: stripeMock.state.get(id) ?? null }));
    stripeMock.cancel.mockReset().mockImplementation(async (id: string) => ({ id }));
    stripeMock.create.mockReset().mockRejectedValue(new Error("a continuation must never create a second subscription"));
  });
  beforeAll(async () => {
    switchBefore = (await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { autoRenewEnabled: true } }))?.autoRenewEnabled === true;
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: true } });
    if ((await prisma.monthToMonthTermsVersion.count()) === 0) {
      createdTerms = 9500 + Math.floor(Math.random() * 400);
      await prisma.monthToMonthTermsVersion.create({ data: { version: createdTerms, noticeDays: 30, termsText: "Scenario terms." } });
    }
    for (const [o, name] of [[A, "A"], [B, "B"]] as const) {
      await prisma.user.create({ data: { id: o.user, email: `${tag}-${name}@example.test`, name: `SC11 ${name}`, role: "CUSTOMER", emailVerified: true } });
      await prisma.customer.create({ data: { id: o.customer, userId: o.user, referralCode: `T${name}${tag.slice(0, 16)}` } });
      await prisma.serviceAddress.create({ data: { id: o.address, customerId: o.customer, line1: "11 Scenario St", city: "Greeley", zip: "80631" } });
    }
  });
  afterAll(async () => {
    await purgeScenarioQueues(scenarioStartedAt);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { autoRenewEnabled: switchBefore } });
    const made = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: { in: ids } }, select: { id: true } });
    const all = [...ids, ...made.map((r) => r.id)];
    const invoices = await prisma.invoice.findMany({ where: { agreementId: { in: all } }, select: { id: true } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: all } }, { entityId: { in: invoices.map((i) => i.id) } }] } });
    await prisma.subscriptionEndIntent.deleteMany({ where: { holderAgreementId: { in: all } } });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: all } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.customerNotice.deleteMany({ where: { customerId: { in: [A.customer, B.customer] } } });
    await prisma.consentRecord.deleteMany({ where: { customerId: { in: [A.customer, B.customer] } } });
    await prisma.job.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: all } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: made.map((r) => r.id) } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [A.address, B.address] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [A.customer, B.customer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [A.user, B.user] } } });
    if (createdTerms !== null) await prisma.monthToMonthTermsVersion.deleteMany({ where: { version: createdTerms } });
  });

  it("the term ends into month-to-month on the same subscription, then the customer ends it online on the quoted date", async () => {
    const original = await prisma.rentalAgreement.create({
      data: {
        customerId: A.customer, serviceAddressId: A.address, status: "ACTIVE", termMonths: 12, startDate: new Date("2026-11-08T07:00:00Z"), endDate: termEnd,
        firstDeliveredOn: new Date("2026-11-08T07:00:00Z"), nextBillingDate: new Date("2027-12-08T07:00:00Z"), stripeSubscriptionId: `sub_sc11_${tag}`,
        renewalPreference: "AUTO_RENEW", autoRenewConsentedAt: new Date("2026-11-08T08:00:00Z"), autoRenewTermsVersion: "sc11", termsSnapshot: snapshot,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 }, { label: "Dryer", monthlyPriceCents: 3000, listPriceCents: 3000 }] },
      },
    });
    ids.push(original.id);
    stripeMock.state.set(original.stripeSubscriptionId!, cancelAtSecondsFor(original));

    // Term end: the reminder was delivered inside its window, billing is carried on, and the renewal takes over.
    await runAutoRenewals(windowOpen);
    await prisma.customerNotice.update({ where: { dedupeKey: renewalReminderKey(original.id, termEnd) }, data: { status: "SENT", sentAt: new Date("2027-10-10T15:00:00Z"), sentVia: "HAND: scenario" } });
    await extendBillingForDeliveredAutoRenewals(windowOpen);
    expect(stripeMock.state.get(original.stripeSubscriptionId!)).toBeNull();
    const [renewal] = await prisma.rentalAgreement.findMany({ where: { renewedFromAgreementId: original.id } });
    expect((await startRenewalIfDue(renewal.id, afterTerm)).started).toBe(true);

    const continued = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id }, include: { lines: true } });
    expect(continued).toMatchObject({ status: "ACTIVE", termMonths: null, stripeSubscriptionId: original.stripeSubscriptionId });
    expect(continued.lines.map((l) => l.monthlyPriceCents).sort()).toEqual([3000, 3000]);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: original.id } })).status).toBe("ENDED");
    // Billing continued without a second agreement for the subscription and without touching Stripe's subscription list.
    expect(await prisma.rentalAgreement.count({ where: { stripeSubscriptionId: original.stripeSubscriptionId!, status: "ACTIVE" } })).toBe(1);
    expect(stripeMock.create).not.toHaveBeenCalled();
    expect(stripeMock.cancel).not.toHaveBeenCalled();

    // Another customer cannot end this rental.
    const requestAt = new Date("2027-11-20T18:00:00Z");
    const quote = (await getMonthToMonthEndQuote(renewal.id, requestAt))!;
    expect(quote).not.toBeNull();
    await expect(requestMonthToMonthEnd({ userId: B.user, kind: "customer" }, renewal.id, quote, { now: requestAt })).rejects.toThrow(/couldn't find that rental/i);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).terminationRequestedAt).toBeNull();

    // The customer ends it online. The date respects the notice days and falls on a billing anniversary at Colorado midnight.
    const earliest = requestAt.getTime() + quote.noticeDays * 86_400_000;
    expect(quote.effectiveOn.getTime()).toBeGreaterThanOrEqual(earliest - 86_400_000);
    expect(quote.feeCents).toBe(0);
    await requestMonthToMonthEnd({ userId: A.user, kind: "customer" }, renewal.id, quote, { now: requestAt });
    const requested = await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } });
    expect(requested.status).toBe("ACTIVE");
    expect(requested.terminationEffectiveOn?.toISOString()).toBe(quote.effectiveOn.toISOString());
    expect(requested.terminationFeeCents).toBe(0);
    expect(await prisma.consentRecord.count({ where: { customerId: A.customer, kind: "rental_end_request" } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityId: renewal.id, action: "agreement.month_to_month_end_requested" } })).toBe(1);
    // The draft pickup exists once and is unscheduled; Stripe was told to stop one second before the ending date.
    expect(await prisma.job.findMany({ where: { agreementId: renewal.id, type: "REMOVAL" }, select: { status: true, scheduledAt: true } })).toEqual([{ status: "SCHEDULED", scheduledAt: null }]);
    expect(stripeMock.state.get(original.stripeSubscriptionId!)).toBe(Math.floor(quote.effectiveOn.getTime() / 1000) - 1);
    expect(await prisma.subscriptionEndIntent.findUniqueOrThrow({ where: { stripeSubscriptionId: original.stripeSubscriptionId! } })).toMatchObject({ mode: "END_AT", holderAgreementId: renewal.id });

    // Day before: still running. On the date: ended, nothing charged for ending, subscription never cancelled early.
    expect((await runDueTerminations(new Date(quote.effectiveOn.getTime() - 86_400_000))).needsReview.filter((n) => n.agreementId === renewal.id)).toEqual([]);
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("ACTIVE");
    await runDueTerminations(new Date(quote.effectiveOn.getTime() + 7 * 3_600_000));
    expect((await prisma.rentalAgreement.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("ENDED");
    expect(await prisma.invoice.count({ where: { agreementId: renewal.id } })).toBe(0);
    expect(stripeMock.create).not.toHaveBeenCalled();
  });
});
