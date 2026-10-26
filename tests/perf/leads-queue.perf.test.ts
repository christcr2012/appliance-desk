import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { getLeadQueue, getLeadStageCounts } from "@/domains/leads/queue";
import { measuredMedian, PERF_ENABLED } from "./fixtures";

// LD-1: 50,000 leads in throwaway Postgres. List, counts and search each
// under 150 ms on the CI database; the measured times are printed by
// measuredMedian. Runs only in the Performance Baselines job (perf.yml).
const LEAD_COUNT = 50_000;

describe.skipIf(!PERF_ENABLED)("LD-1 50,000-lead queue capacity (isolated CI Postgres)", () => {
  // Letter-prefixed so the tag always takes the name-search path (an
  // all-digit tag would be read as a phone-number search and match nothing).
  const tag = `p${randomUUID().replaceAll("-", "").slice(0, 11)}`;
  const prefix = `ldq-${tag}-`;
  const now = new Date();

  beforeAll(async () => {
    await prisma.$executeRaw`
      INSERT INTO "Lead"
        ("id", "contactName", "phone", "phoneDigits", "status", "score",
         "scoreReasons", "isHighValue", "scoringPolicyVersion", "quantity",
         "createdAt", "updatedAt", "firstContactedAt", "nextFollowUpOn")
      SELECT ${prefix} || g::text,
        'Perf ' || ${tag} || ' ' || g,
        '555' || lpad(g::text, 7, '0'),
        '555' || lpad(g::text, 7, '0'),
        CASE WHEN g % 10 = 0 THEN 'LOST' WHEN g % 3 = 0 THEN 'CONTACTED' ELSE 'NEW' END::"LeadStatus",
        g % 100, '[]'::jsonb, false, 1, 1,
        TIMESTAMP '2026-01-01 00:00:00 UTC' + (g || ' minutes')::interval,
        TIMESTAMP '2026-01-01 00:00:00 UTC' + (g || ' minutes')::interval,
        CASE WHEN g % 3 = 0 THEN TIMESTAMP '2026-01-01 00:00:00 UTC' + (g || ' minutes')::interval ELSE NULL END,
        CASE WHEN g % 3 = 0 AND g % 5 = 0 THEN DATE '2026-10-20' ELSE NULL END
      FROM generate_series(1, ${LEAD_COUNT}) g
    `;
    expect(await prisma.lead.count({ where: { id: { startsWith: prefix } } })).toBe(LEAD_COUNT);
  }, 120_000);

  afterAll(async () => {
    await prisma.lead.deleteMany({ where: { id: { startsWith: prefix } } });
  }, 120_000);

  it("lists the first Next-up page under 150 ms", async () => {
    const result = await measuredMedian(
      "ld1-leads-queue-list",
      async () => getLeadQueue({ sort: "next-up", q: tag }, now),
      3,
      10,
    );
    expect(result.value.rows).toHaveLength(50);
    expect(result.ms).toBeLessThan(150);
  }, 60_000);

  it("counts all five stages under 150 ms", async () => {
    const result = await measuredMedian(
      "ld1-leads-queue-counts",
      async () => getLeadStageCounts({ q: tag }),
      3,
      10,
    );
    const total = Object.values(result.value).reduce((sum, n) => sum + n, 0);
    expect(total).toBe(LEAD_COUNT);
    expect(result.ms).toBeLessThan(150);
  }, 60_000);

  it("searches by phone digits under 150 ms", async () => {
    // A 10-digit string takes the phoneDigits path.
    const result = await measuredMedian(
      "ld1-leads-queue-search",
      async () => getLeadQueue({ sort: "newest", q: "5550001234" }, now),
      3,
      10,
    );
    expect(result.value.rows.length).toBeGreaterThan(0);
    expect(result.value.rows.every((r) => r.phone.includes("5550001234"))).toBe(true);
    expect(result.ms).toBeLessThan(150);
  }, 60_000);
});
