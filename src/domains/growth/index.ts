import { prisma } from "@/lib/prisma";
import { computeUtilizationFraction } from "@/domains/inventory/analytics";
import { computeChurnRisk, type ChurnRiskResult } from "./churn";
import {
  flagUtilization,
  isPriceReviewDue,
  isReviewRequestCandidate,
  monthsSince,
  winBackReason,
  type UtilizationFlag,
} from "./signals";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FAILED_PAYMENT_LOOKBACK_DAYS = 60;
const MAINTENANCE_LOOKBACK_DAYS = 90;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/** UTC-safe month math (same reasoning as computeMrrTrend's own
 * Date.UTC use in src/domains/billing/revenue.ts): a fixed-term
 * agreement's expected end date is startDate + termMonths. */
function addMonthsUtc(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

function customerDisplayName(customer: { user: { name: string | null; email: string } }): string {
  return customer.user.name ?? customer.user.email;
}

function countByCustomerId(rows: { customerId: string }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1);
  }
  return counts;
}

export type ChurnRiskRow = ChurnRiskResult & {
  agreementId: string;
  customerId: string;
  customerName: string;
};

/**
 * Customers whose ACTIVE agreement is showing one or more churn signals
 * (past-due invoices, recent failed payments, a term ending soon with no
 * renewal recorded, repeat repair requests) — see
 * src/domains/growth/churn.ts for the scoring itself. A customer with
 * more than one active agreement gets one row per agreement (rare —
 * mostly property managers), since each agreement's own term-end date is
 * independent even though past-due/failed-payment/repair counts are
 * shared across their account.
 */
export async function getChurnRiskCustomers(asOf: Date = new Date()): Promise<ChurnRiskRow[]> {
  const [agreements, pastDueInvoices, recentFailedPayments, recentMaintenanceRequests] =
    await Promise.all([
      prisma.rentalAgreement.findMany({
        where: { status: "ACTIVE" },
        select: {
          id: true,
          customerId: true,
          startDate: true,
          endDate: true,
          termMonths: true,
          customer: { select: { user: { select: { name: true, email: true } } } },
        },
      }),
      prisma.invoice.findMany({
        where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: asOf } },
        select: { customerId: true },
      }),
      prisma.payment.findMany({
        where: { status: "failed", createdAt: { gte: addDays(asOf, -FAILED_PAYMENT_LOOKBACK_DAYS) } },
        select: { invoice: { select: { customerId: true } } },
      }),
      prisma.maintenanceRequest.findMany({
        where: { openedAt: { gte: addDays(asOf, -MAINTENANCE_LOOKBACK_DAYS) } },
        select: { customerId: true },
      }),
    ]);

  const pastDueCounts = countByCustomerId(pastDueInvoices);
  const failedCounts = countByCustomerId(recentFailedPayments.map((p) => ({ customerId: p.invoice.customerId })));
  const maintenanceCounts = countByCustomerId(recentMaintenanceRequests);

  const rows = agreements.map((agreement) => {
    // The saved end date (set when billing starts, at delivery) is the real
    // end of the term; start + term months is only the fallback for agreements
    // that never recorded one.
    const termEnd =
      agreement.termMonths && agreement.startDate
        ? (agreement.endDate ?? addMonthsUtc(agreement.startDate, agreement.termMonths))
        : null;
    const daysUntilTermEnd =
      termEnd === null ? null : Math.round((termEnd.getTime() - asOf.getTime()) / MS_PER_DAY);

    const risk = computeChurnRisk({
      pastDueInvoiceCount: pastDueCounts.get(agreement.customerId) ?? 0,
      failedPaymentsRecentCount: failedCounts.get(agreement.customerId) ?? 0,
      daysUntilTermEnd,
      recentMaintenanceRequestCount: maintenanceCounts.get(agreement.customerId) ?? 0,
    });

    return {
      agreementId: agreement.id,
      customerId: agreement.customerId,
      customerName: customerDisplayName(agreement.customer),
      ...risk,
    };
  });

  return rows.filter((r) => r.atRisk).sort((a, b) => b.score - a.score);
}

export type WinBackLeadRow = {
  leadId: string;
  contactName: string;
  companyName: string | null;
  status: string;
  reason: string;
  updatedAt: Date;
};

/** Leads worth a follow-up — see src/domains/growth/signals.ts's
 * winBackReason for exactly when. */
