# K-1A + K-1B — double-entry accounting foundation
Source: docs/designs/BATCH-K.md sections 0, 2, 2.1, 3.1, 3.2 (approved 2026-10-06); docs/MASTER-ROADMAP.md K.
One coherent outcome: data can be safely restored and every eligible historical financial event can be mapped into a balanced journal plan without performing live financial writes.

## Frozen original complete acceptance
### K-1A
- Add exactly the approved additive Batch K books schema, settings and check constraints without rewriting historical billing records.
- Seed the complete immutable system-role chart and expense categories with stable keys, safe reruns and filing-account mapping, with no duplicate financial accounts.
- Prove populated-schema upgrade, original rows intact, role and tenant boundaries, schema health and disposable backup/restore coverage.
### K-1B
- Provide a fail-closed account-role resolver and approved InvoiceLineItemKind mapping, preserving negative/contra and tax filing account distinctions.
- Implement pure balanced journal posting plans for all source events in Batch K section 3.2, including reversals, refunds, deposits, credits, Stripe, expenses, assets, depreciation and tax events.
- Every rule uses integer cents, bounded source snapshots, Colorado accounting dates, and null or explicit refusal for ineligible/incomplete source events; prove balanced and idempotent planning in tests.

## Rules this work keeps
Append-only journals, unique provenance, integer cents and transactional race safety. OWNER/ADMIN bookkeeping access; STAFF own expenses only; CUSTOMER no books. No live payments/provider writes or production data. Professional gates affect activation, not development.

## Excluded and deferred
Journal poster, books period/owner screens (K-2A/K-2B); Stripe sync (K-3); expense workflows (K-4); CSV exports and reports (K-5 onward). Real provider acceptance and owner/CPA policy remain in launch ledger.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "ef16a14bfb2d4fab1b65a77c7153460124e1214f",
  "outcome": "Foundation for reproducible double-entry books: stable accounts, safe schema, and balanced posting plans from real money events.",
  "integrationBoundary": "prisma/schema.prisma, additive migration, books domain account mapping and pure posting rules, settings, backup/schema checks and fixtures; no payment-provider writes",
  "newEngineering": "Implement K-1A and K-1B completely from approved Batch K sections 2, 2.1, 3.1, 3.2; validate upgrade/restore and exact posting fixtures.",
  "estimatedProductionLines": 1000,
  "relatedWorkDecision": "Accounting definitions without posting plans are not practically usable; keep schema, seeded roles and pure event plans in one reviewable bundle while transaction poster/UI remain K-2A/K-2B.",
  "subsections": [
    {
      "id": "K-1A",
      "acceptance": [
        "Add exactly the approved additive Batch K books schema, settings and check constraints without rewriting historical billing records.",
        "Seed the complete immutable system-role chart and expense categories with stable keys, safe reruns and filing-account mapping, with no duplicate financial accounts.",
        "Prove populated-schema upgrade, original rows intact, role and tenant boundaries, schema health and disposable backup/restore coverage."
      ],
      "remainingEngineering": [
        "Add exactly the approved additive Batch K books schema, settings and check constraints without rewriting historical billing records.",
        "Seed the complete immutable system-role chart and expense categories with stable keys, safe reruns and filing-account mapping, with no duplicate financial accounts.",
        "Prove populated-schema upgrade, original rows intact, role and tenant boundaries, schema health and disposable backup/restore coverage."
      ]
    },
    {
      "id": "K-1B",
      "acceptance": [
        "Provide a fail-closed account-role resolver and approved InvoiceLineItemKind mapping, preserving negative/contra and tax filing account distinctions.",
        "Implement pure balanced journal posting plans for all source events in Batch K section 3.2, including reversals, refunds, deposits, credits, Stripe, expenses, assets, depreciation and tax events.",
        "Every rule uses integer cents, bounded source snapshots, Colorado accounting dates, and null or explicit refusal for ineligible/incomplete source events; prove balanced and idempotent planning in tests."
      ],
      "remainingEngineering": [
        "Provide a fail-closed account-role resolver and approved InvoiceLineItemKind mapping, preserving negative/contra and tax filing account distinctions.",
        "Implement pure balanced journal posting plans for all source events in Batch K section 3.2, including reversals, refunds, deposits, credits, Stripe, expenses, assets, depreciation and tax events.",
        "Every rule uses integer cents, bounded source snapshots, Colorado accounting dates, and null or explicit refusal for ineligible/incomplete source events; prove balanced and idempotent planning in tests."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->
