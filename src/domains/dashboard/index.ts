import { prisma } from "@/lib/prisma";
import { getApplianceCountsByStatus } from "@/domains/inventory";

/**
 * The real numbers shown on /desk/dashboard — replacing the Phase-1
 * placeholder. Deliberately simple counts (no revenue/billing numbers
 * yet, since Stripe billing doesn't exist until Phase 6) — see
 * docs/ROADMAP.md for what's still ahead.
 */
export async function getDashboardStats() {
  const [
    newLeadCount,
    highValueNewLeadCount,
    contactedLeadCount,
    convertedLeadCount,
    applianceStatusCounts,
    totalCustomers,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.lead.count({ where: { status: "NEW", isHighValue: true } }),
    prisma.lead.count({ where: { status: "CONTACTED" } }),
    prisma.lead.count({ where: { status: "CONVERTED" } }),
    getApplianceCountsByStatus(),
    prisma.customer.count(),
  ]);

  return {
    newLeadCount,
    highValueNewLeadCount,
    contactedLeadCount,
    convertedLeadCount,
    applianceStatusCounts,
    totalAppliances: Object.values(applianceStatusCounts).reduce(
      (a: number, b: number) => a + b,
      0,
    ),
    totalCustomers,
  };
}
