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

## Not in this card
- A browser test of the new-sale form with a used appliance.
- A separate gain/loss account: the sale price stays income (Sales of retired appliances) and the book value is one expense line.
