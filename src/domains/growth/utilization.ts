import { flagUtilization, type UtilizationFlag } from "./signals";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const UTILIZATION_WINDOW_DAYS = 30;
export const MIN_UTILIZATION_EVIDENCE_DAYS_PER_UNIT = 14;

export type CustodyEpisodeEvidence = {
  startedOn: Date | null;
  endedOn: Date | null;
  closedAt: Date | null;
};

export type ApplianceUtilizationEvidence = {
  createdAt: Date;
  custodyEpisodes: CustodyEpisodeEvidence[];
};

export type CustodyUtilization = {
  currentUtilizationFraction: number;
  rolling30DayUtilizationFraction: number;
  observedDays: number;
  occupiedDays: number;
  flag: Exclude<UtilizationFlag, null> | null;
};

function overlapMs(
  start: Date,
  end: Date,
  windowStart: Date,
  windowEnd: Date,
): number {
  const from = Math.max(start.getTime(), windowStart.getTime());
  const to = Math.min(end.getTime(), windowEnd.getTime());
  return Math.max(0, to - from);
}

/**
 * Growth guidance uses physical custody, never assignment rows.
 *
 * - current utilization = units with an open custody episode / current units;
 * - rolling utilization = known occupied custody time / observable unit time
 *   during the last 30 days;
 * - a shortage requires both current and rolling evidence to be high;
 * - underutilization requires both to be low;
 * - types without at least 14 average observable days per unit are left
 *   unflagged so a newly-added batch of appliances does not look idle instantly.
 *
 * A manual custody episode with unknown startedOn counts as occupied *now* but
 * contributes no invented historical days to the rolling numerator.
 */
export function computeCustodyUtilization(
  appliances: ApplianceUtilizationEvidence[],
  asOf: Date,
): CustodyUtilization {
  if (appliances.length === 0) {
    return {
      currentUtilizationFraction: 0,
      rolling30DayUtilizationFraction: 0,
      observedDays: 0,
      occupiedDays: 0,
      flag: null,
    };
  }

  const windowStart = new Date(asOf.getTime() - UTILIZATION_WINDOW_DAYS * MS_PER_DAY);
  let currentOccupied = 0;
  let observedMs = 0;
  let occupiedMs = 0;

  for (const appliance of appliances) {
    const observationStart =
      appliance.createdAt.getTime() > windowStart.getTime()
        ? appliance.createdAt
        : windowStart;
    observedMs += Math.max(0, asOf.getTime() - observationStart.getTime());

    const open = appliance.custodyEpisodes.some(
      (episode) => episode.closedAt === null && episode.endedOn === null,
    );
    if (open) currentOccupied += 1;

    for (const episode of appliance.custodyEpisodes) {
      if (!episode.startedOn) continue;
      const end = episode.endedOn ?? asOf;
      occupiedMs += overlapMs(episode.startedOn, end, observationStart, asOf);
    }
  }

  const currentUtilizationFraction = currentOccupied / appliances.length;
  const rolling30DayUtilizationFraction =
    observedMs > 0 ? Math.min(1, occupiedMs / observedMs) : 0;
  const observedDays = observedMs / MS_PER_DAY;
  const occupiedDays = occupiedMs / MS_PER_DAY;
  const averageObservedDays = observedDays / appliances.length;

  let flag: Exclude<UtilizationFlag, null> | null = null;
  if (averageObservedDays >= MIN_UTILIZATION_EVIDENCE_DAYS_PER_UNIT) {
    const currentFlag = flagUtilization(currentUtilizationFraction, appliances.length);
    const rollingFlag = flagUtilization(
      rolling30DayUtilizationFraction,
      appliances.length,
    );
    if (currentFlag && currentFlag === rollingFlag) flag = currentFlag;
  }

  return {
    currentUtilizationFraction,
    rolling30DayUtilizationFraction,
    observedDays,
    occupiedDays,
    flag,
  };
}
