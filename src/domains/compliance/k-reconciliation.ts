import { prisma } from "@/lib/prisma";
import { getTaxYearFacts } from "./tax-facts";

/**
 * CMP-2 — the 1099-K tie-out.
 *
 * Stripe sends the business a Form 1099-K whose box 1a is the year's
 * gross card charges. The books hold every Stripe balance transaction
 * (synced nightly into StripeBalanceTransaction), so the tie-out is a
 * read of stored rows — no live Stripe call. Charges are compared with
 * the 1099-K amount the owner typed from the form (TaxYearFacts); fees,
 * refunds and disputes are shown as the explaining items between gross
 * charges and the net that reached the bank.
 */

export interface KTransactionRow {
  createdAtStripe: Date;
  reportingCategory: string;
  amountCents: number;
  feeCents: number;
  netCents: number;
}

export interface KMonth {
  month: string; // "2026-03" (UTC, as Stripe timestamps its rows)
  chargesCents: number;
  feesCents: number;
  refundsCents: number;
  disputesCents: number;
  otherCents: number;
  netCents: number;
}

export interface KTieOut {
  year: number;
  months: KMonth[];
  chargesCents: number;
  feesCents: number;
  refundsCents: number;
  disputesCents: number;
  otherCents: number;
  netCents: number;
  /** The 1099-K box 1a the owner typed, or null when it has not been entered. */
  reportedGrossCents: number | null;
  /** Books charges minus the typed 1099-K gross; null when not entered. */
  differenceCents: number | null;
}

/** Bucket one row by its Stripe reporting category. Pure: unit-tested. */
export function bucketOf(reportingCategory: string): "charges" | "refunds" | "disputes" | "other" {
  if (reportingCategory === "charge") return "charges";
  if (reportingCategory === "refund") return "refunds";
  if (reportingCategory === "dispute" || reportingCategory === "dispute_reversal") return "disputes";
  return "other";
}

export function summarizeKTransactions(rows: KTransactionRow[], year: number): Omit<KTieOut, "reportedGrossCents" | "differenceCents"> {
  const byMonth = new Map<string, KMonth>();
  const blank = (month: string): KMonth => ({
    month, chargesCents: 0, feesCents: 0, refundsCents: 0, disputesCents: 0, otherCents: 0, netCents: 0,
  });
  for (const row of rows) {
    const key = row.createdAtStripe.toISOString().slice(0, 7);
    if (!key.startsWith(`${year}-`)) continue;
    const month = byMonth.get(key) ?? blank(key);
    const bucket = bucketOf(row.reportingCategory);
    if (bucket === "charges") month.chargesCents += row.amountCents;
    else if (bucket === "refunds") month.refundsCents += row.amountCents;
    else if (bucket === "disputes") month.disputesCents += row.amountCents;
    else month.otherCents += row.amountCents;
    month.feesCents += row.feeCents;
    month.netCents += row.netCents;
    byMonth.set(key, month);
  }
  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
  const total = blank(`${year}`);
  for (const m of months) {
    total.chargesCents += m.chargesCents;
    total.feesCents += m.feesCents;
    total.refundsCents += m.refundsCents;
    total.disputesCents += m.disputesCents;
    total.otherCents += m.otherCents;
    total.netCents += m.netCents;
  }
  return {
    year,
    months,
    chargesCents: total.chargesCents,
    feesCents: total.feesCents,
    refundsCents: total.refundsCents,
    disputesCents: total.disputesCents,
    otherCents: total.otherCents,
    netCents: total.netCents,
  };
}

export async function compute1099KTieOut(year: number): Promise<KTieOut> {
  const rows = await prisma.stripeBalanceTransaction.findMany({
    where: { createdAtStripe: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } },
    select: { createdAtStripe: true, reportingCategory: true, amountCents: true, feeCents: true, netCents: true },
  });
  const summary = summarizeKTransactions(rows, year);
  const facts = await getTaxYearFacts(year);
  const reportedGrossCents = facts?.form1099KGrossCents ?? null;
  return {
    ...summary,
    reportedGrossCents,
    differenceCents: reportedGrossCents === null ? null : summary.chargesCents - reportedGrossCents,
  };
}
