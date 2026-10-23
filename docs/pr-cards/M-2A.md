# M-2A — Retired plans, parts taken from a retired appliance, and the lump scrap ledger (built with M-2B in one PR)

Approved by `docs/designs/BATCH-M.md` D-M4.

## Acceptance (checked with `tests/retired-appliance-plan-integration.test.ts`, `tests/scrap-payment-integration.test.ts`)
- One plan per retired appliance: Sell, Strip for parts, Scrap, Throw away, or Donate/other (note required). It can be
  chosen, changed or cleared ("Decide later") until marked done; only a retired appliance can have one.
- Choosing, changing, finishing or reopening a plan books nothing.
- "Strip for parts" adds parts to stock as `SALVAGE` movements at $0 cost linked to the appliance, once under retry, and
  needs the leftovers answered (scrapped / thrown away) to finish. The plan can't be switched away once parts were taken.
- A "Sell it" plan can't be marked done by hand (the sale finishes it; see M-2C).
- Scrap-yard money is entered once per check (`ScrapPayment`), posts bank in / "Scrap sales" income out once, and a void
  reverses exactly. Dump fees are an ordinary expense in a new "Dump and disposal fees" category.
- Reopen is owner-only with a reason.
