import { prisma } from "@/lib/prisma";
import { businessDateKey, businessMonthBounds } from "@/lib/business-date";
import { collectedBetween } from "@/domains/billing/collected";
import { getTaxWorkspaceOverview } from "@/domains/tax/workspace-overview";
import { lastCompletedMonth } from "./depreciation";
import { profitAndLoss } from "./reports";

// AR-7 (BOOKS-TAXES 1.1): the Books overview read model. Every number comes from the existing
// report functions — billed/spent/profit are profitAndLoss (accrual) for the Denver month,
// collected is collectedBetween — so the overview can never disagree with the Reports page.
// Roles match the rest of the Books family (OWNER/ADMIN/ACCOUNTANT, as ACCT-1 set them);
// owner-only actions stay gated in the pages, not here.
export type BooksMonthFigures = {
  billedCents: number;
  collectedCents: number;
  spentCents: number;
  profitCents: number;
};

export type BooksHome = {
  started: boolean;
  lastUpToDateAt: Date | null;
  problemCount: number;
  thisMonth: BooksMonthFigures;
  lastMonth: BooksMonthFigures;
  monthsToReview: string[];
  nextTaxDue: { label: string; dueOn: Date } | null;
  lastMonthKey: string;
  lastMonthProfitCents: number;
  assetCount: number;
  assetsNeedingPrice: number;
  accountantPackageMonth: string | null;
};

async function monthFigures(userId: string, monthStart: Date, monthEnd: Date, now: Date): Promise<BooksMonthFigures> {
  const from = businessDateKey(monthStart);
  // "This month so far": profitAndLoss refuses a range ending in the future, so the current
  // month runs through today; a finished month runs through its last day.
  const lastDay = businessDateKey(new Date(monthEnd.getTime() - 1));
  const today = businessDateKey(now);
  const to = lastDay < today ? lastDay : today;
  const through = monthEnd.getTime() < now.getTime() ? monthEnd : now;
  const [pnl, collected] = await Promise.all([
    profitAndLoss(userId, { from, to, basis: "ACCRUAL" }),
    collectedBetween(null, monthStart, through),
  ]);
  return {
    billedCents: pnl.summary.incomeCents,
    collectedCents: collected.netCents,
    spentCents: pnl.summary.expenseCents,
    profitCents: pnl.summary.netProfitCents,
  };
}

const EMPTY: BooksMonthFigures = { billedCents: 0, collectedCents: 0, spentCents: 0, profitCents: 0 };

export async function getBooksHome(
  actor: { id: string; role: string },
  now: Date = new Date(),
): Promise<BooksHome> {
  if (!["OWNER", "ADMIN", "ACCOUNTANT"].includes(actor.role)) {
    throw new Error("Books are limited to the owner, admins and the accountant.");
  }
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { booksStartDate: true, booksLastBroughtUpToDateAt: true, booksLastProblemCount: true },
  });
  if (!settings?.booksStartDate) {
    return {
      started: false, lastUpToDateAt: null, problemCount: 0,
      thisMonth: EMPTY, lastMonth: EMPTY, monthsToReview: [], nextTaxDue: null,
      lastMonthKey: lastCompletedMonth(now), lastMonthProfitCents: 0,
      assetCount: 0, assetsNeedingPrice: 0, accountantPackageMonth: null,
    };
  }

  const month = businessMonthBounds(now);
  const lastMonth = businessMonthBounds(new Date(month.start.getTime() - 1));
  const firstKey = businessDateKey(settings.booksStartDate).slice(0, 7);
  const lastKey = lastCompletedMonth(now);

  const [thisMonth, lastMonthFigures, periods, tax, assetCount, needingPrice] = await Promise.all([
    monthFigures(actor.id, month.start, month.end, now),
    monthFigures(actor.id, lastMonth.start, lastMonth.end, now),
    prisma.accountingPeriod.findMany({
      where: { periodKey: { gte: firstKey, lte: lastKey } },
      select: { periodKey: true, status: true, accountantSentAt: true },
      orderBy: { periodKey: "asc" },
    }),
    getTaxWorkspaceOverview(actor.id, now).catch(() => null),
    prisma.bookAsset.count(),
    // Missing purchase price uses the autopilot's own predicate (null or non-positive cost on an
    // unenrolled, not-retired appliance) — priced-but-unenrolled appliances are enrollment
    // candidates, not missing prices.
    prisma.appliance.count({ where: { status: { not: "RETIRED" }, bookAsset: { is: null }, OR: [{ acquisitionCostCents: null }, { acquisitionCostCents: { lte: 0 } }] } }),
  ]);

  // Months with no period row yet count as still to review once they have ended.
  const byKey = new Map(periods.map((p) => [p.periodKey, p]));
  const monthsToReview: string[] = [];
  for (let key = firstKey; key <= lastKey;) {
    if (byKey.get(key)?.status !== "CLOSED") monthsToReview.push(key);
    const [y, m] = key.split("-").map(Number) as [number, number];
    key = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  const lastPeriod = byKey.get(lastKey);
  const due = tax?.attention.find((a) => a.kind === "DUE" || a.kind === "OVERDUE") ?? null;

  return {
    started: true,
    lastUpToDateAt: settings.booksLastBroughtUpToDateAt,
    problemCount: settings.booksLastProblemCount,
    thisMonth,
    lastMonth: lastMonthFigures,
    monthsToReview,
    nextTaxDue: due ? { label: due.title, dueOn: due.sortAt } : null,
    lastMonthKey: lastKey,
    lastMonthProfitCents: lastMonthFigures.profitCents,
    assetCount,
    assetsNeedingPrice: needingPrice,
    accountantPackageMonth: lastPeriod?.accountantSentAt ? lastKey : null,
  };
}
