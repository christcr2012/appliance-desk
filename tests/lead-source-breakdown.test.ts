import { afterAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getLeadSourceBreakdown, type LeadSourceBreakdownRow } from "@/domains/leads";

// AR-9 (INSIGHTS section 1): getLeadSourceBreakdown now runs one groupBy.
// This proves the grouped version returns exactly what the old
// load-every-lead version returned, on the same table contents.
let parsed: URL | null = null;
try { parsed = new URL(process.env.DATABASE_URL ?? ""); } catch { parsed = null; }
const enabled =
  process.env.CI === "true" && parsed !== null &&
  ["localhost", "127.0.0.1"].includes(parsed.hostname) &&
  parsed.pathname === "/appliance_desk_test";

/** The pre-AR-9 implementation, kept here as the reference. */
async function referenceBreakdown(): Promise<LeadSourceBreakdownRow[]> {
  const leads = await prisma.lead.findMany({ select: { howHeard: true, status: true } });
  const groups = new Map<string, { total: number; converted: number }>();
  for (const lead of leads) {
    const source = lead.howHeard?.trim() || "Not given";
    const group = groups.get(source) ?? { total: 0, converted: 0 };
    group.total += 1;
    if (lead.status === "CONVERTED") group.converted += 1;
    groups.set(source, group);
  }
  return [...groups.entries()]
    .map(([source, { total, converted }]) => ({
      source,
      total,
      converted,
      conversionRate: total > 0 ? converted / total : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

describe.skipIf(!enabled)("lead source breakdown: grouped query (AR-9)", () => {
  const tag = randomUUID().slice(0, 8);
  const leadIds: string[] = [];

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { in: leadIds } } });
  });

  it("matches the old in-memory output and folds trim/blank variants together", async () => {
    const source = `Source ${tag}`;
    const variants: Array<{ howHeard: string | null; status: "NEW" | "CONVERTED" | "LOST" }> = [
      { howHeard: source, status: "NEW" },
      { howHeard: ` ${source} `, status: "CONVERTED" },
      { howHeard: source, status: "CONVERTED" },
      { howHeard: source, status: "LOST" },
    ];
    for (const [i, v] of variants.entries()) {
      const lead = await prisma.lead.create({
        data: {
          contactName: `Breakdown fixture ${tag} ${i}`,
          phone: "5551234567",
          email: `breakdown-${tag}-${i}@example.com`,
          howHeard: v.howHeard,
          status: v.status,
        },
      });
      leadIds.push(lead.id);
    }
    const [grouped, reference] = await Promise.all([getLeadSourceBreakdown(), referenceBreakdown()]);
    expect(grouped).toEqual(reference);
    const row = grouped.find((r) => r.source === source);
    expect(row).toMatchObject({ total: 4, converted: 2, conversionRate: 0.5 });
  });
});
