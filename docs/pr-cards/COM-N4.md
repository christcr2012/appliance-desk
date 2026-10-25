# COM-N4 — Observed service metrics, unit economics and forecasts

Design: [docs/designs/BATCH-COM.md](../designs/BATCH-COM.md) section 7. Migration: none. Read-only (sends and posts nothing).

## What it delivers
Reports → Communications cost evidence, last full month: text failure rate, STOP rate, median minutes to a person's first reply,
provider-reported spend per active customer, what-if monthly spend at 200/250/500/1,000 customers. Registered in
`src/domains/reports/definitions.ts`: `telecom.costPerActiveCustomer`, `telecom.projectedSpend` (ESTIMATE), `communications.deliveryFailureRate`,
`communications.optOutRate`, `communications.medianResponseMinutes`.

## Honesty rules
- Active customers = distinct customers with an ACTIVE rental each GMT day (same days as provider billing). An ended/cancelled rental with no recorded end
  time makes history incomplete → unavailable (never divide by today's count).
- Rates need at least 10 final results / 10 people texted; forecast needs complete history and 14 customer-days.
- Forecast = observed variable spend per customer-day × scenario × 30 + fixed recurring once; scenarios are editable examples.
- Rental-revenue share not shown until K supplies recognized revenue. Spend labelled provider reported, not invoice reconciled.
- Owner/Admin only; no per-employee breakdown.

## Not in this PR (stays on the plan)
Cost per contacted customer / per linked job, voice minutes and segments per customer, and the automatic spike/circuit pause (needs IN-53).

## Acceptance → evidence
`tests/telecom-unit-economics.test.ts` (7 pure) and `tests/telecom-unit-economics-integration.test.ts` (2, throwaway Postgres).
