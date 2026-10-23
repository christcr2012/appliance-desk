# M-1C — Atomic local shop sale (create and cancel)

Approved by `docs/designs/BATCH-M.md` D-M3 (shop sales are local invoices; the walk-in customer is hidden).

## Acceptance (checked with `tests/shop-sale-integration.test.ts` on real Postgres)
- `createShopSale` makes one local invoice with a MERCHANDISE line per item (plus optional delivery and installation
  lines), figures sales tax by destination (pickup = the shop's tax areas, delivery = the customer's address), takes the
  units out of stock with `SALE` movements, and writes an audit entry — all in one transaction. Any missing piece (tax
  setup, stock, price, a part not marked "Sell to customers") refuses the whole sale and saves nothing.
- A retry with the same key returns the first sale; the same key with different contents is refused.
- Selling below the listed price needs a reason, which is kept in the audit entry.
- A walk-in sale uses one hidden built-in customer with no sign-in; it is never in customer lists, search or counts.
- `cancelShopSale` voids an unpaid sale and restocks with `REVERSAL` movements; a repeat changes nothing; a sale with
  money on it is refused (it needs a return and refund).
- Books: the sale posts through the normal invoice poster; "Items sold" and "Used appliance sale" have their own income accounts.

## Not in this card
Returns and refunds of paid sales, and the Colorado retail delivery fee on delivered sales (follow-up, see STATUS).
