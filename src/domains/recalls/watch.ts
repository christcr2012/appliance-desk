// OPS-1: the nightly recall check. Reads the government's public recall list (CPSC, no sign-in, read only), compares it
// with our fleet and records POSSIBLE matches for Chris to decide. It never confirms a match, never holds a machine,
// never contacts a customer. Network answers are read before anything is written, so a slow site never holds the
// database, and writing the same match twice is harmless.
import { prisma } from "@/lib/prisma";
import { fetchOfficialSourceJson } from "@/domains/tax/safe-official-source-fetch";
import { parseCpscRecalls, type RecallRecord } from "./matcher";
import {
  CPSC_HOST, MAX_FLEET_SEARCHES_PER_RUN, collectMatches, fleetSearches, nightlySearches, termsForType,
  type FleetUnit, type RecallSearch,
} from "./plan";

export {
  CPSC_HOST, CPSC_PARAMETER_NAMES, CPSC_RECALL_URL, FLEET_LOOKBACK_YEARS, MAX_FLEET_SEARCHES_PER_RUN,
  collectMatches, fleetSearches, nightlySearches, termsForType,
  type FleetUnit, type PlannedMatch, type RecallSearch,
} from "./plan";

const FIRST_NIGHTLY_LOOKBACK_DAYS = 30;
const SEARCH_CONCURRENCY = 5;

export type FetchJson = (url: string) => Promise<unknown>;

export const fetchCpscJson: FetchJson = async (url) =>
  (await fetchOfficialSourceJson(url, { allowedHost: CPSC_HOST, timeoutMs: 8_000 })).json;

async function runSearches(searches: RecallSearch[], fetchJson: FetchJson) {
  const results: { search: RecallSearch; recalls: RecallRecord[] }[] = [];
  const failures: string[] = [];
  for (let index = 0; index < searches.length; index += SEARCH_CONCURRENCY) {
    const batch = searches.slice(index, index + SEARCH_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((search) => fetchJson(search.url)));
    settled.forEach((outcome, offset) => {
      const search = batch[offset]!;
      if (outcome.status === "fulfilled") results.push({ search, recalls: parseCpscRecalls(outcome.value) });
      else failures.push(outcome.reason instanceof Error ? outcome.reason.message : "Search failed.");
    });
  }
  return { results, failures };
}

async function loadFleet(): Promise<FleetUnit[]> {
  const rows = await prisma.appliance.findMany({
    where: { archivedAt: null },
    select: {
      id: true, manufacturer: true, model: true, applianceTypeId: true,
      applianceType: { select: { name: true, recallProductTerms: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    manufacturer: row.manufacturer,
    model: row.model,
    applianceTypeId: row.applianceTypeId,
    terms: termsForType(row.applianceType),
  }));
}

export type RecallWatchCounts = { searches: number; failedSearches: number; newPossibleMatches: number; fleetChecked: number } & Record<string, number>;

/** Chris pressed "Check my whole fleet": the next run (tonight's, or a manual one) looks back the full 15 years. */
export async function requestFleetRecheck(now = new Date()): Promise<void> {
  await prisma.recallWatchState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", fullFleetRequestedAt: now, fullFleetCursor: 0 },
    update: { fullFleetRequestedAt: now, fullFleetCursor: 0 },
  });
}

export async function runRecallWatch(
  now = new Date(),
  fetchJson: FetchJson = fetchCpscJson,
): Promise<RecallWatchCounts> {
  const state = await prisma.recallWatchState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });
  const fleet = await loadFleet();
  if (fleet.length === 0) {
    // Nothing to check yet: leave the first-run marker unset so the first real night still does the full 15-year look-back.
    await prisma.recallWatchState.update({ where: { id: "singleton" }, data: { lastError: null } });
    return { searches: 0, failedSearches: 0, newPossibleMatches: 0, fleetChecked: 0 };
  }

  const firstRun = state.lastSuccessAt === null;
  const fleetRequested = state.fullFleetRequestedAt !== null &&
    (state.fullFleetCheckedAt === null || state.fullFleetCheckedAt < state.fullFleetRequestedAt);
  // A scan that did not finish last night (cursor past 0) carries on tonight.
  const wantFleet = firstRun || fleetRequested || state.fullFleetCursor > 0;

  const since = state.lastSuccessAt ?? new Date(now.getTime() - FIRST_NIGHTLY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const nightly = nightlySearches(fleet, since);
  let fleetPart: RecallSearch[] = [];
  let nextCursor = 0;
  let fleetFinished = false;
  if (wantFleet) {
    const all = fleetSearches(fleet, now);
    const cursor = Math.min(state.fullFleetCursor, all.length);
    fleetPart = all.slice(cursor, cursor + MAX_FLEET_SEARCHES_PER_RUN);
    nextCursor = cursor + fleetPart.length;
    fleetFinished = nextCursor >= all.length;
  }

  const { results, failures } = await runSearches([...nightly, ...fleetPart], fetchJson);
  const planned = collectMatches(results, fleet);

  let created = 0;
  if (planned.length > 0) {
    const inserted = await prisma.recallMatch.createMany({
      data: planned.map((item) => ({
        recallId: item.recall.recallId,
        recallNumber: item.recall.recallNumber,
        title: item.recall.title,
        url: item.recall.url,
        hazard: item.recall.hazard,
        remedy: item.recall.remedy,
        publishedAt: item.recall.publishedAt,
        applianceId: item.applianceId,
        matchReason: item.reason,
      })),
      skipDuplicates: true,
    });
    created = inserted.count;
  }

  const nightlyFailed = failures.length > 0;
  await prisma.recallWatchState.update({
    where: { id: "singleton" },
    data: {
      // A failed search keeps the old date so the next night asks for the same window again.
      ...(nightlyFailed ? {} : { lastSuccessAt: now }),
      ...(wantFleet && failures.length === 0
        ? fleetFinished
          ? { fullFleetCheckedAt: now, fullFleetCursor: 0 }
          : { fullFleetCursor: nextCursor }
        : {}),
      lastError: nightlyFailed ? failures[0]!.slice(0, 300) : null,
    },
  });

  const counts: RecallWatchCounts = {
    searches: nightly.length + fleetPart.length,
    failedSearches: failures.length,
    newPossibleMatches: created,
    fleetChecked: fleetPart.length,
  };
  // Surface a broken check on the automations screen rather than quietly showing "no recalls".
  if (failures.length > 0) throw new Error(`Recall check: ${failures.length} search(es) failed (${failures[0]}).`);
  return counts;
}
