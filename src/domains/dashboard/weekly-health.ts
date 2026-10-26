// AR-0b: the three numbers in Today's health strip (docs/build-specs/screens/TODAY.md section 2). Owners and admins only.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessWeekStart } from "@/lib/business-date";
import { collectedBetween } from "@/domains/billing/collected";
import { pastDueInvoiceWhere } from "@/domains/billing/bill-status";
import { getApplianceCountsByStatus } from "@/domains/inventory";

export type WeeklyHealth = { moneyInCents: number; outRenting: number; rentableTotal: number; overdueBills: number };

export async function getWeeklyHealth(now = new Date()): Promise<WeeklyHealth> {
  await requireRole("OWNER", "ADMIN");
  const weekStart = businessWeekStart(now);
  const [collected, counts, overdueBills] = await Promise.all([
    // A week that started this very instant has collected nothing yet (collectedBetween needs a real period).
    weekStart < now ? collectedBetween(null, weekStart, now) : Promise.resolve({ netCents: 0 }),
    getApplianceCountsByStatus(),
    prisma.invoice.count({ where: pastDueInvoiceWhere(now) }),
  ]);
  const rentableTotal = Object.entries(counts).reduce((sum, [status, n]) => (status === "RETIRED" ? sum : sum + n), 0);
  return {
    moneyInCents: collected.netCents,
    outRenting: counts.RENTED + counts.AWAITING_PICKUP,
    rentableTotal,
    overdueBills,
  };
}
