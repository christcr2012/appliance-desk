import type { TermsPolicyFormValues } from "./terms-policy";

/**
 * Suggested starting values for "Ending and renewing rentals", chosen from
 * common practice for appliance rentals and Colorado's automatic-renewal law
 * (C.R.S. 6-1-732: a clear description of renewal and cancellation, a
 * reminder 25 to 40 days before renewal, and an easy way to cancel).
 *
 * These are only a starting point. They are stored in Settings (a migration
 * writes them once, and only if the owner had entered nothing), so the owner
 * can change every number and sentence there at any time. The same values are
 * what the "Restore recommended starting terms" button puts back in the form.
 * The wording is plain English and deliberately repeats no number that the
 * owner can change ("the notice shown above"). Have it read by a Colorado
 * attorney before relying on it.
 *
 * The migration `20261003200000_recommended_terms_starting_values` writes the
 * identical values; `tests/recommended-terms-integration.test.ts` proves they match.
 */
export const RECOMMENDED_TERMS_POLICY: TermsPolicyFormValues = {
  feeDollars: "50",
  feePercent: "25",
  feeCapDollars: "200",
  noticeDays: "30",
  unusedTerm: "REFUND",
  terminationTermsText:
    "You can end this agreement early by giving us the notice shown above. The agreement then ends on your next monthly billing date after the notice period, and rent stops on that date. The early-ending fee shown above is due when you end early. We will arrange to pick up the appliances from your address, and you agree to let us in and to keep them in the same condition, apart from normal wear and tear.",
  autoRenewNoticeDays: "30",
  renewalTermsText:
    "If you turn on automatic renewal, then when your fixed term ends your rental continues month to month at the same monthly rent, and you keep being billed each month. We will remind you before your term ends and tell you your rent. You can turn automatic renewal off for free, online or by contacting us, at any time before your term ends. If you do, the agreement simply ends on its end date.",
};
