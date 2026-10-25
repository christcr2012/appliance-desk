# TFA-2 — Exemptions and switches that turn themselves on and off

Build spec: `docs/build-specs/engines/TAX-FEE-AUTOPILOT.md` sections 6–11. Requested by Chris 2026-10-25. Depends on
TFA-1. Risk: **retail delivery fees and use tax** (fixes a legal error: fees are refunded on returns today).

## Acceptance
- [ ] Every switch is prepared and dated by the app and approved by Chris on To do before it changes a bill.
- [ ] The date sales pass $500,000 is recorded automatically, once; the fee starts on the statute's date (June 15 → Oct 1).
- [ ] Jan 1 re-test switches the fee on or off by the prior year's sales, with To do warnings ahead.
- [ ] Returned sales keep the fee; cancellations before delivery credit it; exchanges add no new fee.
- [ ] Line reads "Retail delivery fees"; the pay-instead choice locks at the first qualifying sale.
- [ ] Use tax starts each year as yearly and switches to monthly only when that year passes the threshold.
- [ ] Filing-frequency advice (ask for less often / expect more often); certificate-expiry flow; license renewal roll.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
