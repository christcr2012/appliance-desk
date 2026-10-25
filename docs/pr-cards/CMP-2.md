# CMP-2 — Income tax helpers (federal and Colorado)

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-2. Depends on CMP-1, BA-1. Risk: **tax estimates** (always
labelled estimates; no invented numbers).

## Acceptance
- [ ] Every books account maps to a Schedule C line (test); the accountant packet (CSV + PDF) ties to posted books.
- [ ] 4562 and 4797 worksheets from fixed assets and sales, using dated §179/bonus rules, marked "your CPA confirms".
- [ ] Quarterly 1040-ES and DR 0104EP amounts by the safe-harbor method; first year without last year's tax → asks, never guesses.
- [ ] Filled vouchers + payment links; the app never pays.
- [ ] 1099-K tie-out from Stripe data; `ci` green; every review comment read.

## Progress
Not started.
