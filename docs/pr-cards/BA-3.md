# BA-3 — Review this month: four checks, plain summary, accountant package and email, lock

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 3 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.
Depends on BA-1 (actor refactor and autopilot).

## Acceptance
- [ ] All required unit/throwaway Postgres and browser tests pass at the latest head (new regression tests added; CI pending).
- [ ] People-facing behavior of existing Books actions unchanged except where the spec says.
- [ ] `ci` green at the exact head; every review comment read.

## Implementation and acceptance checklist
- [x] Add additive `AccountingPeriod.reviewNotes`, `accountantSentAt`, `Expense.noReceiptReason`, and configurable accountant email/day fields; document backup/migration.
- [x] OWNER/ADMIN read the previous month's four reviews on `/desk/books/months/[month]`; only OWNER overrides checks, mails accountant or locks. Every read is source-based and bounded.
- [x] Automatically surface unlocked ended months as To do items, medium before and high after owner's configured reminder day.
- [x] Match source posting, expense receipts or documented no-receipt reasons, bank/Stripe reconciliation, and precise equipment depreciation periods without treating an uninitialized provider as an error.
- [x] Show a plain profit/collection/expense comparison and three largest expense categories from the existing ledger.
- [x] Generate an immutable accountant package and support explicitly requested, outcome-aware accountant email with attachments; never email automatically.
- [x] Close with four-check evidence and separately stated override reasons in a locked Serializable transaction; export missing entries atomically, protect closed periods.
- [ ] Test correctness, OWNER/ADMIN access, duplicate locking, uncertain provider email and edge dates on throwaway PostgreSQL; run browser checks and exact-head CI.
- [ ] Review every comment before merge; BA-2 must merge first and BA-1 must merge before BA-2.

## Progress
2026-10-26: PR #624 green at `6ce9232`, then Codex reported five blocking findings. Patches and targeted regressions committed afterward; that earlier run does not verify the new head. A second Codex pass reported and the branch patched read-only Stripe previews, cross-month journal attribution and previous-calendar-month comparisons. Exact-head CI, reviewer disposition and merge pending. Additive schema, review UI, owner-only actions, accountant packet and To do reminders implemented. No production/provider actions taken.

BA-3 implementation is in draft PR #624 stacked after BA-2 PR #613. The four-check review, owner lock and overrides, accountant CSV, explicit provider-outcome email, missing-receipt reasons, and reminder items are implemented. CI on reconciled head `ad2ba219` passed source checks, three unit/database shards and three browser shards, with one pre-existing offline reconnect test failing on browser-d. This patch keeps the offline recovery-link assertion while accepting a page already restored online, and adds real-database coverage for previously posted sources with unresolved warnings. New exact-head CI and review remain required.
