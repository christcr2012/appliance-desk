import { businessDaysBetween, addBusinessDays, businessDayBounds } from "@/lib/business-date";
import { prisma } from "@/lib/prisma";
import { loadFilingPacket } from "./filing-packet";
import {
  taxAmendmentDueException,
  taxFilingNotReadyException,
  type ExceptionItem,
} from "@/domains/exceptions/rules";

export type TaxAmendmentAttention = {
  amendments: { rows: ExceptionItem[]; total: number };
  readiness: { rows: ExceptionItem[]; total: number };
};

/** OWNER/ADMIN-only callers. STAFF never invokes this query. */
export async function listTaxAmendmentAttention(now = new Date()): Promise<TaxAmendmentAttention> {
  const starts = await prisma.taxFilingAccount.findMany({
    where: { active: true, firstPeriodStart: { not: null } },
    select: { id: true, firstPeriodStart: true },
  });
  const [openAmendments, amendmentCount, periods] = await Promise.all([
    prisma.taxFilingAmendment.findMany({
      where: { status: "OPEN" },
      include: { period: { include: { filingAccount: { select: { name: true } } } } },
      orderBy: [{ detectedAt: "asc" }, { id: "asc" }],
      take: 50,
    }),
    prisma.taxFilingAmendment.count({ where: { status: "OPEN" } }),
    starts.length ? prisma.taxFilingPeriod.findMany({
      where: {
        status: "OPEN",
        AND: [
          { OR: starts.map(account => ({
            filingAccountId: account.id,
            periodStart: { gte: account.firstPeriodStart! },
          })) },
          { OR: [
            { periodEnd: { lt: businessDayBounds(now).start } },
            { dueOn: { lte: addBusinessDays(now, 5) } },
          ] },
        ],
      },
      include: { filingAccount: { select: { name: true } } },
      orderBy: [{ dueOn: "asc" }, { id: "asc" }],
      take: 12, // limit expensive packet calculations on every Today request
    }) : Promise.resolve([]),
  ]);
  const readiness: ExceptionItem[] = [];
  for (const period of periods) {
    // Closed periods stay visible when unready, even before the final week.
    // A not-yet-closed period only needs attention in its last five days.
    if (businessDaysBetween(now, period.dueOn) > 5 &&
        businessDayBounds(now).start <= period.periodEnd) continue;
    const result = await loadFilingPacket(period.id, now);
    if (result.status === "READY") continue;
    readiness.push(taxFilingNotReadyException({
      accountName: period.filingAccount.name,
      periodEnd: period.periodEnd,
      dueOn: period.dueOn,
      problems: result.problems,
      now,
    }));
  }
  return {
    amendments: {
      rows: openAmendments.map(row => taxAmendmentDueException({
        id: row.id, detectedAt: row.detectedAt,
        accountName: row.period.filingAccount.name,
        additionalTaxCents: row.additionalTaxCents,
      })),
      total: amendmentCount,
    },
    readiness: { rows: readiness, total: readiness.length },
  };
}
