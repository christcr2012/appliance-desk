# What changed in the code after Batches Câ€“F were designed

Batches Câ€“F were designed on 2026-10-02, before Batch B was built. Batch B changed
some things those designs assume. **Read this file with each design's "Verify before
starting" table**, and add a dated line here whenever a merged batch changes a rule,
a name, a status value or a table that a later design relies on. This file is the
running answer to "does the design still match the code?"; the design drift check
(`docs/designs/README.md`) starts here.

Last updated: 2026-10-05. **The D, E and F designs were rewritten on 2026-10-05 against `main` 47bd833 with everything below already folded in**, and B2/E2 were written fresh against the same code. From now on, add a dated entry here when a batch merges (B2's section 8 lists what to add for it).

## Rules a later batch must follow

| Change (Batch B) | What a later design must do about it |
|---|---|
| **Tax is stored as `taxRateMilliPercent`** (thousandths of a percent, 7375 = 7.375%). `taxRatePermille` is deprecated, kept in step by a database trigger, and removed in a later cleanup. Use `src/domains/billing/tax.ts`. | Never read or write `taxRatePermille`. Any design text that says permille is superseded. |
| **Money events are Receipts; Payments are per-invoice allocations.** Overpayment becomes a `CustomerCredit`. | Cash reports and "collected" read receipts (`collectedBetween` in `src/domains/billing/collected.ts`; categories in `categories.ts`). Do not sum ¶»§q«^