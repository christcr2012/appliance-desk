import type { Prisma, TaxFilingFrequency } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { allocateAcrossLines } from "@/domains/tax/allocate";
import { shopSaleFeeKeptOnReturnInTx } from "@/domains/tax/rdf-shop-sale";
import { isSuccessfulPaymentStatus } from "@/domains/billing/payment-status";
import {
  addCalendarDays,
  dueOnFor,
  endOfPeriod,
  legalDueOn,
  startOfContainingPeriod,
} from "@/domains/tax/filing-calendar";

/**
 * TFA-2 §8: filing-frequency advice.
 *
 * Colorado lets a sales-tax account file yearly or quarterly when its
 * average monthly state + state-collected tax stays under the rule-book
 * limits (`co.sales.frequency_thresholds`), and it can move an account to
 * more frequent filing on January 1 when the average passes them. The app
 * never changes the frequency itself: the monthly job records an advice
 * here, Today shows it, and the owner confirms with one tap after Colorado
 * agrees in Revenue Online. The confirm sets the account frequency, which
 * only future periods pick up; filed history is never rewritten.
 */

const FREQUENCY_RANK: Record<TaxFilingFrequency, number> = {
  ANNUAL: 1,
  QUARTERLY: 2,
  MONTHLY: 3,
};

export type FrequencyThresholds = {
  annualMaxMonthlyCents: number;
  quarterlyMaxMonthlyCents: number;
};

/** The most often an account may file at this average monthly tax. */
export function frequencyAllowedByAverage(
  averageMonthlyCents: number,
  thresholds: FrequencyThresholds,
): TaxFilingFrequency {
  if (averageMonthlyCents <= thresholds.annualMaxMonthlyCents) return "ANNUAL";
  if (averageMonthlyCents <= thresholds.quarterlyMaxMonthlyCents) return "QUARTERLY";
  return "MONTHLY";
}

const sumCents = (values: number[]): number => values.reduce((a, b) => a + b, 0);

function monthsSpanned(periodStart: Date, periodEnd: Date): number {
  const [startYear, startMonth] = businessDateKey(periodStart).split("-").map(Number);
  const [endYear, endMonth] = businessDateKey(periodEnd).split("-").map(Number);
  return (endYear! - startYear!) * 12 + (endMonth! - startMonth!) + 1;
}

/**
 * State-collected tax evidence dated inside [windowStart, windowEnd),
 * following the filing packet's own dating and allocation rules: on the
 * accrual basis an invoice's tax is dated by the invoice (provider
 * invoices by their issue date, local ones by creation); on the cash
 * basis it is spread across the actual receipts by the packet's
 * proportional allocation and dated by each receipt; refunds are dated
 * by their creation and allocated the same way, over a base that
 * excludes a delivery fee kept on a return. Returns the total and
 * whether any evidence was seen at all, or null when the evidence does
 * not reconcile (the packet would block on it too) — bad evidence means
 * no advice, never a guessed average.
 */
