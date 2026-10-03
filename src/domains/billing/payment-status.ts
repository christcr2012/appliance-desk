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
