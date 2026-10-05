import { prisma } from "@/lib/prisma";
import { computeChurnRisk, type ChurnRiskResult } from "./churn";
import {
  isPriceReviewDue,
  isReviewRequestCandidate,
  monthsSince,
  winBackReason,
  type UtilizationFlag,
} from "./signals";
import { computeCustodyUtilization } from "./utilization";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const FAILED_PAYMENT_LOOKBACK_DAYS = 60;
const MAINTENANCE_LOOKBACK_DAYS = 90;
const MAX_GROWTH_ROWS = 100;

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

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
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_GROWTH_ROWS,
      }),
      prisma.invoice.findMany({
        where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: asOf } },
        select: { customerId: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: MAX_GROWTH_ROWS * 4,
      }),
      prisma.payment.findMany({
        where: { status: "failed", createdAt: { gte: addDays(asOf, -FAILED_PAYMENT_LOOKBACK_DAYS) } },
        select: { invoice: { select: { customerId: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: MAX_GROWTH_ROWS * 4,
      }),
      prisma.maintenanceRequest.findMany({
        where: { openedAt: { gte: addDays(asOf, -MAINTENANCE_LOOKBACK_DAYS) } },
        select: { customerId: true },
        orderBy: [{ openedAt: "desc" }, { id: "desc" }],
        take: MAX_GROWTH_ROWS * 4,
      }),
    ]);

  const pastDueCounts = countByCustomerId(pastDueInvoices);
  const failedCounts = countByCustomerId(recentFailedPayments.map((p) => ({ customerId: p.invoice.customerId })));
  const maintenanceCounts = countByCustomerId(recentMaintenanceRequests);

  const rows = agreements.map((agreement) => {
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

  return rows
    .filter((r) => r.atRisk)
    .sort((a, b) => b.score - a.score || a.agreementId.localeCompare(b.agreementId))
    .slice(0, MAX_GROWTH_ROWS);
}

export type WinBackLeadRow = {
  leadId: string;
  contactName: string;
  companyName: string | null;
  status: string;
  reason: string;
  lastActivityAt: Date;
};

export async function getWinBackLeads(asOf: Date = new Date()): Promise<WinBackLeadRow[]> {
  const leads = await prisma.lead.findMany({
    where: { status: { in: ["NEW", "CONTACTED", "LOST"] } },
    select: {
      id: true,
      status: true,
      contactName: true,
      companyName: true,
      createdAt: true,
      updatedAt: true,
      lastRealContactAt: true,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MAX_GROWTH_ROWS * 2,
  });

  const rows = leads
    .map((lead) => {
      const ordinaryActivity = lead.lastRealContactAt ?? lead.createdAt;
      const lastActivityAt =
        lead.status === "LOST" && lead.updatedAt.getTime() > ordinaryActivity.getTime()
          ? lead.updatedAt
          : ordinaryActivity;
      const reason = winBackReason(
        lead.status as "NEW" | "CONTACTED" | "LOST",
        lastActivityAt,
        asOf,
      );
      return reason ? { lead, reason, lastActivityAt } : null;
    })
    .filter((r): r is { lead: (typeof leads)[number]; reason: string; lastActivityAt: Date } => r !== null)
    .map(({ lead, reason, lastActivityAt }) => ({
      leadId: lead.id,
      contactName: lead.contactName,
      companyName: lead.companyName,
      status: lead.status,
      reason,
      lastActivityAt,
    }));

  return rows
    .sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime() || a.leadId.localeCompare(b.leadId))
    .slice(0, MAX_GROWTH_ROWS);
}

export type PriceReviewRow = {
  agreementId: string;
  customerName: string;
  monthsAgo: number;
  monthlyTotalCents: number;
};

export async function getPriceReviewAgreements(asOf: Date = new Date()): Promise<PriceReviewRow[]> {
  const agreements = await prisma.rentalAgreement.findMany({
    where: { status: "ACTIVE", startDate: { not: null } },
    select: {
      id: true,
      startDate: true,
      customer: { select: { user: { select: { name: true, email: true } } } },
      lines: { select: { monthlyPriceCents: true } },
    },
    orderBy: [{ startDate: "asc" }, { id: "asc" }],
    take: MAX_GROWTH_ROWS * 2,
  });

  return agreements
    .filter((a): a is typeof a & { startDate: Date } => a.startDate !== null && isPriceReviewDue(a.startDate, asOf))
    .map((a) => ({
      agreementId: a.id,
      customerName: customerDisplayName(a.customer),
      monthsAgo: monthsSince(a.startDate, asOf),
      monthlyTotalCents: a.lines.reduce((sum, line) => sum + line.monthlyPriceCents, 0),
    }))
    .sort((a, b) => b.monthsAgo - a.monthsAgo || a.agreementId.localeCompare(b.agreementId))
    .slice(0, MAX_GROWTH_ROWS);
}

export type UtilizationFlagRow = {
  applianceTypeId: string;
  applianceTypeName: string;
  unitCount: number;
  averageUtilizationFraction: number;
  currentUtilizationFraction: number;
  rolling30DayUtilizationFraction: number;
  observedDays: number;
  flag: NonNullable<UtilizationFlag>;
};

export async function getUtilizationFlags(asOf: Date = new Date()): Promise<UtilizationFlagRow[]> {
  const windowStart = addDays(asOf, -30);
  const types = await prisma.applianceType.findMany({
    where: { isActive: true },
    select: {
      id: true,
      name: true,
      appliances: {
        where: { archivedAt: null, status: { not: "RETIRED" } },
        select: {
          createdAt: true,
          custodyEpisodes: {
            where: {
              OR: [
                { closedAt: null },
                { endedOn: { gt: windowStart } },
              ],
            },
            select: { startedOn: true, endedOn: true, closedAt: true },
          },
        },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
  });

  return types
    .map((type) => {
      if (type.appliances.length === 0) return null;
      const utilization = computeCustodyUtilization(type.appliances, asOf);
      if (!utilization.flag) return null;
      return {
        applianceTypeId: type.id,
        applianceTypeName: type.name,
        unitCount: type.appliances.length,
        averageUtilizationFraction: utilization.rolling30DayUtilizationFraction,
        currentUtilizationFraction: utilization.currentUtilizationFraction,
        rolling30DayUtilizationFraction: utilization.rolling30DayUtilizationFraction,
        observedDays: utilization.observedDays,
        flag: utilization.flag,
      };
    })
    .filter((r): r is UtilizationFlagRow => r !== null)
    .sort(
      (a, b) =>
        b.rolling30DayUtilizationFraction - a.rolling30DayUtilizationFraction ||
        a.applianceTypeName.localeCompare(b.applianceTypeName) ||
        a.applianceTypeId.localeCompare(b.applianceTypeId),
    )
    .slice(0, MAX_GROWTH_ROWS);
}

export type ReviewRequestRow = {
  agreementId: string;
  customerId: string;
  customerName: string;
};

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
      orderBy: [{ billingStartedAt: "asc" }, { id: "asc" }],
      take: MAX_GROWTH_ROWS * 2,
    }),
    prisma.invoice.findMany({
      where: { status: { in: ["DELINQUENT", "OPEN"] }, dueDate: { lt: asOf } },
      select: { customerId: true },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: MAX_GROWTH_ROWS * 4,
    }),
  ]);

  const pastDueCustomerIds = new Set(pastDueInvoices.map((i) => i.customerId));

  return agreements
    .filter((a) => isReviewRequestCandidate(a.billingStartedAt, pastDueCustomerIds.has(a.customerId), asOf))
    .map((a) => ({
      agreementId: a.id,
      customerId: a.customerId,
      customerName: customerDisplayName(a.customer),
    }))
    .slice(0, MAX_GROWTH_ROWS);
}
