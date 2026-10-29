import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "insights-fixture-owner", role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getCustomerInsights } from "@/domains/insights/customers";
import { MIN_RENTALS } from "@/domains/insights/thresholds";
import { businessMonthBounds } from "@/lib/business-date";

// AR-9 / CU-3: customer insights against fixed fixtures (March 2027, a
// month no other suite writes to). Global all-time figures are checked for
// consistency with the underlying reads rather than absolute values.
let parsed: URL | null = null;
try { parsed = new URL(process.env.DATABASE_URL ?? ""); } catch { parsed = null; }
const enabled =
  process.env.CI === "true" && parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

const NOW = new Date("2027-03-15T18:00:00Z");
const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 15));

describe.skipIf(!enabled)("customer insights (AR-9 / CU-3)", () => {
  const tag = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const customerIds: string[] = [];
  const agreementIds: string[] = [];

  async function makeCustomer(i: number): Promise<string> {
    const user = await prisma.user.create({
      data: { name: `Insights customer ${tag} ${i}`, email: `cust-${tag}-${i}@example.com`, role: "CUSTOMER" },
    });
    userIds.push(user.id);
    const customer = await prisma.customer.create({ data: { userId: user.id, referralCode: `${tag}${i}`.slice(0, 20) } });
    customerIds.push(customer.id);
    return customer.id;
  }

  async function makeAgreement(customerId: string, data: Record<string, unknown>): Promise<string> {
    const address = await prisma.serviceAddress.create({
      data: { customerId, line1: "1 Fixture Way", city: "Greeley", zip: "80631" },
    });
    const agreement = await prisma.rentalAgreement.create({
      data: { customerId, serviceAddressId: address.id, status: "ACTIVE", startDate: utc(2027, 1, 10), ...data },
    });
    agreementIds.push(agreement.id);
    return agreement.id;
  }

  beforeAll(async () => {
    // Two active customers (one on autopay), both in Greeley. A started in
    // January; B started this month (a "new customer" for March).
    const a = await makeCustomer(0);
    await makeAgreement(a, { stripeSubscriptionId: `sub_${tag}`, billingStartedAt: utc(2027, 1, 10) });
    const b = await makeCustomer(1);
    await makeAgreement(b, { startDate: utc(2027, 3, 2), billingStartedAt: utc(2027, 3, 2) });
    // A customer who left because the rental finished.
    const c = await makeCustomer(2);
    await makeAgreement(c, { status: "ENDED", startDate: utc(2026, 3, 1), endDate: utc(2027, 3, 1), closedAt: utc(2027, 3, 5), billingStartedAt: utc(2026, 3, 1) });
    // A customer who cancelled before delivery.
    const d = await makeCustomer(3);
    const cancelledId = await makeAgreement(d, { status: "CANCELLED", startDate: utc(2027, 2, 20), closedAt: utc(2027, 3, 8) });
    const ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    await prisma.preDeliveryCancellation.create({
      data: {
        agreementId: cancelledId, policy: "standard", signedAmountCents: 5000, refundDueCents: 5000,
        retainedCents: 0, reason: "Changed mind", reviewedTerms: true, approvedByUserId: ownerId, refundState: "REFUNDED",
      },
    });
    // Receipts for the two active customers (collected-per-customer inputs).
    await prisma.receipt.create({ data: { customerId: a, amountCents: 12000, source: "MANUAL", method: "card", receivedOn: utc(2027, 3, 2) } });
    await prisma.receipt.create({ data: { customerId: b, amountCents: 6000, source: "MANUAL", method: "card", receivedOn: utc(2027, 3, 3) } });
    // A prepaid customer: paid in full in advance, so recurring billing
    // never started — still a customer who has had a rental, with money
    // collected (PR #745 review finding).
    const e = await makeCustomer(4);
    await makeAgreement(e, { paidInFullInAdvance: true, startDate: utc(2027, 1, 20) });
    await prisma.receipt.create({ data: { customerId: e, amountCents: 3000, source: "MANUAL", method: "card", receivedOn: utc(2027, 3, 4) } });
    // A renewal pair: the old agreement ended in March when the renewal
    // started and took over the subscription (the old row's
    // stripeSubscriptionId is cleared by the renewal, as in production).
    const f = await makeCustomer(5);
    const oldId = await makeAgreement(f, {
      status: "ENDED", startDate: utc(2026, 11, 1), endDate: utc(2027, 3, 10),
      closedAt: utc(2027, 3, 10), billingStartedAt: utc(2026, 11, 1), stripeSubscriptionId: null,
    });
    await makeAgreement(f, {
      startDate: utc(2027, 3, 10), billingStartedAt: utc(2027, 3, 10),
      stripeSubscriptionId: `sub_renew_${tag}`, renewedFromAgreementId: oldId,
    });
    // Five more plain January starters: they lift the February cohort and
    // the ever-had set past the MIN_RENTALS gate on fixture customers
    // alone, so the prepaid and renewal assertions below discriminate
    // regardless of what else shares the test database.
    for (let i = 6; i <= 10; i++) {
      const extra = await makeCustomer(i);
      await makeAgreement(extra, { startDate: utc(2027, 1, 15), billingStartedAt: utc(2027, 1, 15) });
    }
  });

  afterAll(async () => {
    await prisma.preDeliveryCancellation.deleteMany({ where: { agreementId: { in: agreementIds } } });
    await prisma.receipt.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("counts actives, new and lost customers with derived reasons", async () => {
    const insights = await getCustomerInsights(NOW);
    expect(insights.activeNow).toBeGreaterThanOrEqual(2);
    expect(insights.newCustomers).toBeGreaterThanOrEqual(1); // B's first rental started in March
    expect(insights.change).toBe(insights.activeNow - insights.activeAtMonthStart);
    expect(insights.lostCustomers).toBeGreaterThanOrEqual(2);
    const reasons = new Map(insights.whyLost.map((r) => [r.reason, r.count]));
    expect(reasons.get("Rental finished")).toBeGreaterThanOrEqual(1);
    expect(reasons.get("Cancelled before delivery")).toBeGreaterThanOrEqual(1);
    const greeley = insights.topCities.find((c) => c.city === "Greeley");
    expect(greeley?.count).toBeGreaterThanOrEqual(2);
  });

  it("average rent is the period-end cohort's line rent over its customers, rounded to cents", async () => {
    const insights = await getCustomerInsights(NOW);
    // Independent recomputation of the cohort rule for NOW's month:
    // agreements started before the month's end and not closed before
    // it (pre-active statuses excluded), rent summed from their lines.
    // (Not the revenue dashboard: its MRR reads today's ACTIVE set,
    // which mixes periods — the bug Codex caught on PR #740.)
    const { end } = businessMonthBounds(NOW);
    const cohort = await prisma.rentalAgreement.findMany({
      where: {
        startDate: { lt: end },
        OR: [{ closedAt: null }, { closedAt: { gte: end } }],
        status: { notIn: ["DRAFT", "AWAITING_SIGNATURE", "SCHEDULED"] },
      },
      select: { lines: { select: { monthlyPriceCents: true } } },
    });
    const cohortRent = cohort.reduce(
      (sum, a) => sum + a.lines.reduce((lineSum, l) => lineSum + l.monthlyPriceCents, 0),
      0,
    );
    expect(insights.avgMonthlyRentCents).toBe(Math.round(cohortRent / insights.activeNow));
  });

  it("collected per customer includes prepaid rentals in the ever-had cohort", async () => {
    const insights = await getCustomerInsights(NOW);
    // Independent recomputation: the ever-had-a-rental customer set is
    // recurring-billing starters PLUS started prepaid agreements (minus
    // pre-delivery cancellations); the average is their net collected
    // (receipts minus refunds not kept as credit) over that set.
    const everHad = await prisma.rentalAgreement.findMany({
      where: {
        OR: [
          { billingStartedAt: { not: null } },
          {
            paidInFullInAdvance: true,
            startDate: { lte: NOW },
            status: { notIn: ["DRAFT", "AWAITING_SIGNATURE", "SCHEDULED"] },
          },
        ],
        preDeliveryCancellation: { is: null },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    });
    const ids = everHad.map((r) => r.customerId);
    const [receiptSums, refunds] = await Promise.all([
      prisma.receipt.groupBy({ by: ["customerId"], _sum: { amountCents: true } }),
      prisma.refund.findMany({ select: { id: true, amountCents: true, invoice: { select: { customerId: true } } } }),
    ]);
    const creditIds = new Set(
      (
        await prisma.customerCredit.findMany({
          where: { sourceType: "REFUND_TO_CREDIT", sourceId: { in: refunds.map((r) => r.id) } },
          select: { sourceId: true },
        })
      ).map((c) => c.sourceId),
    );
    const net = new Map<string, number>();
    for (const row of receiptSums) net.set(row.customerId, row._sum.amountCents ?? 0);
    for (const refund of refunds) {
      if (creditIds.has(refund.id)) continue;
      net.set(refund.invoice.customerId, (net.get(refund.invoice.customerId) ?? 0) - refund.amountCents);
    }
    const values = ids.map((id) => net.get(id) ?? 0);
    const expected =
      values.length >= MIN_RENTALS ? Math.round(values.reduce((s, n) => s + n, 0) / values.length) : null;
    expect(insights.avgCollectedPerCustomerCents).toBe(expected);
  });

  it("autopay share for a past month keeps members whose subscription moved to a renewal", async () => {
    // February 2027 view: the fixture renewal started in March, so at
    // February's end the cohort holds the OLD agreement — whose
    // subscription id the renewal has since taken over.
    const febNow = new Date("2027-02-15T18:00:00Z");
    const insights = await getCustomerInsights(febNow);
    const { end } = businessMonthBounds(febNow);
    const cohort = await prisma.rentalAgreement.findMany({
      where: {
        startDate: { lt: end },
        OR: [{ closedAt: null }, { closedAt: { gte: end } }],
        status: { notIn: ["DRAFT", "AWAITING_SIGNATURE", "SCHEDULED"] },
      },
      select: { id: true, customerId: true, stripeSubscriptionId: true },
    });
    const cohortCustomers = new Set(cohort.map((a) => a.customerId));
    const autopay = new Set(cohort.filter((a) => a.stripeSubscriptionId).map((a) => a.customerId));
    const withoutSub = cohort.filter((a) => !a.stripeSubscriptionId).map((a) => a.id);
    if (withoutSub.length > 0) {
      const renewals = await prisma.rentalAgreement.findMany({
        where: {
          renewedFromAgreementId: { in: withoutSub },
          stripeSubscriptionId: { not: null },
          status: { notIn: ["DRAFT", "AWAITING_SIGNATURE", "SCHEDULED"] },
        },
        select: { customerId: true },
      });
      for (const r of renewals) autopay.add(r.customerId);
    }
    const expected =
      cohortCustomers.size >= MIN_RENTALS ? autopay.size / cohortCustomers.size : null;
    expect(insights.autopayShare).toBe(expected);
  });
});
