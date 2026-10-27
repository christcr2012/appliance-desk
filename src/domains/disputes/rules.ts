// OPS-5: the plain rules for card and bank disputes. Pure: no database, no network, no clock.
// Facts: docs/research/2026-10-25-operating-risks.md item 8 (a card dispute can be answered once, with a deadline Stripe
// sets, evidence at most 4.5 MB in total; a bank debit dispute is final).

/** The most evidence Stripe accepts for one dispute, with a little room left for the covering text. */
export const MAX_EVIDENCE_BYTES = 4_500_000;
/** The "respond soon" To do turns urgent this many days before the deadline. */
export const REMINDER_DAYS_BEFORE_DUE = 3;
/** Starting value for how long after a bank debit the customer can still dispute it (NACHA, via Stripe's documentation). */
export const RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS = 60;
export const MIN_ACH_DISPUTE_WINDOW_DAYS = 2;
export const MAX_ACH_DISPUTE_WINDOW_DAYS = 120;

export type DisputeStateName = "NEEDS_RESPONSE" | "UNDER_REVIEW" | "WON" | "LOST" | "CLOSED";

/** Stripe's status words mapped to the four things Chris cares about. Unknown words keep the dispute open (never "won"). */
export function disputeStateFromStripe(status: string): DisputeStateName {
  switch (status) {
    case "won": return "WON";
    case "lost": return "LOST";
    case "under_review":
    case "warning_under_review": return "UNDER_REVIEW";
    case "warning_closed":
    case "prevented": return "CLOSED";
    case "needs_response":
    case "warning_needs_response":
    default: return "NEEDS_RESPONSE";
  }
}

export function isFinalState(state: DisputeStateName): boolean {
  return state === "WON" || state === "LOST" || state === "CLOSED";
}

/** An early-warning dispute (an inquiry) is not a real dispute yet; it still needs an answer but costs nothing to ignore. */
export function isEarlyWarning(status: string): boolean {
  return status.startsWith("warning_");
}

export function whole(cents: number): string {
  return `$${(Math.abs(cents) / 100).toFixed(2)}`;
}

/** How soon an answer is due, in the words the To do and the dispute page use. */
export function dueDescription(dueBy: Date | null, now: Date): { text: string; urgent: boolean; overdue: boolean } {
  if (!dueBy) return { text: "as soon as possible", urgent: true, overdue: false };
  const ms = dueBy.getTime() - now.getTime();
  if (ms <= 0) return { text: "the deadline has passed", urgent: true, overdue: true };
  const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
  return {
    text: days <= 1 ? "by tomorrow" : `within ${days} days`,
    urgent: ms <= REMINDER_DAYS_BEFORE_DUE * 24 * 60 * 60 * 1000,
    overdue: false,
  };
}

export function disputeTitle(input: { customerName: string | null; amountCents: number; isBank: boolean; dueBy: Date | null }, now: Date): string {
  const who = input.customerName ?? "a customer";
  if (input.isBank) return `Bank dispute: ${who} ${whole(input.amountCents)} — collect directly (bank disputes can't be contested)`;
  const due = dueDescription(input.dueBy, now);
  return `Card dispute: ${who} ${whole(input.amountCents)} — respond ${due.text}`;
}

/** Earliest day a deposit refund for a bank payment may go out: the debit date plus the dispute window. */
export function bankRefundEarliest(debitedOn: Date, windowDays: number): Date {
  return new Date(debitedOn.getTime() + windowDays * 24 * 60 * 60 * 1000);
}

export const REFUND_ON_DISPUTE_WARNING =
  "A refund does not stop the dispute — you could pay twice (once to the customer, and again if the bank takes the money back). " +
  "Answer the dispute instead, or wait for it to close.";

export function clampWindowDays(value: number): number {
  if (!Number.isFinite(value)) return RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS;
  return Math.min(MAX_ACH_DISPUTE_WINDOW_DAYS, Math.max(MIN_ACH_DISPUTE_WINDOW_DAYS, Math.round(value)));
}
