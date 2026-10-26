import type { TaxFilingFrequency } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey, businessDayBounds } from "@/lib/business-date";
import { ruleAsOf } from "@/domains/rules/reads";
import { loadFilingPacketInTx } from "@/domains/tax/filing-packet";

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

function monthsSpanned(periodStart: Date, periodEnd: Date): number {
  const [startYear, startMonth] = businessDateKey(periodStart).split("-").map(Number);
  const [endYear, endMonth] = businessDateKey(periodEnd).split("-").map(Number);
  return (endYear! - startYear!) * 12 + (endMonth! - startMonth!) + 1;
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
    select: { id: true, frequency: true },
    orderBy: [{ id: "asc" }],
  });
  if (!accounts.length) return 0;
  const windowStart = businessDateFromKey(
    `${year! - 1}-${String(month).padStart(2, "0")}-01`,
  )!;
  const closedBefore = businessDayBounds(now).start;
  const yearStart = businessDateFromKey(`${year}-01-01`)!;
  let created = 0;
  for (const account of accounts) {
    const periods = await prisma.taxFilingPeriod.findMany({
      where: {
        filingAccountId: account.id,
        periodStart: { gte: windowStart },
        periodEnd: { lt: closedBefore },
      },
      select: { id: true, periodStart: true, periodEnd: true },
      orderBy: [{ periodStart: "asc" }, { id: "asc" }],
    });
    let taxCents = 0;
    let months = 0;
    for (const period of periods) {
      // The internal loader (no session in a cron): filed periods rebuild
      // from current evidence, which is close enough for an average that
      // only ever produces advice.
      const loaded = await prisma.$transaction((tx) =>
        loadFilingPacketInTx(tx, period.id, now, { allowFiled: true }),
      ).catch(() => null);
      if (!loaded || loaded.status !== "READY") continue;
      taxCents += loaded.packet.rows
        .filter((row) => row.administration === "STATE_COLLECTED")
        .reduce((sum, row) => sum + row.taxCents, 0);
      months += monthsSpanned(period.periodStart, period.periodEnd);
    }
    if (months === 0) continue;
    const averageMonthlyCents = Math.floor(taxCents / months);
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
      select: { frequency: true },
    });
    await tx.taxFilingAccount.update({
      where: { id: advice.filingAccountId },
      data: { frequency: advice.advisedFrequency },
    });
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
