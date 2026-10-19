# K-CASH-1/2 — Secure banking evidence and typed cash journal bundle

Frozen complete original scope from `docs/designs/BATCH-K-CASH.md` §2, §3.1, §8 and §9, on merged main `72bdfc5b3f4e27d5b103726e08426a00f498052e`. Owner reaffirmed approval October 19, 2026; prior "documentation review pending" was superseded. Two **whole original subsections**, not invented helper units. All tests and code remain subject to the repository's exact-head CI, independent review and release controls.

## K-CASH-1 acceptance

1. Add complete, non-destructive Postgres/Prisma schema for CashAccount, BankImport, BankObservation, BankMatchGroup/Item, BankReconciliation, CashHold, BookCashEvent, and AccountingDelivery, using checked FK relations, scoped uniqueness/partial indexes, version and immutable-evidence columns, no sensitive full bank credentials.
2. Implement and migrate proper partial unique active bank file/external transaction and matched assignment claims, XOR group items, account-specific match-window bounds, one current statement revision, immutable completed evidence and owner-auditable source links; safe legacy database upgrade/rollback is forward-only and backup-aware.
3. Add the CASH_EVENT journal source and required owner-draw/interest accounts without guessing opening balances; finance-ordered monotonic posting revision covers every journal-producing writer and preserves unique balanced journal authority.
4. Extend existing private document/upload, backup manifests, restored populated data, schema health, route/type inventories and banking identity with no public statement exposure or deleted historical proof.
5. Run disposable PostgreSQL migration and database contract tests for FK/check/unique/partial races, populated backup-and-restore and original accounting source compatibility; no real bank/Stripe activation or production fixtures.

## K-CASH-2 acceptance

1. Provide a bounded settled-bank CSV parser and preview for 5 MiB/10,000 rows, UTF-8/BOM/quoted newlines, explicit date/sign/currency and field mapping, exact whole cents, 20-row preview, totals and all-or-nothing validation; redact sensitive descriptions, no remote reads, OCR, provider credentials or silent truncation.
2. Bind import preview to actor/account/file SHA/mapping/expected account revision with a short-lived signed token; reparse and revalidate identical source and account state on commit before any mutation.
3. Import accounts and observations serializably using file SHA, external ID uniqueness, occurrence-index fingerprints and explicit ambiguity/overlap choices; exact retry is idempotent, distinct identical legitimate purchases are retained and concurrent submissions cannot partially duplicate rows.
4. Correct a mis-mapped same-file import only through explicit owner-reviewed supersession with reason, frozen original raw/mapping evidence, dependent-reconciliation refusal, and atomic deactivation and replacement of active interpretation; ADMIN cannot override ambiguous correction.
5. Implement all six typed cash events (contribution, draw, transfer, interest, card payment, actual linked cash deposit) with validated positive cents, live OWNER role, typed source accounts/receipts, no unsupported manual journal or double cash source, and existing closed-month placement policy.
6. Void/retry typed events safely: command-key payload conflict detection, version guards, one source-backed balanced journal and exact immutable reversal, forbidden double/late void, transaction locks, no actual transfer or provider-money operation.
7. Create comprehensive pure and disposable PostgreSQL tests for CSV injection/PII/date/encoding, duplicate multiplicities, bad totals, permissions, import supersession/retry/concurrency, typed event debit/credit identities, receipt dedupe and reversal; maintain owner guide/status/decisions/acceptance separately.
8. Add private owner/admin read/preview capability to make source evidence verifiable without exposing unrelated account details to STAFF/CUSTOMER; full bank matching/reconciliation workflow screens remain K-CASH-3, not a K-CASH-2 shortcut.

Business cash authority is distinct from development: no actual bank account selected or opened, no bank OAuth, paid plan, production statement, live Stripe charge or external transfer. K-CASH-3 owns signed source match groups, reconciliation, budget cash eligibility and full bank screens. No amounts invented.

