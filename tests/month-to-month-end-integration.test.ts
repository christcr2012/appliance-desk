import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stripeMock = vi.hoisted(() => ({
  update: vi.fn(),
  retrieve: vi.fn(),
  cancel: vi.fn(),
  state: new Map<string, number | null>(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripeClient: () => ({
    subscriptions: { update: stripeMock.update, retrieve: stripeMock.retrieve, cancel: stripeMock.cancel },
  }),
}));

import { prisma } from "@/lib/prisma";
import {
  getMonthToMonthEndQuote,
  quoteMonthToMonthEnd,
  requestMonthToMonthEnd,
} from "@/domains/agreements/month-to-month";
import { runDueTerminations } from "@/domains/agreements/termination-execution";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

const terms = { version: 1, noticeDays: 30, termsText: "t" };

describe("month-to-month ending date (pure)", () => {
  it("ends on the first billing anniversary on or after today plus the notice days", () => {
    const q = quoteMonthToMonthEnd(
      { nextBillingDate: new Date("2027-03-08T07:00:00Z"), terms },
      new Date("2027-03-01T18:00:00Z"),
    );
    expect(q.effectiveOn.toISOString()).toBe("2027-04-08T06:00:00.000Z");
    expect(q.lastBilledDay.toISOString()).toBe("2027-04-07T06:00:00.000Z");
    expect(q.feeCents).toBe(0);
  });

  it("an anniversary that falls exactly on the notice date counts", () => {
    const q = quoteMonthToMonthEnd(
      { nextBillingDate: new Date("2027-03-08T07:00:00Z"), terms },
      new Date("2027-02-06T18:00:00Z"),
    );
    expect(q.effectiveOn.toISOString()).toBe("2027-03-08T07:00:00.000Z");
  });

  it("mtm-end-dst: a request the day before the clocks change still lands on a Colorado midnight", () => {
    const q = quoteMonthToMonthEnd(
      { nextBillingDate: new Date("2026-02-08T07:00:00Z"), terms },
      new Date("2026-03-07T19:00:00Z"),
    );
    expect(q.effectiveOn.toISOString()).toBe("2026-04-08T06:00:00.000Z");
    expect(q.lastBilledDay.toISOString()).toBe("2026-04-07T06:00:00.000Z");
  });
});

describe.skipIf(!enabled)("a month-to-month rental can be ended online", () => {
  const tag = randomUUID().replaceAll("-", "");
  const version = 9000 + Math.floor(Math.random() * 900);
  const mk = (n: string) => ({ user: `mtm-${n}-u-${tag}`, customer: `mtm-${n}-c-${tag}`, address: `mtm-${n}-a-${tag}` });
  const A = mk("a");
  const B = mk("b");
  const ownerId = `mtm-owner-${tag}`;
  const ids: string[] = [];
  const nextBilling = new Date("2027-03-08T07:00:00Z");
  const requestAt = new Date("2027-03-01T18:00:00Z");
  const effective = new Date("2027-04-08T06:00:00Z");

  async function agreement(owner = A, data: { termMonths?: number | null } = {}) {
    const n = ids.length;
    const created = await prisma.rentalAgreement.create({
      data: {
        customerId: owner.customer,
        serviceAddressId: owner.address,
        status: "ACTIVE",
        termMonths: data.termMonths === undefined ? null : data.termMonths,
        startDate: new Date("2027-02-08T07:00:00Z"),
        firstDeliveredOn: new Date("2027-02-08T07:00:00Z"),
        nextBillingDate: nextBilling,
        monthToMonthTermsVersion: version,
        stripeSubscriptionId: `sub_${tag}_${n}`,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 3000, listPriceCents: 3000 }] },
      },
    });
    ids.push(created.id);
    return created;
  }
  const get = (id: string) => prisma.rentalAgreement.findUniqueOrThrow({ where: { id } });
  const customerActor = (owner = A) => ({ userId: owner.user, kind: "customer" as const });
  const ownerActor = { userId: ownerId, kind: "team" as const };

  beforeEach(() => {
    stripeMock.update.mockReset().mockImplementation(async (id: string, params?: { cancel_at?: number | "" }) => {
      if (params && params.cancel_at !== undefined) stripeMock.state.set(id, params.cancel_at === "" ? null : params.cancel_at);
      return { id };
    });
    stripeMock.retrieve.mockReset().mockImplementation(async (id: string) => ({
      id,
      status: "active",
      cancel_at: stripeMock.state.get(id) ?? null,
    }));
    stripeMock.cancel.mockReset().mockImplementation(async (id: string) => ({ id }));
  });

  beforeAll(async () => {
    await prisma.monthToMonthTermsVersion.create({ data: { version, noticeDays: 30, termsText: "Test terms." } });
    await prisma.user.create({ data: { id: ownerId, email: `${tag}-o@example.test`, name: "Owner", role: "OWNER", emailVerified: true } });
    for (const [o, name] of [[A, "A"], [B, "B"]] as const) {
      await prisma.user.create({ data: { id: o.user, email: `${tag}-${name}@example.test`, name, role: "CUSTOMER", emailVerified: true } });
      await prisma.customer.create({ data: { id: o.customer, userId: o.user, referralCode: `M${name}${tag.slice(0, 16)}` } });
      await prisma.serviceAddress.create({ data: { id: o.address, customerId: o.customer, line1: "1 Test St", city: "Greeley", zip: "80631" } });
    }
  });

  afterAll(async () => {
    const invoices = await prisma.invoice.findMany({ where: { agreementId: { in: ids } }, select: { id: true } });
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: ids } }, { entityId: { in: invoices.map((i) => i.id) } }] },
    });
    await prisma.subscriptionEndIntent.deleteMany({ where: { holderAgreementId: { in: ids } } });
    await prisma.providerOperation.deleteMany({ where: { subjectId: { in: ids } } });
    await prisma.invoice.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.consentRecord.deleteMany({ where: { customerId: { in: [A.customer, B.customer] } } });
    await prisma.rentalLine.deleteMany({ where: { agreementId: { in: ids } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: ids } } });
    await prisma.serviceAddress.deleteMany({ where: { id: { in: [A.address, B.address] } } });
    await prisma.customer.deleteMany({ where: { id: { in: [A.customer, B.customer] } } });
    await prisma.user.deleteMany({ where: { id: { in: [A.user, B.user, ownerId] } } });
    await prisma.monthToMonthTermsVersion.deleteMany({ where: { version } });
  });

  it("the customer ends it: nightly job ends it, no fee invoice, Stripe stops one second before", async () => {
    const a = await agreement();
    const quote = await getMonthToMonthEndQuote(a.id, requestAt);
    expect(quote?.effectiveOn.toISOString()).toBe(effective.toISOString());
    await requestMonthToMonthEnd(customerActor(), a.id, quote!, { now: requestAt });

    const requested = await get(a.id);
    expect(requested.status).toBe("ACTIVE");
    expect(requested.terminationEffectiveOn?.toISOString()).toBe(effective.toISOString());
    expect(requested.terminationFeeCents).toBe(0);
    expect(requested.terminationPolicyVersion).toBe(`mtm-v${version}`);
    expect(stripeMock.state.get(a.stripeSubscriptionId!)).toBe(Math.floor(effective.getTime() / 1000) - 1);
    expect(await prisma.consentRecord.count({ where: { customerId: A.customer, kind: "rental_end_request" } })).toBeGreaterThan(0);

    const before = await runDueTerminations(new Date("2027-04-07T12:00:00Z"));
    expect(before.needsReview.filter((n) => n.agreementId === a.id)).toEqual([]);
    expect((await get(a.id)).status).toBe("ACTIVE");

    const run = await runDueTerminations(new Date("2027-04-08T13:00:00Z"));
    expect(run.needsReview.filter((n) => n.agreementId === a.id)).toEqual([]);
    expect((await get(a.id)).status).toBe("ENDED");
    expect(await prisma.invoice.count({ where: { agreementId: a.id } })).toBe(0);
  });

  it("mtm-end-racing: two requests at once record one ending", async () => {
    const a = await agreement();
    const quote = (await getMonthToMonthEndQuote(a.id, requestAt))!;
    const results = await Promise.allSettled([
      requestMonthToMonthEnd(customerActor(), a.id, quote, { now: requestAt }),
      requestMonthToMonthEnd(customerActor(), a.id, quote, { now: requestAt }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: "agreement.month_to_month_end_requested" } })).toBe(1);
  });

  it("mtm-end-stale-quote: a quote that no longer matches is refused", async () => {
    const a = await agreement();
    const quote = (await getMonthToMonthEndQuote(a.id, requestAt))!;
    await expect(
      requestMonthToMonthEnd(customerActor(), a.id, { ...quote, noticeDays: 45 }, { now: requestAt }),
    ).rejects.toThrow(/numbers changed/i);
    expect((await get(a.id)).terminationRequestedAt).toBeNull();
  });

  it("mtm-end-owner-earlier-anniversary-needs-reason", async () => {
    const a = await agreement();
    const quote = (await getMonthToMonthEndQuote(a.id, requestAt))!;
    await expect(
      requestMonthToMonthEnd(ownerActor, a.id, quote, { earlierEffectiveOn: nextBilling, now: requestAt }),
    ).rejects.toThrow(/reason/i);
    await requestMonthToMonthEnd(ownerActor, a.id, quote, {
      earlierEffectiveOn: nextBilling,
      reason: "Customer already returned everything",
      now: requestAt,
    });
    expect((await get(a.id)).terminationEffectiveOn?.toISOString()).toBe(nextBilling.toISOString());
  });

  it("a customer cannot choose an earlier date", async () => {
    const a = await agreement();
    const quote = (await getMonthToMonthEndQuote(a.id, requestAt))!;
    await expect(
      requestMonthToMonthEnd(customerActor(), a.id, quote, { earlierEffectiveOn: nextBilling, reason: "please do it", now: requestAt }),
    ).rejects.toThrow(/only the business/i);
  });

  it("mtm-end-customer-cannot-end-another-customers-rental", async () => {
    const a = await agreement(A);
    const quote = (await getMonthToMonthEndQuote(a.id, requestAt))!;
    await expect(requestMonthToMonthEnd(customerActor(B), a.id, quote, { now: requestAt })).rejects.toThrow(
      /couldn't find that rental/i,
    );
    expect((await get(a.id)).terminationRequestedAt).toBeNull();
  });

  it("mtm-end-not-available-for-fixed-term", async () => {
    const a = await agreement(A, { termMonths: 12 });
    expect(await getMonthToMonthEndQuote(a.id, requestAt)).toBeNull();
    await expect(
      requestMonthToMonthEnd(
        customerActor(),
        a.id,
        quoteMonthToMonthEnd({ nextBillingDate: nextBilling, terms: { version, noticeDays: 30, termsText: "t" } }, requestAt),
        { now: requestAt },
      ),
    ).rejects.toThrow(/fixed term/i);
  });
});
