// AR-9 (INSIGHTS section 4): Customers Insights reads — LD-4 (leads) and
// CU-3 (customers) plus today's Growth "worth a call" lists. OWNER and
// ADMIN only: every function refuses everyone else first, then reads.
// Numbers come only from recorded data; each figure's definition lives in
// the glossary (src/lib/glossary.ts) and the spec.
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessDateKey, businessDateTimeFromLocal, businessMonthBounds, businessWeekStart } from "@/lib/business-date";
import { businessMinutesBetween, hasAnyOpeningHours } from "@/lib/business-hours";
import { parseStoredClosures, parseStoredHours } from "@/domains/settings/profile-extras";
import { getLeadSourceBreakdown } from "@/domains/leads";
import { getLeadResponseDays } from "@/domains/leads/follow-up";
import { getRevenueDashboard, pastDueInvoiceWhere } from "@/domains/billing";
import { monthsSince } from "@/domains/growth/signals";
import {
  getChurnRiskCustomers, getPriceReviewAgreements, getReviewRequestCandidates, getWinBackLeads,
  type ChurnRiskRow, type PriceReviewRow, type ReviewRequestRow, type WinBackLeadRow,
} from "@/domains/growth";
import { MIN_LEADS, MIN_RENTALS } from "./thresholds";

/* ---------------------------------- leads ---------------------------------- */

export type LeadMonthInsights = {
  newLeads: number;
  /** Median business minutes to first contact; null until MIN_LEADS contacted leads. */
  speedToLeadMedianMinutes: number | null;
  speedBaseCount: number;
  quoteRate: number | null;
  quotedCount: number;
  winRate: number | null;
  closedCount: number;
  wonCount: number;
};

