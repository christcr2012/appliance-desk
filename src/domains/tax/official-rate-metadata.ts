import type { Prisma } from "@prisma/client";

import {
  businessDateFromKey,
  businessDateKey,
  businessDayBounds,
} from "@/lib/business-date";
import { prisma } from "@/lib/prisma";

export type TaxRateObservationInput = {
  jurisdictionId: string;
  asOf: Date;
  rateMilliPercent: number;
  observedAt?: Date;
};

function assertRateMilliPercent(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("rateMilliPercent must be a non-negative integer.");
  }
}

function oneYearAgoBusinessDateKey(now: Date): string {
  const [yearText, monthText, dayText] = businessDateKey(now).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) {
    throw new Error("Could not derive the Colorado business date.");
  }

  const previousYear = year - 1;
  const lastDayOfMonth = new Date(Date.UTC(previousYear, month, 0)).getUTCDate();
  const clampedDay = Math.min(day, lastDayOfMonth);
  return [
    String(previousYear).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(clampedDay).padStart(2, "0"),
  ].join("-");
}

export async function recordTaxRateObservationInTx(
  tx: Prisma.TransactionClient,
  input: TaxRateObservationInput,
): Promise<{ id: string }> {
  assertRateMilliPercent(input.rateMilliPercent);
  const observedAt = input.observedAt ?? new Date();
  const bounds = businessDayBounds(observedAt);

  const jurisdiction = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "TaxJurisdiction"
    WHERE "id" = ${input.jurisdictionId}
    FOR UPDATE
  `;
  if (jurisdiction.length !== 1) {
    throw new Error("Couldn't find that tax jurisdiction.");
  }

  const existing = await tx.taxRateObservation.findFirst({
    where: {
      jurisdictionId: input.jurisdictionId,
      asOf: input.asOf,
      rateMilliPercent: input.rateMilliPercent,
      observedAt: {
        gte: bounds.start,
        lt: bounds.end,
      },
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (existing) return existing;

  return tx.taxRateObservation.create({
    data: {
      jurisdictionId: input.jurisdictionId,
      asOf: input.asOf,
      rateMilliPercent: input.rateMilliPercent,
      observedAt,
    },
    select: { id: true },
  });
}

export async function hasTwoDayRateConfirmationInTx(
  tx: Prisma.TransactionClient,
  input: {
    jurisdictionId: string;
    asOf: Date;
    rateMilliPercent: number;
    now: Date;
  },
): Promise<boolean> {
  assertRateMilliPercent(input.rateMilliPercent);

  const observations = await tx.taxRateObservation.findMany({
    where: {
      jurisdictionId: input.jurisdictionId,
      asOf: input.asOf,
      rateMilliPercent: input.rateMilliPercent,
      observedAt: { lte: input.now },
    },
    select: { observedAt: true },
    orderBy: [{ observedAt: "asc" }, { id: "asc" }],
  });

  const days = new Set<string>();
  for (const observation of observations) {
    days.add(businessDateKey(observation.observedAt));
    if (days.size >= 2) return true;
  }
  return false;
}

export async function pruneTaxRateObservationsInTx(
  tx: Prisma.TransactionClient,
  now: Date,
): Promise<number> {
  const cutoffKey = oneYearAgoBusinessDateKey(now);
  const cutoff = businessDateFromKey(cutoffKey);
  if (!cutoff) {
    throw new Error(`Could not parse observation-pruning date ${cutoffKey}.`);
  }

  const deleted = await tx.taxRateObservation.deleteMany({
    where: { observedAt: { lt: cutoff } },
  });
  return deleted.count;
}

export async function listActiveOfficialSourceWatches(): Promise<
  Array<{
    id: string;
    label: string;
    url: string;
    lastHash: string | null;
    lastText: string | null;
    lastCheckedAt: Date | null;
    consecutiveFailures: number;
  }>
> {
  return prisma.officialSourceWatch.findMany({
    where: { active: true },
    select: {
      id: true,
      label: true,
      url: true,
      lastHash: true,
      lastText: true,
      lastCheckedAt: true,
      consecutiveFailures: true,
    },
    orderBy: [{ label: "asc" }, { id: "asc" }],
  });
}
