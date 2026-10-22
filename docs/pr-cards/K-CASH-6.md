# K-CASH-6 — QuickBooks Online detail export and delivery proof

Original approved subsection K-CASH-6 (merged K-CASH-5B #509 prerequisite). Design: `docs/designs/BATCH-K-CASH.md` §§6–10, `docs/designs/BATCH-K.md` §3.6. One complete provider-specific delivery, not a helper or authorization for a real QBO account/import.

## Frozen full acceptance

1. Default bank-reconciled QuickBooks journal exports to DETAIL; allow DAILY_SUMMARY only by conscious advanced selection with a visible bank-match warning; leave other targets and prior immutable CSV unchanged.
2. Match vendor QBO journal CSV field/map/date requirements including parent:subaccount names and reject missing account mappings; no account, plan, remote import or provider state is asserted verified from vendor research or file download.
3. Create PREPARED AccountingDelivery evidence for every new QBO journal batch with tenant/company label, edition, period, batch hash and creator; export and download do not automatically mark imported.
4. Allow OWNER-only import confirmation after independent trial-company verification of journal count, balanced debits/credits and bank/statement comparison, with evidence notes/reference and actor/time/version; keep real-tenant proof separate.
5. Quarantine PREPARED/UNCERTAIN QBO batches: block any fresh overlapping entry export even if a new date window or onlyNew=false is requested, rather than assuming manual CSV import can deduplicate.
6. After IMPORT_CONFIRMED, never include the same journal source in another QBO batch by default; return a safe already-imported/redownload instruction, while preserving all immutable archived history.
7. Permit OWNER to resolve a failed-before-import attempt or uncertain import with a reason and version check; ambiguous remote outcomes stay UNCERTAIN until separately verified, with serializable concurrency/replay, immutable audit and no deletion.
8. Provide OWNER/ADMIN private history and download, OWNER-only confirmation/resolution, STAFF/CUSTOMER/inactive actor denial across domain/actions/pages, private errors and no provider API calls.
9. Build a mobile/keyboard/dark/light/axe-safe Books export and delivery wizard, QBO detail default, private company/edition, import checklist, prior batch resolution, safe download and real proof guidance; keep Books/Budget navigation.
10. Prove QBO sample-format DETAIL, trial-bank matching/statement expectation, immutable hash, state transitions, quarantined retries and race, partial/unknown import, role denial and full browser workflow with disposable PostgreSQL and exact-head CI; document remaining 22 external gates.

## Owner/provider acceptance separate from engineering

The actual accounting tenant/edition, trial-company journal import, resulting bank-register matches and statement reconciliation, production opening balances and CPA review require owner/real-provider evidence. All 22 existing external release checks remain individually PENDING. No money, live payments, customer messages, credentials, real QBO import, real records or unscheduled deployment authorized.

<!-- bundle-plan:start -->
```json
{
  "baseRevision": "4cff6f5fdb072c95d2f42210c0fafc3218e5ae4c",
  "workKind": "ENGINEERING",
  "outcome": "Complete original K-CASH-6 provider-specific QuickBooks DETAIL export and accountable manual import/delivery proof without provider calls or false remote success.",
  "integrationBoundary": "Reuse K-5 ExportBatch and mapping/formatters, existing AccountingDelivery, K bank/reconciliation sources, audit and owner Books export routes; K-CASH-7 monthly plans/reports is a separate dependent outcome.",
  "newEngineering": "QBO detail-first safeguards, owner-editable proof, source overlap quarantine and safe resolution, role-scoped UI and real-DB/browser tests.",
  "estimatedProductionLines": 600,
  "relatedWorkDecision": "Single full original provider-boundary subsection K-CASH-6 naturally requires complete export/transition/wizard and race proof. Keep this as a substantial provider-specific PR; K-CASH-7 has separate report/migration risk.",
  "subsections": [
    {
      "id": "K-CASH-6",
      "acceptance": [
        "Default bank-reconciled QuickBooks journal exports to DETAIL; allow DAILY_SUMMARY only by conscious advanced selection with a visible bank-match warning; leave other targets and prior immutable CSV unchanged.",
        "Match vendor QBO journal CSV field/map/date requirements including parent:subaccount names and reject missing account mappings; no account, plan, remote import or provider state is asserted verified from vendor research or file download.",
        "Create PREPARED AccountingDelivery evidence for every new QBO journal batch with tenant/company label, edition, period, batch hash and creator; export and download do not automatically mark imported.",
        "Allow OWNER-only import confirmation after independent trial-company verification of journal count, balanced debits/credits and bank/statement comparison, with evidence notes/reference and actor/time/version; keep real-tenant proof separate.",
        "Quarantine PREPARED/UNCERTAIN QBO batches: block any fresh overlapping entry export even if a new date window or onlyNew=false is requested, rather than assuming manual CSV import can deduplicate.",
        "After IMPORT_CONFIRMED, never include the same journal source in another QBO batch by default; return a safe already-imported/redownload instruction, while preserving all immutable archived history.",
        "Permit OWNER to resolve a failed-before-import attempt or uncertain import with a reason and version check; ambiguous remote outcomes stay UNCERTAIN until separately verified, with serializable concurrency/replay, immutable audit and no deletion.",
        "Provide OWNER/ADMIN private history and download, OWNER-only confirmation/resolution, STAFF/CUSTOMER/inactive actor denial across domain/actions/pages, private errors and no provider API calls.",
        "Build a mobile/keyboard/dark/light/axe-safe Books export and delivery wizard, QBO detail default, private company/edition, import checklist, prior batch resolution, safe download and real proof guidance; keep Books/Budget navigation.",
        "Prove QBO sample-format DETAIL, trial-bank matching/statement expectation, immutable hash, state transitions, quarantined retries and race, partial/unknown import, role denial and full browser workflow with disposable PostgreSQL and exact-head CI; document remaining 22 external gates."
      ],
      "remainingEngineering": [
        "Implement atomic QBO delivery/quarantine and verified import/retry decisions",
        "Implement owner wizard, delivery history/recovery, authorization",
        "Prove complete domain/unit/real-DB/browser/axe criteria, CI and handoff"
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

Intuit journal import guidance checked 2026-10-22: https://quickbooks.intuit.com/learn-support/en-us/help-article/import-export-data-files/import-journal-entries-quickbooks-online/L4tQBwbs7_US_en_US . QBO sample/tenant capability still requires verified trial import. Planning base main `4cff6f5fdb072c95d2f42210c0fafc3218e5ae4c`, freeze commit is docs-only before any production edit.