<!-- bundle-plan:start -->
```json
{
  "workKind": "ENGINEERING",
  "baseRevision": "72bdfc5b3f4e27d5b103726e08426a00f498052e",
  "outcome": "Set up secure durable bank evidence and safe typed cash-event accounting, then import settled CSV with explicit owner-controlled deduplication; no bank API, account opening or money movement.",
  "integrationBoundary": "Reuse K-2/K-5/K-8 books, mutable live actor role checks, immutable journal writer, private storage, backup manifest, Colorado date parser. K-CASH-3 owns actual reconciliation completion and full bank screens.",
  "newEngineering": "One additive cash-evidence migration with source revision/account roles; account/import/event domains; scoped security APIs and preview, populated migrations/backup, serial financial tests and owner guidance.",
  "estimatedProductionLines": 1700,
  "relatedWorkDecision": "K-CASH-1 and K-CASH-2 are the first two whole, tightly connected roadmap subsections after merged K-8. Provider-money and customer messaging remain excluded. K-CASH-3 awaits completed verified K-CASH-1/2.",
  "subsections": [
    {
      "id": "K-CASH-1",
      "acceptance": [
        "Add complete, non-destructive Postgres/Prisma schema for CashAccount, BankImport, BankObservation, BankMatchGroup/Item, BankReconciliation, CashHold, BookCashEvent, and AccountingDelivery, using checked FK relations, scoped uniqueness/partial indexes, version and immutable-evidence columns, no sensitive full bank credentials.",
        "Implement and migrate proper partial unique active bank file/external transaction and matched assignment claims, XOR group items, account-specific match-window bounds, one current statement revision, immutable completed evidence and owner-auditable source links; safe legacy database upgrade/rollback is forward-only and backup-aware.",
        "Add the CASH_EVENT journal source and required owner-draw/interest accounts without guessing opening balances; finance-ordered monotonic posting revision covers every journal-producing writer and preserves unique balanced journal authority.",
        "Extend existing private document/upload, backup manifests, restored populated data, schema health, route/type inventories and banking identity with no public statement exposure or deleted historical proof.",
        "Run disposable PostgreSQL migration and database contract tests for FK/check/unique/partial races, populated backup-and-restore and original accounting source compatibility; no real bank/Stripe activation or production fixtures."
      ],
      "remainingEngineering": [
        "Add complete, non-destructive Postgres/Prisma schema for CashAccount, BankImport, BankObservation, BankMatchGroup/Item, BankReconciliation, CashHold, BookCashEvent, and AccountingDelivery, using checked FK relations, scoped uniqueness/partial indexes, version and immutable-evidence columns, no sensitive full bank credentials.",
        "Implement and migrate proper partial unique active bank file/external transaction and matched assignment claims, XOR group items, account-specific match-window bounds, one current statement revision, immutable completed evidence and owner-auditable source links; safe legacy database upgrade/rollback is forward-only and backup-aware.",
        "Add the CASH_EVENT journal source and required owner-draw/interest accounts without guessing opening balances; finance-ordered monotonic posting revision covers every journal-producing writer and preserves unique balanced journal authority.",
        "Extend existing private document/upload, backup manifests, restored populated data, schema health, route/type inventories and banking identity with no public statement exposure or deleted historical proof.",
        "Run disposable PostgreSQL migration and database contract tests for FK/check/unique/partial races, populated backup-and-restore and original accounting source compatibility; no real bank/Stripe activation or production fixtures."
      ]
    },
    {
      "id": "K-CASH-2",
      "acceptance": [
        "Provide a bounded settled-bank CSV parser and preview for 5 MiB/10,000 rows, UTF-8/BOM/quoted newlines, explicit date/sign/currency and field mapping, exact whole cents, 20-row preview, totals and all-or-nothing validation; redact sensitive descriptions, no remote reads, OCR, provider credentials or silent truncation.",
        "Bind import preview to actor/account/file SHA/mapping/expected account revision with a short-lived signed token; reparse and revalidate identical source and account state on commit before any mutation.",
        "Import accounts and observations serializably using file SHA, external ID uniqueness, occurrence-index fingerprints and explicit ambiguity/overlap choices; exact retry is idempotent, distinct identical legitimate purchases are retained and concurrent submissions cannot partially duplicate rows.",
        "Correct a mis-mapped same-file import only through explicit owner-reviewed supersession with reason, frozen original raw/mapping evidence, dependent-reconciliation refusal, and atomic deactivation and replacement of active interpretation; ADMIN cannot override ambiguous correction.",
        "Implement all six typed cash events (contribution, draw, transfer, interest, card payment, actual linked cash deposit) with validated positive cents, live OWNER role, typed source accounts/receipts, no unsupported manual journal or double cash source, and existing closed-month placement policy.",
        "Void/retry typed events safely: command-key payload conflict detection, version guards, one source-backed balanced journal and exact immutable reversal, forbidden double/late void, transaction locks, no actual transfer or provider-money operation.",
        "Create comprehensive pure and disposable PostgreSQL tests for CSV injection/PII/date/encoding, duplicate multiplicities, bad totals, permissions, import supersession/retry/concurrency, typed event debit/credit identities, receipt dedupe and reversal; maintain owner guide/status/decisions/acceptance separately.",
        "Add private owner/admin read/preview capability to make source evidence verifiable without exposing unrelated account details to STAFF/CUSTOMER; full bank matching/reconciliation workflow screens remain K-CASH-3, not a K-CASH-2 shortcut."
      ],
      "remainingEngineering": [
        "Provide a bounded settled-bank CSV parser and preview for 5 MiB/10,000 rows, UTF-8/BOM/quoted newlines, explicit date/sign/currency and field mapping, exact whole cents, 20-row preview, totals and all-or-nothing validation; redact sensitive descriptions, no remote reads, OCR, provider credentials or silent truncation.",
        "Bind import preview to actor/account/file SHA/mapping/expected account revision with a short-lived signed token; reparse and revalidate identical source and account state on commit before any mutation.",
        "Import accounts and observations serializably using file SHA, external ID uniqueness, occurrence-index fingerprints and explicit ambiguity/overlap choices; exact retry is idempotent, distinct identical legitimate purchases are retained and concurrent submissions cannot partially duplicate rows.",
        "Correct a mis-mapped same-file import only through explicit owner-reviewed supersession with reason, frozen original raw/mapping evidence, dependent-reconciliation refusal, and atomic deactivation and replacement of active interpretation; ADMIN cannot override ambiguous correction.",
        "Implement all six typed cash events (contribution, draw, transfer, interest, card payment, actual linked cash deposit) with validated positive cents, live OWNER role, typed source accounts/receipts, no unsupported manual journal or double cash source, and existing closed-month placement policy.",
        "Void/retry typed events safely: command-key payload conflict detection, version guards, one source-backed balanced journal and exact immutable reversal, forbidden double/late void, transaction locks, no actual transfer or provider-money operation.",
        "Create comprehensive pure and disposable PostgreSQL tests for CSV injection/PII/date/encoding, duplicate multiplicities, bad totals, permissions, import supersession/retry/concurrency, typed event debit/credit identities, receipt dedupe and reversal; maintain owner guide/status/decisions/acceptance separately.",
        "Add private owner/admin read/preview capability to make source evidence verifiable without exposing unrelated account details to STAFF/CUSTOMER; full bank matching/reconciliation workflow screens remain K-CASH-3, not a K-CASH-2 shortcut."
      ]
    }
  ]
}
```
<!-- bundle-plan:end -->

## Evidence

Plan frozen in its own docs-only commit before code. No implementation, test pass, external bank acceptance, merge or production release is claimed at plan time.
