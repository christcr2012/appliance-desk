# M-2C — Sell a retired appliance: prompt for a stronger model (stop rule S-M3)

**Why this exists.** `docs/designs/BATCH-M.md` S-M3 says to stop and amend Batch K before implementing the sale of a
retired appliance if the books cannot post a single actual-sale gain/loss entry. Checked 2026-10-23:
`retireBookAsset` (`src/domains/books/fixed-assets.ts`) moves an appliance's carrying value into
`RETIRED_PENDING_DISPOSITION`, but nothing takes it out again when the appliance is sold, and the chart has only
`DISPOSAL_LOSS` (no gain account). Booking a used-appliance sale as plain income (what a `USED_APPLIANCE` invoice line does
today) would leave the asset on the books forever and double count the profit.

## Task
Let the "Sell it" plan produce a real sale of that one appliance and finish the plan automatically.

## Requirements
1. Books (Batch K, per `docs/designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md`): when a sale invoice containing a
   `USED_APPLIANCE` line tied to a retired appliance is recognised, post **one** balanced disposal entry that clears that
   appliance's `RETIRED_PENDING_DISPOSITION` carrying amount and books the difference to a gain-or-loss account
   (add the account in the chart *and* a migration row, like `SCRAP_INCOME`). Proceeds stay in `RETIRED_APPLIANCE_SALES`
   as a separately shown sales figure; gain/loss = proceeds minus carrying amount minus seller costs. A void of the sale
   reverses both entries. Never re-expense the original cost.
2. Sales (`src/domains/sales/index.ts`): extend `createShopSale` items with `{ applianceId, unitPriceCents }` for a retired
   appliance whose plan is SELL and not done. One unit only; refuse a second sale of the same appliance (unique link).
   Tax category `USED_APPLIANCE_SALE`. Mark the plan done (date = sale date) in the same transaction; cancelling the sale
   reopens it.
3. The new-sale screen picker lists SELL-plan appliances ("used appliances for sale").
4. Section 1245 recapture is a CPA estimate only (IN-46); do not invent a legal price ceiling.
5. Tests on throwaway Postgres: sale posts once; carrying value cleared exactly; gain and loss cases; void reverses;
   cancel reopens the plan; two sales of one appliance refused.
