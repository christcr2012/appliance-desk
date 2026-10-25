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

## Finished in the follow-up PR (`tests/shop-sale-delivery-fee-integration.test.ts`, `tests/used-appliance-sale-integration.test.ts`)
- **Colorado retail delivery fee on a delivered sale.** Only a delivery to a Colorado address that holds at least one item the
  state taxes counts, once per sale (`RetailDeliveryFeeRecord`, key `retail:<invoice>`, no agreement or job). Goods ignore the
  rental lease election. The same applicability, rate-by-sale-date and pending states as rentals; pending records finish later
  and the business pays them (the customer has gone). When the owner chose "collect" and customer charging is switched on, one
  separate untaxed "Colorado retail delivery fee" line is added before tax is figured; with charging off or "pay myself" the
  fee is still counted and reported with nothing added for the customer. Pickups and out-of-state deliveries owe nothing.
  Shop sales now count toward the Colorado retail-sales total used for the small-business exemption.
- **Cancel or take back reverses it.** Cancelling an unpaid sale or taking back a paid one marks the record not due; a fee the
  customer paid is tied to the real refund so a fee already reported can be claimed as a credit (design BATCH-T 12.5).
- **Taking back a used appliance.** Same refund path as parts; the appliance's book value returns with one reversing entry,
  its "Sell it" plan opens again, its saved tax note is closed (no accountant follow-up), the sale line stays for the record but
  the appliance can be sold again. A second tap changes nothing.

## Known edge (not built)
A sale cancelled while unpaid, after its fee was already reported on a filed Colorado return, shows the generic "refund an
over-collected fee" To do item even though nothing was collected. Rare; the owner can ignore it and tell the accountant.
