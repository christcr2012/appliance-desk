import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
vi.mock("@/lib/session", () => ({
  requireRole: vi.fn().mockResolvedValue({ user: { id: "insights-fixture-owner", role: "OWNER" } }),
}));
import { prisma } from "@/lib/prisma";
import { getLeadInsights } from "@/domains/insights/customers";
import { businessMonthBounds } from "@/lib/business-date";

// AR-9 / LD-4: lead insights against fixed fixtures in a future month
// (2027-03) no other suite writes to, so the month windows are isolated.
let parsed: URL | null = null;
try { parsed = new URL(process.env.DATABASE_URL ?? ""); } catch { parsed = null; }
const enabled =
  process.env.CI === "true" && parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

const NOW = new Date("2027-03-15T18:00:00Z"); // mid-March in Denver
const { start: MONTH_START, end: MONTH_END } = businessMonthBounds(NOW);

describe.skipIf(!enabled)("lead insights (AR-9 / LD-4)", () => {
  const tag = randomUUID().slice(0, 8);
  const leadIds: string[] = [];
  const estimateIds: string[] = [];
  let ownerId: string;

  async function makeLead(data: Record<string, unknown>): Promise<string> {
    const lead = await prisma.lead.create({
      data: {
        contactName: `Insights fixture ${tag}`,
        phone: "5551234567",
        email: `insights-${tag}-${leadIds.length}@example.com`,
        howHeard: `Insights source ${tag}`,
        ...data,
      },
    });
    leadIds.push(lead.id);
    return lead.id;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const inMonth = (day: number, hour = 15) => new Date(Date.UTC(2027, 2, day, hour));
    // 12 leads created this month: 10 contacted for real (speeds 30..300
    // minutes), 1 with an ESTIMATED first contact (excluded from speed),
    // 1 never contacted.
    for (let i = 0; i < 10; i++) {
      const createdAt = inMonth(3 + i);
      await makeLead({
        createdAt,
        firstContactedAt: new Date(createdAt.getTime() + (30 + i * 30) * 60_000),
        firstContactEstimated: false,
      });
    }
    const estimatedAt = inMonth(14);
    await makeLead({ createdAt: estimatedAt, firstContactedAt: new Date(estimatedAt.getTime() + 10 * 60_000), firstContactEstimated: true });
    await makeLead({ createdAt: inMonth(15) });
    // Quotes sent for 6 of the 12 (the first six created).
    const created = await prisma.lead.findMany({
      where: { id: { in: leadIds } },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: { id: true },
    });
    for (const lead of created) {
      const estimate = await prisma.estimate.create({
        data: { leadId: lead.id, status: "SENT", title: `Insights quote ${tag}`, sentAt: inMonth(10), createdByUserId: ownerId },
      });
      estimateIds.push(estimate.id);
    }
    // 10 leads CLOSED this month (created earlier): 4 won, 6 lost.
    for (let i = 0; i < 10; i++) {
      await makeLead({
        createdAt: new Date(Date.UTC(2027, 0, 10)),
        status: i < 4 ? "CONVERTED" : "LOST",
        closedAt: inMonth(5 + i),
        lostReason: i < 4 ? null : i < 7 ? "Price" : "Went with someone else",
      });
    }
    // One merged-away lead created this month (excluded everywhere).
    const kept = await makeLead({ createdAt: inMonth(6) });
    await makeLead({ createdAt: inMonth(6), status: "LOST", mergedIntoLeadId: kept, mergedAt: inMonth(7), closedAt: inMonth(7) });
  });

  afterAll(async () => {
    await prisma.estimate.deleteMany({ where: { id: { in: estimateIds } } });
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("computes the month's figures from the fixtures", async () => {
    const insights = await getLeadInsights(NOW);
    const m = insights.thisMonth;
    expect(m.newLeads).toBe(13); // 12 + the kept lead; the merged one is out
    // Speeds 30,60,...,300 -> median (150+180)/2 = 165.
    expect(m.speedBaseCount).toBe(10);
    expect(m.speedToLeadMedianMinutes).toBe(165);
    expect(m.quotedCount).toBe(6);
    expect(m.quoteRate).toBeCloseTo(6 / 13, 5);
    expect(m.closedCount).toBe(10);
    expect(m.wonCount).toBe(4);
    expect(m.winRate).toBeCloseTo(0.4, 5);
    // Last month (February 2027) is empty in the fixtures.
    expect(insights.lastMonth.newLeads).toBe(0);
    expect(insights.lastMonth.winRate).toBeNull();
  });

  it("matches the leads-list count for the same period, sources and lost reasons", async () => {
    const insights = await getLeadInsights(NOW);
    const listCount = await prisma.lead.count({
      where: { createdAt: { gte: MONTH_START, lt: MONTH_END }, mergedIntoLeadId: null },
    });
    expect(insights.thisMonth.newLeads).toBe(listCount);
    const source = insights.bySource.find((r) => r.source === `Insights source ${tag}`);
    expect(source).toMatchObject({ leads: 24, won: 4 });
    expect(insights.topLostReasons).toHaveLength(2);
    expect(insights.topLostReasons).toEqual(
      expect.arrayContaining([
        { reason: "Price", count: 3 },
        { reason: "Went with someone else", count: 3 },
      ]),
    );
    // Trend: 12 weeks ending the week of Mar 15; the March weeks hold the fixtures.
    expect(insights.trend).toHaveLength(12);
    const totalNew = insights.trend.reduce((s, w) => s + w.newLeads, 0);
    const totalWon = insights.trend.reduce((s, w) => s + w.wonLeads, 0);
    expect(totalNew).toBeGreaterThanOrEqual(13);
    expect(totalWon).toBe(4);
  });

  it("pipeline value grows by exactly the open quotes' monthly lines", async () => {
    const before = await getLeadInsights(NOW);
    const leadId = leadIds[0]!;
    const estimate = await prisma.estimate.create({
      data: {
        leadId, status: "VIEWED", title: `Pipeline ${tag}`, sentAt: new Date(), createdByUserId: ownerId,
        lineItems: { create: [{ description: "Washer", monthlyPriceCents: 4200 }, { description: "Dryer", monthlyPriceCents: 3800 }] },
      },
    });
    estimateIds.push(estimate.id);
    const after = await getLeadInsights(NOW);
    expect(after.pipelineValueCents - before.pipelineValueCents).toBe(8000);
  });
});
