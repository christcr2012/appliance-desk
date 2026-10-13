# PERF-INV5000 — invoice-list sort index and unchanged regression guard

**Independent measured performance correction; PR #435 under verification.** Not a new W-22 business capability and not an excuse to advance to W-23.

## Observed regression and root cause

The independent #429 performance run measured approximately **5.42 ms/op** for the 5,000-invoice listing against the 4.42 ms baseline +20% guard (**5.304 ms/op**). That red historical check is preserved even though subsequent runs sometimes passed. The actual owner billing page calls `getInvoicesCount()` and `getInvoicesPage(undefined, 0, 50)`. It orders invoices by `createdAt DESC, id DESC` with no matching sort-supporting index.

With the unchanged 5,000-invoice fixture on disposable PostgreSQL 17, the first-page SQL plan performed a sequential scan of **5,002** rows and a top-N heapsort (EXPLAIN execution **1.551 ms**). A temporary matching index switched the query plan to an ordered index-only scan of the top 50 rows (EXPLAIN execution **0.045 ms**). Same-run full count+page medians improved from **3.82 ms/op** (4.30, 4.06, 3.82, 3.70, 3.57) to **1.63 ms/op** (1.63, 2.40, 1.30, 1.49, 1.68), roughly 57% improvement. Independent runner variation remains possible.

## Minimal implementation

- Add Prisma `Invoice` index on `createdAt DESC, id DESC`, mapped to `Invoice_createdAt_id_idx`. Preserve existing unique primary ID, invoice number, customer, status, agreement and issue date indexes.
- Add forward-only additive migration `20261015210000_invoice_created_at_id_sort` with just `CREATE INDEX`. Explicit rollback if necessary: `DROP INDEX IF EXISTS "Invoice_createdAt_id_idx";`.
- Add a real migrated PostgreSQL test that asserts the index exists and sorts both keys DESC; retain the original 5,000-invoice count+page benchmark, fixture, baseline 4.42 ms, and +20% guard unchanged.
- Explain evidence in `docs/PERF-BASELINE.md`, schema contract in `docs/DATABASE.md`, and current handoff in `docs/STATUS.md`.

## Verified locally

Fresh, disposable PostgreSQL migration and seed succeeded. Unchanged real 5,000-invoice benchmark passed at **3.17 ms/op** (3.62, 3.17, 2.73, 2.93, 3.65) with the additional index assertion; Prisma schema validation and quick preflight, typecheck, lint, secret/static gate passed. Three unrelated existing lint warnings remained. These local results do **not** prove production latency or replace required exact-head CI, independent perf, review and release policy.

## Constraints and closure

No query API, invoice computation, actual customer records, Stripe state, tax behavior, ownership, refund, messaging, LIVE activation, spend, performance rebaseline, or manual Vercel release changes. Must meet required GitHub PR-context `ci` plus dedicated `Performance Baselines` and release-policy checks. Review all threads before merge; if Codex quota blocks automated review, document a concrete manual disposition. Recheck final-main CI after merge. W-22 PARTIAL, CPA IN-79 OPEN, W-23 blocked, owner IN-75/76 answers incorporated without money-out authorization.
