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
    draftAgreementCount,
    awaitingSignatureCount,
    activeAgreementCount,
    upcomingJobCount,
    openMaintenanceRequestCount,
    staleReservationCount,
  ] = await Promise.all([
    prisma.lead.count({ where: { status: "NEW" } }),
    prisma.lead.count({ where: { status: "NEW", isHighValue: true } }),
    prisma.lead.count({ where: { status: "CONTACTED" } }),
    prisma.lead.count({ where: { status: "CONVERTED" } }),
    getApplianceCountsByStatus(),
    prisma.customer.count(),
    prisma.rentalAgreement.count({ where: { status: "DRAFT" } }),
    prisma.rentalAgreement.count({ where: { status: "AWAITING_SIGNATURE" } }),
    prisma.rentalAgreement.count({ where: { status: "ACTIVE" } }),
    prisma.job.count({ where: { status: "SCHEDULED" } }),
    prisma.maintenanceRequest.count({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
    }),
    // Phase 6A item 6 — draft/awaiting-signature agreements whose
    // reservation hold has expired (see src/domains/agreements/
    // reservation-status.ts's isReservationStale, which this mirrors
    // as a database-side filter for an efficient count).
    prisma.rentalAgreement.count({
      where: {
        status: { in: ["DRAFT", "AWAITING_SIGNATURE"] },
        reservationExpiresAt: { lt: new Date() },
      },
    }),
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
    draftAgreementCount,
    awaitingSignatureCount,
    activeAgreementCount,
    upcomingJobCount,
    openMaintenanceRequestCount,
    staleReservationCount,
  };
}
