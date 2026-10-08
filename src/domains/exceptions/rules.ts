import {
  addBusinessDays,
  businessDateKey,
  businessDayBounds,
  businessDaysBetween,
} from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Exception inbox (2026-09-28) â€” one place that surfaces anything stuck or
// needing Chris's attention, instead of him having to remember to go check
// six different pages. Pure, zero-database-import rules here (same pattern
// as src/domains/inventory/lifecycle.ts, src/domains/agreements/
// reservation-status.ts) so they're simple to unit-test; src/domains/
// exceptions/index.ts is the thin DB wrapper that queries real rows and
// runs them through these.
//
// Every category here is something that was ALREADY possible before this
// file existed (a stuck reservation, a blocked billing start, a past-due
// invoice, a missed job, an unreviewed request, a machine sitting
// uninspected) â€” this doesn't add new failure states, it just collects the
// existing ones into one list instead of leaving Chris to notice them by
// accident on whichever page he happens to open.
// ---------------------------------------------------------------------------

export type ExceptionCategory =
  | "BILLING_BLOCKED"
  | "SALES_TAX"
  | "TAX_RETURN_DUE"
  | "TAX_LICENSE_RENEWAL"
  | "TAX_AMENDMENT_DUE"
  | "TAX_FILING_NOT_READY"
  | "ACQUISITION_TAX_REVIEW"
  | "PURCHASE_USE_TAX_DUE"
  | "RETAIL_DELIVERY_FEE"
  | "STALE_RESERVATION"
  | "PAST_DUE_INVOICE"
  | "OVERDUE_JOB"
  | "UNREVIEWED_¶»§q«^