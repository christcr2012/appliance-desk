# CMP-2 — Income tax helpers (federal and Colorado)

Build spec: `docs/build-specs/engines/COMPLIANCE.md` CMP-2. Depends on CMP-1, BA-1. Risk: **tax estimates** (always
labelled estimates; no invented numbers).

## Acceptance
- [x] Every books account maps to a Schedule C line (test); the accountant packet (CSV + PDF) ties to posted books.
- [x] 4562 and 4797 worksheets from fixed assets and sales, using dated §179/bonus rules, marked "your CPA confirms".
- [x] Quarterly 1040-ES and DR 0104EP amounts by the safe-harbor method; first year without last year's tax → asks, never guesses.
- [x] Filled vouchers + payment links; the app never pays.
- [x] 1099-K tie-out from Stripe data; `ci` green; every review comment read.

## Progress
Built 2026-10-27 (Lane 5, Vivienne) on branch `ai/vivienne/cmp-2`; the CMP-3 close-out rides at the base of
the branch. What shipped:

- **Schema** (migration `20261110000000_cmp2_income_tax`, additive): `LedgerAccount.scheduleCLine`, filled
  for every system account from the system chart (the chart carries the same values; owner-added accounts
  stay unmapped and fall to line 27a, Other expenses, listed by name — nothing dropped or guessed); new
  `TaxYearFacts` (one row per finished year: federal tax, federal AGI, Colorado tax, the typed 1099-K
  gross), registered in the backup manifest.
- **Schedule C + packet** (`src/domains/compliance/schedule-c.ts`): year totals from the posted journal
  lines of the tax year, grouped by Schedule C line with the form's subtotals; the accountant packet
  downloads as CSV and as a generated PDF from the approved filing only. The packet includes the 1099-K
  tie-out, both worksheets and the home-office note when the facts say a home office is used.
- **Worksheets** (`worksheets.ts`): 4562 from BookAssets placed in service in the year + their latest tax
  evidence (assets without evidence are listed as needing CPA review with no figures), with the year's
  dated §179 limit and bonus percentage from the rule book when present; 4797 from the year's
  RetiredSaleDispositions — the Section 1245 estimate frozen at sale time, never recomputed.
- **Estimates** (`estimates.ts`, `tax-facts.ts`): safe harbor = 100% of last year's tax (110% when last
  year's federal AGI is over $150,000), a quarter per payment, for both federal and Colorado (the Colorado
  method is confirmed against the official 2026 DR 0104EP instructions; the 70%-of-actual alternative is
  not computed — DQ-CMP-CO-EST). No prior-year facts → no number: the filing says to use the CPA's
  estimate. Facts are entered by the owner on Business facts ("One year's tax figures").
- **Vouchers**: the federal voucher fills the vendored 1040-ES booklet (CMP-1's engine); the Colorado
  voucher fills the official DR 0104EP 2026 PDF vendored from tax.colorado.gov (SHA-256
  2b4e33fe…, manifest-pinned; the fillable voucher is page index 4). The owner's name and SSN are typed at
  download time and used only inside that request — never stored, logged or audited. Payment links: IRS
  Direct Pay and Colorado Revenue Online. The app never pays and nothing is filed by the app.
- **1099-K tie-out** (`k-reconciliation.ts`): monthly buckets from the stored StripeBalanceTransaction
  rows (charges, fees, refunds, disputes) against the typed 1099-K box 1a, the difference shown. No live
  Stripe call.
- **TXF omitted on purpose**: the spec allows TXF only after confirming the format spec from an official
  or vendor source; no authoritative TXF 042 specification could be confirmed (secondary summaries only;
  FDX is superseding it). The packet CSV stays. This is the packet's recorded drift for the item.
- **Decisions filed**: DQ-CMP-CO-EST (Colorado estimate method — prior-year prong only). No new owner
  checklist rows; none ticked.
