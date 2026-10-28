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
Started 2026-10-28 by Lane 4 (AR-7a Books first, branch `ai/vivienne/ar-7a`, baseline main `3c8e9799`).
Step 0a done: execution packet `docs/pr-cards/execution/AR-7.json` created (one packet for both slices,
the AR-2 pattern) and registered in the work index. Drift check: BA-1/BA-2/BA-3 pages and the report
functions the spec names are all on main (`profitAndLoss`, `getBookAssets`, `getBooksWorkspace`,
`getTaxWorkspaceOverview`, BOOKS_* attention in the taxes group). Two build notes: the kit has no
TaskCard yet — AR-7a adds one (the AR-3 ActionMenu precedent) — and the work index names the browser
spec `e2e/ar7-books-taxes.spec.ts`, which wins over the spec text's file name.
