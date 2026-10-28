// AR-3 (MONEY-AREA 1): the Money › Overview numbers — read-only. Every figure reuses the rule the existing
// screens already use, so the Overview can never disagree with them: collected money comes from
// collectedBetween (receipts minus cash refunds), owed and past-due from the shared bill rules, and the
// failed count from the revenue dashboard's own where clause (failedPaymentsWhere).
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import { businessMonthBounds } from "@/lib/business-date";
import { rentForNextBill } from "@/domains/portal/next-bill";
import { billOwedWhere, pastDueInvoiceWhere } from "./bill-status";
import { collectedBetween } from "./collected";
import { failedPaymentsWhere } from "./payment-status";
import { revenuePeriod } from "./revenue";

export type MoneyOverview = {
  collectedThisMonthCents: number;
  collectedLastMonthCents: number;
  owedNowCents: number;
  openBillCount: number;
  pastDueCents: number;
  pastDueCount: number;
  expectedNext30Cents: number;
  failedThisMonth: number;
};

const DAY_MS = 86_400_000;
const owedOf = (rows: { amountDueCents: number; amountPaidCents: number }[]) =>
  rows.reduce((sum, row) => sum + Math.max(0, row.amountDueCents - row.amountPaidCents), 0);

export async function getMoneyOverview(now = new Date()): Promise<MoneyOverview> {
  await requireRole("OWNER", "ADMIN");
  const month = businessMonthBounds(now);
  const lastMonth = businessMonthBounds(new Date(month.start.getTime() - 1));
  // collectedBetween works on [from, to); "this month" runs from the month's start to now.
  const thisMonthEnd = now.getTime() > month.start.getTime() ? now : new Date(month.start.getTime() + 1);

  const [thisMonth, lastMonthCollected, owedRows, pastDueRows, upcoming, failedThisMonth] = await Promise.all([
    collectedBetween(null, month.start, thisMonthEnd),
    collectedBetween(null, lastMonth.start, lastMonth.end),
    prisma.invoice.findMany({
      where: billOwedWhere(now),
      select: { amountDueCents: true, amountPaidCents: true },
    }),
    prisma.invoice.findMany({
      where: pastDueInvoiceWhere(now),
      select: { amountDueCents: true, amountPaidCents: true },
    }),
    prisma.rentalAgreement.findMany({
      where: { status: "ACTIVE", nextBillingDate: { gte: now, lt: new Date(now.getTime() + 30 * DAY_MS) } },
      select: { lines: { select: { monthlyPriceCents: true } } },
    }),
    prisma.payment.count({ where: failedPaymentsWhere(revenuePeriod(now, true)) }),
  ]);

  return {
    collectedThisMonthCents: thisMonth.netCents,
    collectedLastMonthCents: lastMonthCollected.netCents,
    owedNowCents: owedOf(owedRows),
    openBillCount: owedRows.length,
    pastDueCents: owedOf(pastDueRows),
    pastDueCount: pastDueRows.length,
    expectedNext30Cents: upcoming.reduce((sum, agreement) => sum + rentForNextBill(agreement.lines), 0),
    failedThisMonth,
  };
}
