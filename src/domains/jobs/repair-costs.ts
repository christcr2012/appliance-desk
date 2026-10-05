/**
 * R12 — repair costs are owner-entered accounting input, so they are read strictly:
 * never guessed, rounded or silently dropped.
 */

/** $100,000: far above any real repair, far below the database's whole-number limit. */
export const MAX_REPAIR_COST_CENTS = 10_000_000;

export type RepairCostParse =
  | { ok: true; cents: number | null }
  | { ok: false; message: string };

/**
 * Dollars text → whole cents. Blank means "clear this cost" (null). Anything that is
 * not a plain non-negative amount with at most two decimals is an error.
 */
export function parseRepairCostDollars(raw: string | undefined, label: string): RepairCostParse {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: true, cents: null };
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.replace(/^\$/, ""));
  if (!match) {
    return {
      ok: false,
      message: `${label} must be a dollar amount like 125 or 125.50 (no negatives, at most two decimals).`,
    };
  }
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (cents > MAX_REPAIR_COST_CENTS) {
    return { ok: false, message: `${label} can't be more than $100,000.` };
  }
  return { ok: true, cents };
}

/** The same rule for direct domain calls, so the form is not the only guard. */
export function assertValidRepairCostCents(value: number | null, label: string): void {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_REPAIR_COST_CENTS) {
    throw new Error(`${label} must be a whole number of cents between 0 and $100,000.`);
  }
}