export async function getWinBackLeads(asOf: Date = new Date()): Promise<WinBackLeadRow[]> {
  const leads = await prisma.lead.findMany({
    where: { status: { in: ["NEW", "CONTACTED", "LOST"] } },
    select: { id: true, status: true, contactName: true, companyName: true, updatedAt: true },
  });

  const rows = leads
    .map((lead) => {
      const reason = winBackReason(lead.status as "NEW" | "CONTACTED" | "LOST", lead.updatedAt, asOf);
      return reason ? { lead, reason } : null;
    })
    .filter((r): r is { lead: (typeof leads)[number]; reason: string } => r !== null)
    .map(({ lead, reason }) => ({
      leadId: lead.id,
      contactName: lead.contactName,
      companyName: lead.companyName,
      status: lead.status,
      reason,
      updatedAt: lead.updatedAt,
    }));

  return rows.sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
}

export type PriceReviewRow = {
  agreementId: string;
  customerName: string;
  monthsAgo: number;
  monthlyTotalCents: number;
};

/** ACTIVE agreements whose agreed price hasn't been revisited in over a
 * year — a reminder only, never an automatic change (see
 * src/domains/growth/signals.ts's isPriceReviewDue). */
export async function getPriceReviewAgreements(asOf: Date = new Date()): Promise<PriceReviewRow[]> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", startDate: { not: null } },
    select: {
      id: true,
      startDate: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      lines: { select: { monthlyPriceCents: true } },
    },
  });

  return agreements
    .filter((a): a is typeof a & { startDate: Date } => a.startDate !== null && isPriceReviewDue(a.startDate, asOf))
    .map((a) => ({
      agreementId: a.id,
      customerName: customerDisplayName(a.customer),
      monthsAgo: monthsSince(a.startDate, asOf),
      monthlyTotalCents: a.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0),
    }))
    .sort((a, b) => b.monthsAgo - a.monthsAgo);
}

export type UtilizationFlagRow = {
  applianceTypeId: string;
  applianceTypeName: string;
  unitCount: number;
  averageUtilizationFraction: number;
  // Always SHORTAGE or UNDERUTILIZED here, never null — a row is only
  // ever constructed once flagUtilization() has already returned a
  // truthy flag (see the .filter(...) below), unlike the broader
  // UtilizationFlag type (which flagUtilization itself returns and
  // allows null for "nothing worth flagging").
  flag: NonNullable<UtilizationFlag>;
};

/** Appliance types running near-fully-rented (a shortage signal — idea
 * #3) or mostly idle (an overpriced/overstocked signal — idea #4). See
 * src/domains/growth/signals.ts's flagUtilization for the thresholds. */
export async function getUtilizationFlags(asOf: Date = new Date()): Promise<UtilizationFlagRow[]> {
  const types = await prisma.applianceType.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      appliances: {
        where: { archivedAt: null, status: { not: "RETIRED" } },
        select: {
          createdAt: true,
          assignments: { select: { assignedAt: true, unassignedAt: true } },
        },
      },
    },
  });

  const rows = types
    .map((type) => {
      const unitCount = type.appliances.length;
      if (unitCount === 0) {
        return null;
      }
      const totalFraction = type.appliances.reduce(
        (sum, appliance) => sum + computeUtilizationFraction(appliance.assignments, appliance.createdAt, asOf),
        0,
      );
      const averageUtilizationFraction = totalFraction / unitCount;
      const flag = flagUtilization(averageUtilizationFraction, unitCount);
      if (!flag) {
        return null;
      }
      return {
        applianceTypeId: type.id,
        applianceTypeName: type.name,
        unitCount,
        averageUtilizationFraction,
        flag,
      };
    })
    .filter((r): r is UtilizationFlagRow => r !== null);

  return rows.sort((a, b) => b.averageUtilizationFraction - a.averageUtilizationFraction);
}

export type ReviewRequestRow = {
  agreementId: string;
  customerId: string;
  customerName: string;
};

/** Customers whose rental has been billing cleanly for a while — a
 * reasonable moment to ask for a review or referral (idea #6). This only
 * picks candidates; nothing here sends anything automatically (see
 * docs/BUSINESS-RULES.md's "Growth signals" section). */
export async function getReviewRequestCandidates(asOf: Date = new Date()): Promise<ReviewRequestRow[]> {
  const [agreements, pastDueInvoices] = await Promise.all([
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", billingStartedAt: { not: null } },
      select: {
        id: true,
        customerId: true,
        billingStartedAt: true,
        customer: { select: { user: { select: { name: true, email: true } } } },
      },
    }),
    prisma.invoice.findMany({
      where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: asOf } },
      select: { customerId: true },
    }),
  ]);

  const pastDueCustomerIds = new Set(pastDueInvoices.map((i) => i.customerId));

  return agreements
    .filter((a) => isReviewRequestCandidate(a.billingStartedAt, pastDueCustomerIds.has(a.customerId), asOf))
    .map((a) => ({
      agreementId: a.id,
      customerId: a.customerId,
      customerName: customerDisplayName(a.customer),
    }));
}
