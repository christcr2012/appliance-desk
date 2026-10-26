// OPS-1: the pure part of the nightly recall check (what to ask the government's list, and which machines an answer
// covers). No database, no network, no clock: tested on its own.
import { matchRecallToAppliance, type RecallRecord } from "./matcher";

export const CPSC_RECALL_URL = "https://www.saferproducts.gov/RestWebServices/Recall";
export const CPSC_HOST = "www.saferproducts.gov";
/** A first check, and "Check my whole fleet", look this far back. */
export const FLEET_LOOKBACK_YEARS = 15;
/** Searches per run: the function has about a minute, and the rest continue the next night. */
export const MAX_FLEET_SEARCHES_PER_RUN = 40;

/** The only parameter names this app sends: the government's list answers EVERYTHING when a name is misspelled. */
export const CPSC_PARAMETER_NAMES = ["format", "ProductName", "Manufacturer", "LastPublishDateStart", "RecallDateStart"] as const;

export type FleetUnit = {
  id: string;
  manufacturer: string | null;
  model: string | null;
  applianceTypeId: string;
  terms: string[];
};

export type RecallSearch = { key: string; url: string; applianceIds: string[] };

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** What to search for: the type's own words, or the type's name when none were set. Lower case, no blanks. */
export function termsForType(type: { name: string; recallProductTerms: string[] }): string[] {
  const own = type.recallProductTerms.map((term) => term.trim().toLowerCase()).filter(Boolean);
  const terms = own.length > 0 ? own : [type.name.trim().toLowerCase()].filter(Boolean);
  return [...new Set(terms)];
}

function searchUrl(params: Record<string, string>): string {
  const query = new URLSearchParams({ format: "json", ...params });
  return `${CPSC_RECALL_URL}?${query.toString()}`;
}

/** Each night: anything published since the last good run (a day back for safety), once per search word. */
export function nightlySearches(fleet: FleetUnit[], since: Date): RecallSearch[] {
  const byTerm = new Map<string, Set<string>>();
  for (const unit of fleet) {
    for (const term of unit.terms) {
      if (!byTerm.has(term)) byTerm.set(term, new Set());
      byTerm.get(term)!.add(unit.id);
    }
  }
  const from = dayKey(new Date(since.getTime() - 24 * 60 * 60 * 1000));
  return [...byTerm.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([term, ids]) => ({
      key: `nightly:${term}`,
      url: searchUrl({ ProductName: term, LastPublishDateStart: from }),
      applianceIds: [...ids],
    }));
}

/** The whole fleet, once: each maker with each search word, far back. Sorted so a run can continue where it stopped. */
export function fleetSearches(fleet: FleetUnit[], now: Date): RecallSearch[] {
  const start = new Date(now);
  start.setUTCFullYear(start.getUTCFullYear() - FLEET_LOOKBACK_YEARS);
  const from = dayKey(start);
  const combos = new Map<string, { maker: string; term: string; ids: Set<string> }>();
  for (const unit of fleet) {
    const maker = unit.manufacturer?.trim();
    if (!maker) continue;
    for (const term of unit.terms) {
      const key = `${maker.toLowerCase()}|${term}`;
      if (!combos.has(key)) combos.set(key, { maker, term, ids: new Set() });
      combos.get(key)!.ids.add(unit.id);
    }
  }
  return [...combos.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, combo]) => ({
      key: `fleet:${key}`,
      url: searchUrl({ ProductName: combo.term, Manufacturer: combo.maker, RecallDateStart: from }),
      applianceIds: [...combo.ids],
    }));
}

export type PlannedMatch = {
  recall: RecallRecord;
  applianceId: string;
  reason: string;
};

/** Pure: every recall in the answers compared with the machines that search was for. */
export function collectMatches(
  results: { search: RecallSearch; recalls: RecallRecord[] }[],
  fleet: FleetUnit[],
): PlannedMatch[] {
  const byId = new Map(fleet.map((unit) => [unit.id, unit]));
  const seen = new Set<string>();
  const planned: PlannedMatch[] = [];
  for (const { search, recalls } of results) {
    for (const recall of recalls) {
      for (const applianceId of search.applianceIds) {
        const unit = byId.get(applianceId);
        if (!unit) continue;
        const dedupe = `${recall.recallId}|${applianceId}`;
        if (seen.has(dedupe)) continue;
        const match = matchRecallToAppliance(recall, unit);
        if (!match) continue;
        seen.add(dedupe);
        planned.push({ recall, applianceId, reason: match.reason });
      }
    }
  }
  return planned;
}