export type LeadInsights = {
  thisMonth: LeadMonthInsights;
  lastMonth: LeadMonthInsights;
  pipelineValueCents: number;
  bySource: { source: string; leads: number; won: number; winRate: number | null }[];
  topLostReasons: { reason: string; count: number }[];
  trend: { weekStart: Date; newLeads: number; wonLeads: number }[];
  /** LD-1's respond-within setting, in days (0 = the same day). */
  responseTargetDays: number;
  /** True when no opening hours are set, so speed counts around the clock. */
  aroundTheClock: boolean;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

async function leadMonth(
  bounds: { start: Date; end: Date },
  hours: ReturnType<typeof parseStoredHours>,
  closures: Set<string>,
): Promise<LeadMonthInsights> {
  const inMonth = { gte: bounds.start, lt: bounds.end };
  const [created, quoted, closed] = await Promise.all([
    prisma.lead.findMany({
      where: { createdAt: inMonth, mergedIntoLeadId: null },
      select: { id: true, createdAt: true, firstContactedAt: true, firstContactEstimated: true },
    }),
    prisma.estimate.findMany({
      where: { lead: { createdAt: inMonth, mergedIntoLeadId: null }, sentAt: { not: null } },
      select: { leadId: true },
      distinct: ["leadId"],
    }),
    prisma.lead.findMany({
      where: { closedAt: inMonth, mergedIntoLeadId: null },
      select: { status: true },
    }),
  ]);

  const speeds = created
    .filter((l) => l.firstContactedAt !== null && !l.firstContactEstimated)
    .map((l) => businessMinutesBetween(l.createdAt, l.firstContactedAt!, hours, closures));
  const wonCount = closed.filter((l) => l.status === "CONVERTED").length;
  return {
    newLeads: created.length,
    speedToLeadMedianMinutes: speeds.length >= MIN_LEADS ? median(speeds) : null,
    speedBaseCount: speeds.length,
    quoteRate: created.length >= MIN_LEADS ? quoted.length / created.length : null,
    quotedCount: quoted.length,
    winRate: closed.length >= MIN_LEADS ? wonCount / closed.length : null,
    closedCount: closed.length,
    wonCount,
  };
}

export async function getLeadInsights(now = new Date()): Promise<LeadInsights> {
  await requireRole("OWNER", "ADMIN");
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { hours: true, holidayClosures: true },
  });
  const hours = parseStoredHours(settings?.hours);
  const closures = new Set(parseStoredClosures(settings?.holidayClosures).map((c) => c.date));

  const thisBounds = businessMonthBounds(now);
  const lastBounds = businessMonthBounds(new Date(thisBounds.start.getTime() - 1));
  const [thisMonth, lastMonth, responseTargetDays, breakdown, lostGroups, openQuotes] = await Promise.all([
    leadMonth({ start: thisBounds.start, end: thisBounds.end }, hours, closures),
    leadMonth({ start: lastBounds.start, end: lastBounds.end }, hours, closures),
    getLeadResponseDays(),
    getLeadSourceBreakdown(),
    prisma.lead.groupBy({
      by: ["lostReason"],
      where: {
        status: "LOST",
        mergedIntoLeadId: null,
        closedAt: { gte: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000) },
      },
      _count: true,
    }),
    prisma.estimate.findMany({
      where: { leadId: { not: null }, status: { in: ["SENT", "VIEWED", "CHANGES_REQUESTED", "APPROVED"] } },
      select: { lineItems: { select: { monthlyPriceCents: true } } },
    }),
  ]);

  const bySourceAll = breakdown.map((row) => ({
    source: row.source,
    leads: row.total,
    won: row.converted,
    winRate: row.total >= MIN_LEADS ? row.conversionRate : null,
  }));
  const bySource = bySourceAll.slice(0, 8);
  if (bySourceAll.length > 8) {
    const rest = bySourceAll.slice(8);
    const leads = rest.reduce((s, r) => s + r.leads, 0);
    const won = rest.reduce((s, r) => s + r.won, 0);
    bySource.push({ source: "Everything else", leads, won, winRate: leads >= MIN_LEADS ? won / leads : null });
  }

  const topLostReasons = lostGroups
    .map((g) => ({ reason: g.lostReason?.trim() || "No reason given", count: g._count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  // 12 Denver weeks, oldest first: new leads and won leads per week. Week
  // bounds come from Denver calendar dates, never fixed 168-hour offsets:
  // across a daylight-saving change a fixed offset lands an hour off
  // Monday midnight and shifts the midnight hour into the wrong week.
  const mondayKey = businessDateKey(businessWeekStart(now));
  const keyPlusDays = (key: string, days: number): string => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y!, m! - 1, d! + days)).toISOString().slice(0, 10);
  };
  const weekStartAt = (key: string): Date =>
    businessWeekStart(businessDateTimeFromLocal(`${key}T12:00`)!);
  const weekStarts: Date[] = [];
  for (let i = 11; i >= 0; i--) weekStarts.push(weekStartAt(keyPlusDays(mondayKey, -7 * i)));
  const nextWeekStart = weekStartAt(keyPlusDays(mondayKey, 7));
  const trend: LeadInsights["trend"] = [];
  for (let j = 0; j < 12; j++) {
    const weekStart = weekStarts[j]!;
    const weekEnd = j < 11 ? weekStarts[j + 1]! : nextWeekStart;
    const [newLeads, wonLeads] = await Promise.all([
      prisma.lead.count({ where: { createdAt: { gte: weekStart, lt: weekEnd }, mergedIntoLeadId: null } }),
      prisma.lead.count({
        where: { closedAt: { gte: weekStart, lt: weekEnd }, status: "CONVERTED", mergedIntoLeadId: null },
      }),
    ]);
    trend.push({ weekStart, newLeads, wonLeads });
  }

  return {
    thisMonth,
    lastMonth,
    pipelineValueCents: openQuotes.reduce(
      (sum, e) => sum + e.lineItems.reduce((s, l) => s + l.monthlyPriceCents, 0),
      0,
    ),
    bySource,
    topLostReasons,
    trend,
    responseTargetDays,
    aroundTheClock: !hasAnyOpeningHours(hours),
  };
}

/* -------------------------------- customers -------------------------------- */

export type CustomerInsights = {
  activeNow: number;
  activeAtMonthStart: number;
  change: number;
  newCustomers: number;
  lostCustomers: number;
  whyLost: { reason: string; count: number }[];
  avgMonthlyRentCents: number | null;
  avgLifetimeMonths: number | null;
  lifetimeBaseCount: number;
  avgCollectedPerCustomerCents: number | null;
  collectedBaseCount: number;
  autopayShare: number | null;
  payingLateShare: number | null;
  topCities: { city: string; count: number }[];
};

