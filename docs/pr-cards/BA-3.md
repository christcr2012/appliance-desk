# BA-3 — Review this month: four checks, plain summary, accountant package and email, lock

Build spec: `docs/build-specs/engines/BOOKS-AUTOPILOT.md` section 3 (everything decided there; section 0 lists the
code gaps this fixes). Design: `docs/designs/BOOKS-AUTOPILOT.md`. Approved by Chris 2026-10-25. Risk: **books
entries (money records)** — never edit or delete entries; corrections are new entries; locked months stay locked.
Depends on BA-1 (actor refactor and autopilot).

## Acceptance
- [ ] Every test listed in spec section 3 passes on throwaway Postgres.
- [ ] People-facing behavior of existing Books actions unchanged except where the spec says.
- [ ] `ci` green at the exact head; every review comment read.

## Implementation and acceptance checklist
- [ ] Add additive `AccountingPeriod.reviewNotes`, `accountantSentAt`, `Expense.noReceiptReason`, and configurable accountant email/day fields; document backup/migration.
- [ ] OWNER/ADMIN read the previous month's four reviews on `/desk/books/months/[month]`; only OWNER overrides checks, mails accountant or locks. Every read is source-based and bounded.
- [ ] Automatically surface unlocked ended months as To do items, medium before and high after owner's configured reminder day.
- [ ] Match source posting, expense receipts or documented no-receipt reasons, bank/Stripe reconciliation, and precise equipment depreciation periods without treating an uninitialized provider as an error.
- [ ] Show a plain profit/collection/expense comparison and three largest expense categories from the existing ledger.
- [ ] Generate an immutable accountant package and support explicitly requested, outcome-aware accountant email with attachments; never email automatically.
- [ ] Close with four-check evidence and separately stated override reasons in a locked Serializable transaction; export missing entries atomically, protect closed periods.
- [ ] Test correctness, OWNER/ADMIN access, duplicate locking, uncertain provider email and edge dates on throwaway PostgreSQL; run browser checks and exact-head CI.
- [ ] Review every comment before merge; BA-2 must merge first and BA-1 must merge before BA-2.

## Progress
Acceptance plan committed first on stacked branch `ai/chatgpt/ba-3` from BA-2. Implementation not yet verified.
