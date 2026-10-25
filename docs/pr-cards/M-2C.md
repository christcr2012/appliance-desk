# M-2C — Sell a retired appliance

Design: `docs/designs/BATCH-M.md` M-2C. Built and merged in #551.

## Acceptance
- On **Sales → New sale** the owner/admin can add a used appliance (a retired appliance whose plan is "Sell it" and not done)
  with a price; items and used appliances can be mixed. Each appliance can be on only one live sale.
- Selling finishes the appliance's "Sell it" plan, removes its remaining book value from the books exactly once (one entry:
  book value of appliances sold, against the pending-disposition asset), and books the sale income in the same step.
  Selling is refused when the appliance has a recorded cost that is not on the book assets list, or its book retirement was
  not staged.
- Cancelling the sale reverses the book entry, books the void, and reopens the plan. A plan tied to a live sale cannot be
  reopened by hand.
- Reports and screens treat a sold appliance as zero value from the sale (history kept from the dated entries, so a sale
  cancelled later still counts for the dates in between).
- Tests: `tests/used-appliance-sale-integration.test.ts` (real Postgres).

## Added after the first merge (tax warning and accountant evidence)
- Pure estimate in `src/domains/sales/retired-sale-tax.ts` (`tests/retired-sale-tax.test.ts`, the design's acceptance cases): gain =
  price − the owner's selling costs − tax basis left; recapture = at most the depreciation taken; the rest is for the accountant.
  Unknown, expensed or incomplete evidence gives no numbers, only "CPA review needed". It never limits a price.
- The new-sale screen shows the warning, the book value, an optional "what it cost you to sell it" field and the estimate for each
  used appliance. Saving freezes the estimate in `RetiredSaleDisposition` (migration `20261025030000`) in the same step as the sale.
- A sale whose evidence is not CPA-confirmed puts one owner To do item on Today (never blocking). The owner marks it done on the sale
  page (safe to repeat). Cancelling the sale marks the record cancelled and removes the item.
- Tests: new cases in `tests/used-appliance-sale-integration.test.ts` (no evidence, confirmed, owner-typed, expensed, replay, cancel,
  owner-only follow-up, bad selling costs).

## Not in this card
- A separate gain/loss account: the sale price stays income (Sales of retired appliances) and the book value is one expense line.
  (Deliberate difference from the stronger-model prompt; the two sit side by side in reports and nothing is counted twice.)
- Real tax numbers: only evidence typed in or CPA-confirmed is used; nothing is computed from book depreciation.