export async function getCustomerInsights(now = new Date()): Promise<CustomerInsights> {
  await requireRole("OWNER", "ADMIN");
  const { start: monthStart, end: monthEnd } = businessMonthBounds(now);

  const [activeRows, atStartRows, earliest, lostCandidates, revenue, activeAgreements] = await Promise.all([
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE" },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.rentalAgreement.findMany({
      where: {
        startDate: { lt: monthStart },
        OR: [{ closedAt: null }, { closedAt: { gte: monthStart } }],
        status: { notIn: ["DRAFT", "AWAITING_SIGNATURE", "SCHEDULED"] },
      },
      select: { customerId: true },
      distinct: ["customerId"],
    }),
    prisma.rentalAgreement.groupBy({ by: ["customerId"], _min: { startDate: true } }),
    prisma.rentalAgreement.findMany({
      where: { closedAt: { gte: monthStart, lt: monthEnd } },
      select: {
        id: true, customerId: true, status: true, closedAt: true, endDate: true,
        preDeliveryCancellation: { select: { agreementId: true } },
        invoices: { where: { status: "WRITTEN_OFF" }, select: { id: true }, take: 1 },
      },
      orderBy: { closedAt: "desc" },
    }),
    getRevenueDashboard(now),
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE" },
      select: { customerId: true, stripeSubscriptionId: true, serviceAddress: { select: { city: true } } },
    }),
  ]);

  const activeNow = activeRows.length;
  const activeIds = new Set(activeRows.map((r) => r.customerId));
  const newCustomers = earliest.filter(
    (g) => g._min.startDate !== null && g._min.startDate >= monthStart && g._min.startDate < monthEnd,
  ).length;

  // Lost: the customer's LAST closed agreement closed this month, and they
  // hold no ACTIVE or SCHEDULED agreement now.
  const stillActiveOrScheduled = new Set(
    (
      await prisma.rentalAgreement.findMany({
        where: { status: { in: ["ACTIVE", "SCHEDULED"] } },
        select: { customerId: true },
        distinct: ["customerId"],
      })
    ).map((r) => r.customerId),
  );
  const lastByCustomer = new Map<string, (typeof lostCandidates)[number]>();
  for (const row of lostCandidates) {
    if (!lastByCustomer.has(row.customerId)) lastByCustomer.set(row.customerId, row);
  }
  // EarlyReturnResolution has no Prisma relation to the agreement (an
  // agreementId scalar only), so its presence is looked up by id.
  const earlyReturnAgreementIds = new Set(
    (
      await prisma.earlyReturnResolution.findMany({
        where: { agreementId: { in: lostCandidates.map((r) => r.id) } },
        select: { agreementId: true },
      })
    ).map((r) => r.agreementId),
  );
  const whyCounts = new Map<string, number>();
  let lostCustomers = 0;
  for (const [customerId, agreement] of lastByCustomer) {
    // Only count them lost if this month's close is their latest close ever.
    const later = await prisma.rentalAgreement.count({
      where: { customerId, closedAt: { gt: agreement.closedAt! } },
    });
    if (later > 0 || stillActiveOrScheduled.has(customerId)) continue;
    lostCustomers += 1;
    const reason =
      agreement.status === "CANCELLED" && agreement.preDeliveryCancellation
        ? "Cancelled before delivery"
        : earlyReturnAgreementIds.has(agreement.id)
          ? "Ended early"
          : agreement.status === "ENDED" && agreement.endDate && agreement.closedAt! >= agreement.endDate
            ? "Rental finished"
            : agreement.invoices.length > 0
              ? "Stopped paying"
              : "Ended";
    whyCounts.set(reason, (whyCounts.get(reason) ?? 0) + 1);
  }

  // Average lifetime: customers with no ACTIVE/SCHEDULED agreement and at
  // least one closed agreement — first start to last close, in months.
  const spans = await prisma.rentalAgreement.groupBy({
    by: ["customerId"],
    _min: { startDate: true },
    _max: { closedAt: true },
  });
  const lifetimes: number[] = [];
  for (const span of spans) {
    if (stillActiveOrScheduled.has(span.customerId)) continue;
    if (span._min.startDate === null || span._max.closedAt === null) continue;
    lifetimes.push(monthsSince(span._min.startDate, span._max.closedAt));
  }
  const avgLifetimeMonths =
    lifetimes.length >= MIN_RENTALS
      ? Math.round((lifetimes.reduce((s, n) => s + n, 0) / lifetimes.length) * 10) / 10
      : null;

  // Collected per customer: receipts minus CASH refunds (the collectedBetween
  // rules — refunds kept as account credit are not money back out).
  const everActive = await prisma.rentalAgreement.findMany({
    where: { billingStartedAt: { not: null } },
    select: { customerId: true },
    distinct: ["customerId"],
  });
  const everActiveIds = new Set(everActive.map((r) => r.customerId));
  const [receiptSums, refunds] = await Promise.all([
    prisma.receipt.groupBy({ by: ["customerId"], _sum: { amountCents: true } }),
    prisma.refund.findMany({
      select: { id: true, amountCents: true, invoice: { select: { customerId: true } } },
    }),
  ]);
  const creditRefundIds = new Set(
    (
      await prisma.customerCredit.findMany({
        where: { sourceType: "REFUND_TO_CREDIT", sourceId: { in: refunds.map((r) => r.id) } },
        select: { sourceId: true },
      })
    ).map((c) => c.sourceId),
  );
  const netByCustomer = new Map<string, number>();
  for (const row of receiptSums) {
    netByCustomer.set(row.customerId, (netByCustomer.get(row.customerId) ?? 0) + (row._sum.amountCents ?? 0));
  }
  for (const refund of refunds) {
    if (creditRefundIds.has(refund.id)) continue;
    const customerId = refund.invoice.customerId;
    netByCustomer.set(customerId, (netByCustomer.get(customerId) ?? 0) - refund.amountCents);
  }
  const collectedValues = [...everActiveIds].map((id) => netByCustomer.get(id) ?? 0);
  const avgCollectedPerCustomerCents =
    collectedValues.length >= MIN_RENTALS
      ? Math.round(collectedValues.reduce((s, n) => s + n, 0) / collectedValues.length)
      : null;

  const autopayCustomers = new Set(
    activeAgreements.filter((a) => a.stripeSubscriptionId).map((a) => a.customerId),
  );
  const lateInvoices = activeIds.size
    ? await prisma.invoice.findMany({
        where: { ...pastDueInvoiceWhere(now), customerId: { in: [...activeIds] } },
        select: { customerId: true },
        distinct: ["customerId"],
      })
    : [];
  const cityCustomers = new Map<string, Set<string>>();
  for (const a of activeAgreements) {
    const city = a.serviceAddress?.city?.trim();
    if (!city) continue;
    const set = cityCustomers.get(city) ?? new Set<string>();
    set.add(a.customerId);
    cityCustomers.set(city, set);
  }

  return {
    activeNow,
    activeAtMonthStart: atStartRows.length,
    change: activeNow - atStartRows.length,
    newCustomers,
    lostCustomers,
    whyLost: [...whyCounts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    avgMonthlyRentCents: activeNow > 0 ? Math.round(revenue.mrrCents / activeNow) : null,
    avgLifetimeMonths,
    lifetimeBaseCount: lifetimes.length,
    avgCollectedPerCustomerCents,
    collectedBaseCount: collectedValues.length,
    autopayShare: activeNow >= MIN_RENTALS ? autopayCustomers.size / activeNow : null,
    payingLateShare: activeNow >= MIN_RENTALS ? lateInvoices.length / activeNow : null,
    topCities: [...cityCustomers.entries()]
      .map(([city, set]) => ({ city, count: set.size }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
  };
}

/* ------------------------------- worth a call ------------------------------ */

export type WorthACall = {
  churnRisk: (ChurnRiskRow & { phone: string | null })[];
  winBack: (WinBackLeadRow & { phone: string | null })[];
  priceReview: PriceReviewRow[];
  reviewCandidates: ReviewRequestRow[];
};

/** Today's Growth lists, unchanged functions and wording; the rows gain the
 * phone on file so the page can offer Call (tel:) where one exists. */
export async function getWorthACall(now = new Date()): Promise<WorthACall> {
  await requireRole("OWNER", "ADMIN");
  const [churnRisk, winBack, priceReview, reviewCandidates] = await Promise.all([
    getChurnRiskCustomers(now),
    getWinBackLeads(now),
    getPriceReviewAgreements(now),
    getReviewRequestCandidates(now),
  ]);
  const [customers, leads] = await Promise.all([
    churnRisk.length
      ? prisma.customer.findMany({
          where: { id: { in: churnRisk.map((r) => r.customerId) } },
          select: { id: true, phone: true },
        })
      : Promise.resolve([]),
    winBack.length
      ? prisma.lead.findMany({
          where: { id: { in: winBack.map((r) => r.leadId) } },
          select: { id: true, phone: true },
        })
      : Promise.resolve([]),
  ]);
  const customerPhones = new Map(customers.map((c) => [c.id, c.phone]));
  const leadPhones = new Map(leads.map((l) => [l.id, l.phone]));
  return {
    churnRisk: churnRisk.map((r) => ({ ...r, phone: customerPhones.get(r.customerId) ?? null })),
    winBack: winBack.map((r) => ({ ...r, phone: leadPhones.get(r.leadId) ?? null })),
    priceReview,
    reviewCandidates,
  };
}
