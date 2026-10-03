/**
 * The one place that says which stored payment statuses mean "the money
 * arrived". Older records were saved as `SUCCEEDED` (capitals) and newer ones
 * as `succeeded`; both are real, and history is never rewritten. Every report,
 * statement and check must use this rather than comparing to one spelling.
 */
export const SUCCESSFUL_PAYMENT_STATUSES = ["succeeded", "SUCCEEDED"] as const;

export function isSuccessfulPaymentStatus(status: string | null | undefined): boolean {
  return (SUCCESSFUL_PAYMENT_STATUSES as readonly string[]).includes(status ?? "");
}

/**
 * A card payment that arrived after the owner had already written off (or
 * voided) the invoice. It is recorded but counts toward nothing until the owner
 * decides (docs/OWNER-INPUTS.md IN-23).
 */
export const HELD_PAYMENT_STATUS = "held";

/**
 * How a held payment ends (the owner's decision, IN-23). The money stays on its
 * receipt; the payment row keeps a record of what was decided. None of these
 * count as an applied invoice payment.
 */
export const HELD_TO_CREDIT_STATUS = "held_to_credit";
export const HELD_REFUNDED_STATUS = "held_refunded";

/**
 * A held payment that was refunded in Stripe after the owner had already kept it
 * as credit and the credit was partly spent, so it cannot be undone automatically.
 * Listed for the owner in the billing mismatch list.
 */
export const HELD_CONFLICT_STATUS = "held_conflict";
