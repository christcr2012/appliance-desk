# AR-7 — Money › Books and Money › Taxes on the kit

Build spec: `docs/build-specs/screens/BOOKS-TAXES.md` (replaces design units BA-4, BA-5, BA-6 for these pages).
Approved by Chris 2026-10-25. Depends on BA-1 (and shows BA-2/BA-3 pages when merged), AR-0, AR-1, AR-12.
Risk: none to money rules — layout, words and read-only summaries only.

## Split
Reason: Books and Taxes are separate page families with separate tests.
- **AR-7a — Books** (spec section 1).
- **AR-7b — Taxes** (spec section 2).

## Acceptance
- [ ] Every old Books/Taxes URL renders inside its new frame (browser spec).
- [ ] KIT guards pass for every page (no bare link lists, no long paragraphs).
- [ ] Summary numbers match the existing report functions (unit test); equipment totals match the ledger.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
