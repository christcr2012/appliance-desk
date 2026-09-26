import { prisma } from "@/lib/prisma";
import type { ApplianceStatus } from "@prisma/client";

type ApplianceStatusCounts = Record<ApplianceStatus, number>;

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
    applianceCountsByStatus,
    totalCustomers,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.lead.count({ where: { status: "NEW", isHighValue: true } }),
    prisma.lead.count({ where: { status: "CONTACTED" } }),
    prisma.lead.count({ where: { status: "CONVERTED" } }),
    prisma.appliance.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.customer.count(),
  ]);

  const applianceStatusCounts: ApplianceStatusCounts = {
    AVAILABLE: 0,
    RESERVED: 0,
    RENTED: 0,
    MAINTENANCE: 0,
    RETIRED: 0,
  };
  for (const row of applianceCountsByStatus) {
    applianceStatusCounts[row.status as ApplianceStatus] = row._count._all;
  }

  return {
    newLeadCount,
    highValueNewLeadCount,
    contactedLeadCount,
    convertedLeadCount,
    applianceStatusCounts,
    totalAppliances: Object.values(applianceStatusCounts).reduce(
      (a, b) => a + b,
      0,
    ),
    totalCustomers,
  };
}