async function sumWindowStateTaxInTx(
  tx: Prisma.TransactionClient,
  account: { id: string; basis: string },
  windowStart: Date,
  windowEnd: Date,
): Promise<{ taxCents: number; sawEvidence: boolean } | null> {
  if (account.basis !== "CASH" && account.basis !== "ACCRUAL") return null;
  const inWindow = (d: Date) => d >= windowStart && d < windowEnd;
  let taxCents = 0;
  let sawEvidence = false;

  const lines = await tx.invoiceTaxLine.findMany({
    where: { jurisdiction: { filingAccountId: account.id } },
    include: {
      jurisdiction: true,
      invoice: {
        include: {
          payments: { include: { receipt: true } },
          refunds: true,
          taxLines: { select: { id: true, taxCents: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const seenInvoices = new Set<string>();
  for (const line of lines) {
    if (seenInvoices.has(line.invoiceId)) continue;
    seenInvoices.add(line.invoiceId);
    const invoice = line.invoice;
    if (invoice.status === "DRAFT" || invoice.status === "VOID") continue;
    const invoiceLines = lines.filter((l) => l.invoiceId === invoice.id);
    const counted = invoiceLines.filter(
      (l) => l.jurisdiction.administration === "STATE_COLLECTED",
    );
    if (!counted.length) continue;
    const allTaxLines = invoice.taxLines;
    const allTax = sumCents(allTaxLines.map((t) => t.taxCents));
    if (account.basis === "ACCRUAL") {
      const dated = invoice.stripeInvoiceId ? invoice.issuedAt : invoice.createdAt;
      if (invoice.stripeInvoiceId && !invoice.issuedAt) return null;
      if (!dated || !inWindow(dated)) continue;
      sawEvidence = true;
      for (const l of counted) taxCents += l.taxCents;
      continue;
    }
    // Cash basis: the packet's allocation, receipt by receipt.
    const amount = invoice.amountDueCents;
    if (amount <= 0) return null;
    const payments = invoice.payments
      .filter((p) => isSuccessfulPaymentStatus(p.status))
      .sort((a, b) => a.id.localeCompare(b.id));
    if (payments.some((p) => !p.receipt || p.amountCents <= 0)) return null;
    const totalPaid = sumCents(payments.map((p) => p.amountCents));
    if (totalPaid > amount || allTax < 0 || allTax > amount
      || allTaxLines.some((t) => t.taxCents < 0)) return null;
    const paidTax = allocateAcrossLines(totalPaid, [allTax, amount - allTax])[0]!;
    const weights = payments.map((p) => p.amountCents);
    for (const l of counted) {
      const taxIndex = allTaxLines.findIndex((t) => t.id === l.id);
      if (taxIndex < 0) return null;
      const linePaidTax = allocateAcrossLines(
        paidTax, allTaxLines.map((t) => t.taxCents),
      )[taxIndex]!;
      const shares = allocateAcrossLines(linePaidTax, weights);
      payments.forEach((payment, i) => {
        const receivedOn = payment.receipt!.receivedOn;
        if (!inWindow(receivedOn)) return;
        sawEvidence = true;
        taxCents += shares[i]!;
      });
    }
  }

  const refunds = await tx.refund.findMany({
    where: {
      createdAt: { gte: windowStart, lt: windowEnd },
      invoice: {
        taxLines: { some: { jurisdiction: { filingAccountId: account.id } } },
      },
    },
    include: {
      invoice: {
        include: {
          refunds: true,
          taxLines: { include: { jurisdiction: true } },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const refund of refunds) {
    const invoice = refund.invoice;
    const invoiceLines = invoice.taxLines;
    const totalTax = sumCents(invoiceLines.map((t) => t.taxCents));
    const keptFeeCents = await shopSaleFeeKeptOnReturnInTx(tx, invoice.id);
    const basisCents = invoice.amountDueCents - keptFeeCents;
    const allRefunds = [...invoice.refunds].sort((a, b) => a.id.localeCompare(b.id));
    const totalRefunds = sumCents(allRefunds.map((r) => r.amountCents));
    if (basisCents <= 0 || totalTax < 0 || totalTax > basisCents
      || totalRefunds <= 0 || totalRefunds > basisCents
      || invoiceLines.some((t) => t.taxCents < 0)) return null;
    const refundIndex = allRefunds.findIndex((r) => r.id === refund.id);
    if (refundIndex < 0) return null;
    sawEvidence = true;
    const weights = allRefunds.map((r) => r.amountCents);
    const totalTaxRefund = allocateAcrossLines(totalRefunds,
      [totalTax, basisCents - totalTax])[0]!;
    const perLineTax = allocateAcrossLines(totalTaxRefund, invoiceLines.map((t) => t.taxCents));
    invoiceLines.forEach((line, index) => {
      if (line.jurisdiction.filingAccountId !== account.id) return;
      if (line.jurisdiction.administration !== "STATE_COLLECTED") return;
      const tax = allocateAcrossLines(perLineTax[index]!, weights)[refundIndex]!;
      taxCents -= tax;
    });
  }
  return { taxCents, sawEvidence };
}

/**
 * Runs on the 1st of each month (filing less often can be raised any time)
 * and on any December day (more-often advice matters before Jan 1). At
 * most one advice per account per year per advised frequency. Returns how
 * many advice rows were created. Advice is advisory: a failure here must
 * never break the filing calendar, so problems resolve to 0.
 */
export async function computeFilingFrequencyAdvice(now: Date): Promise<number> {
  const [year, month, dayOfMonth] = businessDateKey(now).split("-").map(Number);
  const isDecember = month === 12;
  if (dayOfMonth !== 1 && !isDecember) return 0;
  let thresholds: FrequencyThresholds;
  try {
    thresholds = (await ruleAsOf<FrequencyThresholds>(
      "co.sales.frequency_thresholds", now,
    )).value;
  } catch {
    return 0;
  }
  const accounts = await prisma.taxFilingAccount.findMany({
    where: { active: true, kind: "SALES_RETURN", firstPeriodStart: { not: null } },
    select: { id: true, frequency: true, basis: true, firstPeriodStart: true },
    orderBy: [{ id: "asc" }],
  });
  if (!accounts.length) return 0;
  const windowStart = businessDateFromKey(
    `${year! - 1}-${String(month).padStart(2, "0")}-01`,
  )!;
  // The evidence window is the twelve calendar months ending with last
  // month. The average is computed from the dated evidence inside the
  // window itself — invoices, receipts and refunds carry their own
  // dates — never from whole filing periods prorated across the window
  // edges: proration assumes tax was earned evenly across a year, so a
  // yearly account's year-to-date total was shrunk a second time and
  // December advice came out low, and tax recorded in the current
  // December leaked into the next December's run (the review's case).
  const windowEnd = businessDateFromKey(
    `${year}-${String(month).padStart(2, "0")}-01`,
  )!;
  const yearStart = businessDateFromKey(`${year}-01-01`)!;
  let created = 0;
  for (const account of accounts) {
    const evidence = await prisma.$transaction((tx) =>
      sumWindowStateTaxInTx(tx, account, windowStart, windowEnd),
    ).catch(() => null);
    if (!evidence || !evidence.sawEvidence) continue;
    // The average is monthly over the window, counting only the months
    // since this account's first period when it is younger than the
    // window (a brand-new account is not diluted by months before it
    // existed, and a mature one is not flattered by quiet months).
    const windowLastDay = new Date(windowEnd.getTime() - 24 * 3600 * 1000);
    const firstStart = account.firstPeriodStart!;
    const divisorStart = firstStart > windowStart ? firstStart : windowStart;
    const months = Math.min(12, Math.max(1, monthsSpanned(divisorStart, windowLastDay)));
    const averageMonthlyCents = Math.floor(evidence.taxCents / months);
    const advised = frequencyAllowedByAverage(averageMonthlyCents, thresholds);
    if (advised === account.frequency) continue;
    // Filing more often is Colorado's January 1 move; only raise it in December.
    if (FREQUENCY_RANK[advised] > FREQUENCY_RANK[account.frequency] && !isDecember) continue;
    const existing = await prisma.filingFrequencyAdvice.findFirst({
      where: {
        filingAccountId: account.id,
        advisedFrequency: advised,
        computedOn: { gte: yearStart },
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.filingFrequencyAdvice.create({
      data: {
        filingAccountId: account.id,
        currentFrequency: account.frequency,
        advisedFrequency: advised,
        averageMonthlyCents,
        computedOn: now,
      },
    });
    created += 1;
  }
  return created;
}

/**
 * The owner's one-tap confirm (after Colorado agrees in Revenue Online):
 * sets the account frequency from the next period on and marks the advice
 * confirmed. Owner only; locks the advice and the account first.
 */
export async function confirmFilingFrequencyAdvice(
  actorUserId: string,
  adviceId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "FilingFrequencyAdvice" WHERE "id" = ${adviceId} FOR UPDATE`;
    const advice = await tx.filingFrequencyAdvice.findUniqueOrThrow({
      where: { id: adviceId },
    });
    if (advice.confirmedAt) return;
    await tx.$queryRaw`SELECT "id" FROM "TaxFilingAccount" WHERE "id" = ${advice.filingAccountId} FOR UPDATE`;
    const account = await tx.taxFilingAccount.findUniqueOrThrow({
      where: { id: advice.filingAccountId },
      select: { frequency: true, dueDayOfFollowingMonth: true },
    });
    await tx.taxFilingAccount.update({
      where: { id: advice.filingAccountId },
      data: { frequency: advice.advisedFrequency },
    });
    // Preserve filing coverage across the switch: period generation walks
    // the new frequency and skips any range that overlaps an existing
    // period, so if the last existing period ends in the middle of a
    // new-frequency period, the rest of that range would get no return at
    // all. Fill exactly that span with one transition period. When the
    // last period ends on a new-frequency boundary, generation proceeds
    // cleanly and no transition period is needed.
    const last = await tx.taxFilingPeriod.findFirst({
      where: { filingAccountId: advice.filingAccountId },
      orderBy: [{ periodEnd: "desc" }, { id: "desc" }],
      select: { periodEnd: true },
    });
    if (last) {
      const spanStartKey = addCalendarDays(businessDateKey(last.periodEnd), 1);
      const containingStart = startOfContainingPeriod(spanStartKey, advice.advisedFrequency);
      if (containingStart < spanStartKey) {
        const spanEndKey = endOfPeriod(containingStart, advice.advisedFrequency);
        const spanEnd = businessDateFromKey(spanEndKey)!;
        const dueOn = dueOnFor(spanEnd, account.dueDayOfFollowingMonth);
        await tx.taxFilingPeriod.create({
          data: {
            filingAccountId: advice.filingAccountId,
            periodStart: businessDateFromKey(spanStartKey)!,
            periodEnd: spanEnd,
            dueOn,
            legalDueOn: legalDueOn(dueOn),
          },
        });
      }
    }
    await tx.filingFrequencyAdvice.update({
      where: { id: adviceId },
      data: { confirmedAt: new Date(), confirmedByUserId: actorUserId },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: "tax.filing_frequency.confirmed",
        entityType: "TaxFilingAccount",
        entityId: advice.filingAccountId,
        oldValue: { frequency: account.frequency },
        newValue: { frequency: advice.advisedFrequency, adviceId },
      },
    });
  });
}
