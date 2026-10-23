# M-1A — Shop and resale stock schema (built together with M-1B in one PR)

Approved by `docs/designs/BATCH-M.md` D-M1, D-M2, §2. Shop sales start after launch (IN-47), so every new screen and
behavior here is dormant until the owner marks an item "sell to customers" or ticks "bought for resale".

## Acceptance
- Additive migration: `PartRecord` gets `sellable`, `retailPriceCents`, `defaultForResale`, `resaleUnitsOnHand`,
  `resaleCostOnHandCents` (database CHECK: `0 ≤ resaleUnitsOnHand ≤ quantityOnHand`, `resaleCostOnHandCents ≥ 0`);
  `PurchaseOrderLineItem.forResale`; `PartStockMovement.resaleUnits` and `resaleCostCents`; `PartMovementKind` gains `SALE`
  and `SALVAGE`. Old rows keep working with defaults (0 / false). Backup manifest and schema health cover the new columns.
- Items-for-sale fields can be edited on the Parts screen (price in dollars, "usually bought for resale"), explained in
  plain words; a purchase-order line has a "bought for resale" box pre-ticked from the item, frozen once received.
- Tests on throwaway Postgres: migration defaults, the CHECK, the append-only ledger still blocks UPDATE/DELETE.

## Not in this card
Selling (M-1C/D), retired appliances (M-2), card payment (M-3), tax categories for merchandise (M-1C).
