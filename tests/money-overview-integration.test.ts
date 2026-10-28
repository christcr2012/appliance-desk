import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ requireRole: vi.fn().mockResolvedValue({ user: { id: "owner", role: "OWNER" } }) }));

import { prisma } from "@/lib/prisma";
import { getMoneyOverview } from "@/domains/billing/money-overview";
import { getRevenueDashboard } from "@/domains/billing/index";

let target: URL | null = null;
try {
  target = new URL(process.env.DATABASE_URL ?? "");
} catch {
  target = null;
}
const enabled =
  process.env.CI === "true" &&
  target !== null &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

// AR-3 (MONEY-AREA 1): the overview is business-wide, so figures are asserted as deltas around this suite's
// own fixtures, all placed against one fixed "now" in November 2026 (a month no real-time fixture lands in).
describe.skipIf(!enabled)("Money overview reads", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const now = new Date("2026-11-15T18:00:00Z"); // Nov 15, 11:00 in Denver
  const userId = `mo-u-${tag}`;
  const customerId = `mo-c-${tag}`;
  let baseline: Awaited<ReturnType<typeof getMoneyOverview>>;

  beforeAll(async () => {
    baseline = await getMoneyOverview(now);
    await prisma.user.create({ data: { id: userId, email: `mo-${tag}@example.test`, name: `Overview ${tag}`, role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `MO${tag}`.slice(0, 30) } });
    const owed = await prisma.invoice.create({
      data: { customerId, status: "OPEN", dueDate: new Date("2026-11-20T12:00:00Z"), amountDueCents: 7000, amountPaidCents: 2000 },
    });
    await prisma.invoice.create({
      data: { customerId, status: "DELINQUENT", dueDate: new Date("2026-11-10T12:00:00Z"), amountDueCents: 9000, amountPaidCents: 0 },
    });
    await prisma.payment.create({
      data: { invoiceId: owed.id, amountCents: 2000, method: "card", status: "failed", createdAt: new Date("2026-11-05T12:00:00Z") },
    });
    const address = await prisma.serviceAddress.create({
      data: { customerId, line1: "1 Overview Way", city: "Greeley", zip: "80631" },
    });
    const mkAgreement = async (nextBillingDate: Date, rentCents: number[], status: "ACTIVE" | "DRAFT" = "ACTIVE") => {
      const agreement = await prisma.rentalAgreement.create({
        data: { customerId, serviceAddressId: address.id, status, termMonths: 12, nextBillingDate },
      });
      for (const [i, monthlyPriceCents] of rentCents.entries()) {
        await prisma.rentalLine.create({ data: { agreementId: agreement.id, label: `Line ${i}`, monthlyPriceCents } });
      }
    };
    await mkAgreement(new Date(now.getTime() + 29 * 86_400_000), [3000, 500]); // day 29: in
    await mkAgreement(new Date(now.getTime() + 30 * 86_400_000), [9900]); // day 30: out
    await mkAgreement(new Date(now.getTime() + 1 * 86_400_000), [1000]); // tomorrow: in
    await mkAgreement(new Date(now.getTime() + 5 * 86_400_000), [7700], "DRAFT"); // not active: out
  });

  afterAll(async () => {
    await prisma.receipt.deleteMany({ where: { customerId } });
    await prisma.payment.deleteMany({ where: { invoice: { customerId } } });
    await prisma.invoice.deleteMany({ where: { customerId } });
    await prisma.rentalAgreement.deleteMany({ where: { customerId } });
    await prisma.serviceAddress.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("owed, past due, expected and failed come from the shared rules", async () => {
    const overview = await getMoneyOverview(now);
    expect(overview.owedNowCents - baseline.owedNowCents).toBe(5000 + 9000);
    expect(overview.openBillCount - baseline.openBillCount).toBe(2);
    expect(overview.pastDueCents - baseline.pastDueCents).toBe(9000);
    expect(overview.pastDueCount - baseline.pastDueCount).toBe(1);
    expect(overview.expectedNext30Cents - baseline.expectedNext30Cents).toBe(3500 + 1000);
    expect(overview.failedThisMonth - baseline.failedThisMonth).toBe(1);
    // The overview's failed count is the revenue dashboard's own number for the same moment.
    const dashboard = await getRevenueDashboard(now);
    expect(overview.failedThisMonth).toBe(dashboard.failedPaymentsThisMonth);
  });

  it("collected money follows Denver month bounds, across the November DST change", async () => {
    const before = await getMoneyOverview(now);
    const receipt = (receivedOn: string, amountCents: number) =>
      prisma.receipt.create({ data: { customerId, source: "MANUAL", method: "cash", amountCents, receivedOn: new Date(receivedOn) } });
    await receipt("2026-11-10T12:00:00Z", 10000); // this month
    await receipt("2026-11-01T06:00:00Z", 2222); // Nov 1, 00:00 in Denver (still MDT): this month
    await receipt("2026-11-01T05:59:59Z", 1111); // Oct 31, 23:59:59 in Denver: last month
    await receipt("2026-10-20T12:00:00Z", 4000); // last month
    const after = await getMoneyOverview(now);
    expect(after.collectedThisMonthCents - before.collectedThisMonthCents).toBe(10000 + 2222);
    expect(after.collectedLastMonthCents - before.collectedLastMonthCents).toBe(1111 + 4000);
  });
});
