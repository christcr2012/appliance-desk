import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "insights-fixture-owner", role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getCustomerInsights } from "@/domains/insights/customers";
import { getRevenueDashboard } from "@/domains/billing";

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

  it("average rent is the dashboard MRR over active customers, rounded to cents", async () => {
    const [insights, dashboard] = await Promise.all([getCustomerInsights(NOW), getRevenueDashboard(NOW)]);
    expect(insights.avgMonthlyRentCents).toBe(Math.round(dashboard.mrrCents / insights.activeNow));
  });
});
