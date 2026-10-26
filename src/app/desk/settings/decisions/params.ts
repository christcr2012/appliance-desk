import { DECISION_AREAS } from "@/domains/decisions/registry";

// DEC-1b: the URL is the state of Settings › Decisions & reviews (KIT 5.1). Unknown values fall back to the
// defaults; nothing here throws.
export const TABS = ["OWNER", "CPA", "ATTORNEY", "TRANSLATOR", "ANSWERED"] as const;
export type DecisionsTab = (typeof TABS)[number];
const STATES = ["STARTING_VALUE", "WITH_PROFESSIONAL", "NO_SOURCE"] as const;
export type DecisionsStateFilter = (typeof STATES)[number];

export type DecisionsParams = { tab: DecisionsTab; area: string | null; state: DecisionsStateFilter | null };

function one(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value[0] ?? "" : "";
}

export function decisionsParams(raw: Record<string, string | string[] | undefined>): DecisionsParams {
  const tab = one(raw.for).toUpperCase();
  const area = one(raw.area).toUpperCase();
  const state = one(raw.state).toUpperCase();
  return {
    tab: (TABS as readonly string[]).includes(tab) ? tab as DecisionsTab : "OWNER",
    area: (DECISION_AREAS as string[]).includes(area) ? area : null,
    state: (STATES as readonly string[]).includes(state) ? state as DecisionsStateFilter : null,
  };
}
