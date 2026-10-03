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
 * per credit ("Credit – Washer #12 returned early – 10 days"), oldest first,
 * never more than Stripe actually applied. Any part that cannot be matched to a
 * recorded credit is still shown, as "Account credit applied". Pure.
 */
export function creditLinesForAppliedBalance(
  appliedCents: number,
  credits: ReadonlyArray<{ id: string; amountCents: number; reason: string }>,
): { lines: Array<{ kind: "CREDIT"; description: string; amountCents: number; rentalLineId: null }>; shownCreditIds: string[] } {
  const lines: Array<{ kind: "CREDIT"; description: string; amountCents: number; rentalLineId: null }> = [];
  const shownCreditIds: string[] = [];
  let left = appliedCents;
  for (const credit of credits) {
    if (left <= 0) break;
    const part = Math.min(left, credit.amountCents);
    if (part <= 0) continue;
    lines.push({ kind: "CREDIT", description: credit.reason, amountCents: -part, rentalLineId: null });
    shownCreditIds.push(credit.id);
    left -= part;
  }
  if (left > 0) {
    lines.push({ kind: "CREDIT", description: "Account credit applied", amountCents: -left, rentalLineId: null });
  }
  return { lines, shownCreditIds };
}


