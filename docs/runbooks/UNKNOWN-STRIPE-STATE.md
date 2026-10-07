# Unknown Stripe state runbook

Use this when Appliance Desk shows a Stripe/provider operation as **Pending**, **Unknown**, **Failed**, or **Drift**. An unknown result means the provider may already have accepted the write; it does not mean “try again.”

## Response

1. Open **Desk → Billing → Reconciliation** (`/desk/billing/reconciliation`). Record the mismatch kind, subject, provider operation, and age. This screen is deliberately read-only.
2. Open **Desk → Automations** and inspect the latest `billing-reconcile:provider-ops` run. Do not manually invoke a cron while an existing run is pending or its result is unclear.
3. If the normal reconciliation pass has not run since the uncertain operation, let the 15:30 recovery pass run. `finishPendingProviderOperations` reads Stripe first and only retries when provider state proves that is safe.
4. If it remains unresolved, use the stored Stripe object/operation identifiers to inspect the **Stripe test-mode dashboard**. Match amount, customer, subscription/invoice/refund and timestamps; never infer success from a generic provider-status page.
5. If Stripe proves the write happened, let reconciliation converge the local evidence. If Stripe proves it did not happen, use the existing supported owner workflow/reconciliation retry. Do not invent a second charge, refund, customer or subscription.
6. If a correction is still needed and there is no supported workflow, stop and record it as a remediation issue. Preserve `ProviderOperation`, receipt/payment/refund and audit evidence; do not “fix” the database by hand.
7. Re-open the workbench after reconciliation and confirm the row is gone or has a definite recorded disposition.

## Never do

- Never blindly repeat an `UNKNOWN` provider write.
- Never edit `SubscriptionEndIntent`, renewal/end dates, provider-operation status, payment/refund evidence, or Stripe IDs by hand.
- Never switch Stripe to live mode as part of troubleshooting.

## Drill

The automated recovery/drift drills are `tests/billing-reconciliation.test.ts`, `tests/billing-drift-integration.test.ts`, and the provider-operation race tests. A manual dashboard comparison should be done only with test-mode fixtures.

Last drilled: **2026-10-06 (automated CI coverage); manual Stripe-dashboard drill not separately recorded.**
