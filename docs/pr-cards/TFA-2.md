# TFA-2 — Exemptions and switches that turn themselves on and off

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 6–11. Requested by Chris 2026-10-25. Depends on
TFA-1. Risk: **retail delivery fees and use tax** (fixes a legal error: fees are refunded on returns today).

## Acceptance
- [x] Every switch is prepared and dated by the app and approved by Chris on To do before it changes a bill.
- [x] The date sales pass $500,000 is recorded automatically, once; the fee starts on the statute's date (June 15 → Oct 1).
- [x] Jan 1 re-test switches the fee on or off by the prior year's sales, with To do warnings ahead.
- [x] Returned sales keep the fee; cancellations before delivery credit it; exchanges add no new fee.
- [x] Line reads "Retail delivery fees"; the pay-instead choice locks at the first qualifying sale.
- [x] Use tax starts each year as yearly and switches to monthly only when that year passes the threshold.
- [x] Filing-frequency advice (ask for less often / expect more often); certificate-expiry flow; license renewal roll.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Built on branch `ai/vivienne/tfa-2` (from main `38e92a98`; main merged in at `50e265e`, merge `27397b9`). All spec sections are coded and tested:

- §6 RDF autopilot: the nightly job records the $500,000 crossing date once, from the crossing invoice (cancelled-before-delivery sales removed, returned refunds netted per agreement); the fee starts on the statute date (`rdfQualifiedEndsOn`: first of the month after the crossing month, plus 90 days). Switches are prepared and dated by the app (`RetailDeliveryFeeSwitch`) and change a bill only after Chris approves on To do; until then the fee is owed but not billed. The Jan 1 re-test prepares a STOP or START from the prior year's final total. Returns keep the fee; pre-delivery cancellations credit it; exchanges add no fee (`Invoice.replacementOfInvoiceId`); the line reads "Retail delivery fees" (the old wording still attaches from Stripe history); the pay-instead choice locks at the first qualifying sale.
- §7 use tax: every Jan 1 the account resets to one yearly return (audited, with a Today note); it switches to monthly only when that same year's use tax passes the limit, never from last year's total.
- §8 filing-frequency advice: `FilingFrequencyAdvice` rows from the trailing-12-month average of state and state-collected tax vs the rule-book limits; less-often advice on the 1st of any month, more-often only in December; the app never changes frequency itself — Chris asks Colorado in Revenue Online, then confirms with one tap (future periods only).
- §9 certificates: an expired certificate with bills since gets a Today item with a drafted ask (DR 0715 / DR 5002 / MTC form); a back-dated certificate earns the customer a credit for tax charged since it took effect, in its areas only; issued bills never change.
- §10 license: a new sales-tax account's license expiry defaults to Dec 31 of the odd year in force (2027-12-31 today); "mark renewed" rolls to the next odd year; the Today reminder follows the timing setting instead of a fixed 60 days.
- §11 verification: all packet unit + database files pass in calm local batches on the merged tree (45 + 23 tests), plus every file the one giant combined local run flagged under load (each re-run calmly and green; the one custody date test is a local-clock artifact — it passes when the throwaway database runs on UTC, as CI does). Browser spec and exact-head CI run with the PR.

## Drift (2026-10-26, card baseline 0516a31 → main 38e92a98)

| Card assumption | Actual at main (path + symbol) | Kind | Correction / test |
|---|---|---|---|
| TFA-1 rule book exists | `src/domains/rules/` (registry, reads, timing, true-up) on main via TFA-1 `cb1c3618` | Dependency met | None; build reads rules via `ruleAsOf` as the spec assumes |
| `rdfNewBusinessStartsOn(crossedOn, frequency)` | Same function exists, but it rounds by filing frequency, contradicting the statute formula for QUARTERLY/ANNUAL | Semantic | Packet gate TFA-2-G3; replace with `rdfQualifiedEndsOn` |
| A paid sale can be cancelled before delivery with everything refunded | No such path: `cancelShopSale` refuses paid sales, `returnShopSale` has no delivery check | Semantic gap | Packet gate TFA-2-G1; Decisions question filed; build the most likely answer (cancel is unpaid/never handed over, return is paid/handed over) |
| Filing-frequency advice is a monthly job | `tax-filing-calendar` runs daily at 18:05 (`src/domains/automation/health.ts`) | Mechanical | Advice logic lives in the daily run with once-per-year dedup |
| DR 0563 is mentioned somewhere to replace | Zero mentions of DR 0563, DR 0715, DR 5002 or MTC in the repo | Mechanical | Form names are new strings to introduce |
| License reminder uses the timing point | Fixed 60/30/7-business-day stages (`licenseReminderStage`); `whenToAct` has no production callers | Semantic | Move the reminder to the timing point; wire `whenToAct` |
