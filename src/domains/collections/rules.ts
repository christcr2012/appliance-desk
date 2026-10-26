// OPS-6: the pure rules of collecting from a customer who stopped paying. No database here.
export const RECOMMENDED_SECOND_NOTICE_DAY = 10;
export const RECOMMENDED_FINAL_NOTICE_DAY = 20;
export const RECOMMENDED_DECISION_DAY = 30;

export type LadderDays = { secondNotice: number; finalNotice: number; decision: number };
export const RECOMMENDED_LADDER: LadderDays = {
  secondNotice: RECOMMENDED_SECOND_NOTICE_DAY,
  finalNotice: RECOMMENDED_FINAL_NOTICE_DAY,
  decision: RECOMMENDED_DECISION_DAY,
};

/** The three days must be whole numbers in order (second notice, then final notice, then the decision). */
export function validateLadder(days: LadderDays): string | null {
  const all = [days.secondNotice, days.finalNotice, days.decision];
  if (!all.every((n) => Number.isInteger(n) && n >= 2 && n <= 120)) return "Use whole numbers of days between 2 and 120.";
  if (!(days.secondNotice < days.finalNotice && days.finalNotice < days.decision)) {
    return "The second notice must come before the final notice, and the final notice before your decision.";
  }
  return null;
}

/** Calendar days between two Denver date keys (YYYY-MM-DD). Positive when `now` is after `due`. */
export function daysPastDue(dueKey: string, nowKey: string): number {
  const parse = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return Date.UTC(y!, m! - 1, d!);
  };
  return Math.floor((parse(nowKey) - parse(dueKey)) / 86_400_000);
}

export type LadderStepName = "SECOND_NOTICE" | "FINAL_NOTICE" | "DECISION";

/** Which steps have come up by now (a missed night never skips a step). */
export function stepsCameUp(past: number, ladder: LadderDays): LadderStepName[] {
  const out: LadderStepName[] = [];
  if (past >= ladder.secondNotice) out.push("SECOND_NOTICE");
  if (past >= ladder.finalNotice) out.push("FINAL_NOTICE");
  if (past >= ladder.decision) out.push("DECISION");
  return out;
}

/** The step is stale if the bill was paid in full or the rental is no longer active. */
export function stepStillNeeded(owedCents: number, agreementActive: boolean): boolean {
  return owedCents > 0 && agreementActive;
}

export type SmallClaimsFees = { lowMaxCents: number; lowFeeCents: number; highFeeCents: number };
export type FilingLimits = { perMonth: number; perYear: number };

export function smallClaimsEligible(owedCents: number, limitCents: number): { ok: boolean; reason: string | null } {
  if (owedCents <= 0) return { ok: false, reason: "Nothing is owed." };
  if (owedCents > limitCents) {
    return { ok: false, reason: "The amount owed is over the small-claims limit. A court filing for more than the limit needs a lawyer's advice; talk to your attorney first." };
  }
  return { ok: true, reason: null };
}

export function smallClaimsFee(owedCents: number, fees: SmallClaimsFees): number {
  return owedCents <= fees.lowMaxCents ? fees.lowFeeCents : fees.highFeeCents;
}

/** How many of the owner's recorded filings count against the court's limits, in one county. */
export function filingCounts(filings: { county: string; filedOn: Date }[], county: string, now: Date, denverYearMonth: (d: Date) => { y: number; m: number }) {
  const here = denverYearMonth(now);
  const mine = filings.filter((f) => f.county.trim().toLowerCase() === county.trim().toLowerCase());
  const thisMonth = mine.filter((f) => { const k = denverYearMonth(f.filedOn); return k.y === here.y && k.m === here.m; }).length;
  const thisYear = mine.filter((f) => denverYearMonth(f.filedOn).y === here.y).length;
  return { thisMonth, thisYear };
}

export function filingRoom(counts: { thisMonth: number; thisYear: number }, limits: FilingLimits): { ok: boolean; message: string } {
  if (counts.thisMonth >= limits.perMonth) return { ok: false, message: `You already filed ${counts.thisMonth} here this month; the court allows ${limits.perMonth} a month. Wait until next month.` };
  if (counts.thisYear >= limits.perYear) return { ok: false, message: `You already filed ${counts.thisYear} here this year; the court allows ${limits.perYear} a year in one county.` };
  return { ok: true, message: `${counts.thisMonth} of ${limits.perMonth} used this month, ${counts.thisYear} of ${limits.perYear} this year in this county.` };
}

/** Pickup after default is allowed only with the customer's recorded agreement, and never from active-duty without a court order. */
export function pickupGate(input: { consentAt: Date | null; activeDuty: boolean; courtOrderOn: Date | null }): { ok: true } | { ok: false; reason: "NO_CONSENT" | "COURT_ORDER_REQUIRED"; message: string } {
  if (input.activeDuty && !input.courtOrderOn) {
    return { ok: false, reason: "COURT_ORDER_REQUIRED", message: "This customer is marked as on active military duty. By federal law their appliance can't be taken back after a missed payment without a court order. Record the order first, or ask the court (replevin)." };
  }
  if (!input.consentAt && !input.courtOrderOn) {
    return { ok: false, reason: "NO_CONSENT", message: "Record that the customer agreed to the pickup first. If they don't agree, ask the court (replevin)." };
  }
  return { ok: true };
}
