import type Stripe from "stripe";

/**
 * Account credit that Stripe applied to a bill, shown on the local mirror of
 * that bill as labeled lines (src/domains/billing/webhooks.ts). Pure, no
 * database, so the rules are unit-testable.
 */

/**
 * Account-balance credit Stripe used on this invoice, in cents (0 when none).
 * Stripe keeps a customer's credit as a negative balance; the part it applied is
 * the balance's move from before the invoice to after it.
 */
export function appliedBalanceCreditCents(
  invoice: Pick<Stripe.Invoice, "starting_balance" | "ending_balance">,
): number {
  const starting = invoice.starting_balance ?? 0;
  const ending = invoice.ending_balance ?? starting;
  if (starting >= 0) return 0;
  return Math.max(0, Math.min(-starting, ending - starting));
}

/**
 * Show Stripe-applied account credit on the local bill as its own labeled line
 * per credit ("Credit – Dryer #12 delivered late – 10 days"), oldest first,
 * never more than Stripe actually applied. Only credits this feature created
 * are passed in (the caller filters by source type), each with how much of it
 * is still unshown, so a credit Stripe used across two bills is shown in two
 * parts and an old credit from before the rule existed is never relabeled.
 * Any part that cannot be matched to a recorded credit is still shown, as
 * "Account credit applied". Pure.
 */
export function creditLinesForAppliedBalance(
  appliedCents: number,
  credits: ReadonlyArray<{ id: string; amountCents: number; shownCents: number; reason: string }>,
): {
  lines: Array<{ kind: "CREDIT"; description: string; amountCents: number; rentalLineId: null }>;
  /** How much of each credit this bill shows, and whether that completes it. */
  shown: Array<{ id: string; cents: number; complete: boolean }>;
} {
  const lines: Array<{ kind: "CREDIT"; description: string; amountCents: number; rentalLineId: null }> = [];
  const shown: Array<{ id: string; cents: number; complete: boolean }> = [];
  let left = appliedCents;
  for (const credit of credits) {
    if (left <= 0) break;
    const unshown = credit.amountCents - credit.shownCents;
    const part = Math.min(left, unshown);
    if (part <= 0) continue;
    lines.push({ kind: "CREDIT", description: credit.reason, amountCents: -part, rentalLineId: null });
    shown.push({ id: credit.id, cents: part, complete: credit.shownCents + part >= credit.amountCents });
    left -= part;
  }
  if (left > 0) {
    lines.push({ kind: "CREDIT", description: "Account credit applied", amountCents: -left, rentalLineId: null });
  }
  return { lines, shown };
}
