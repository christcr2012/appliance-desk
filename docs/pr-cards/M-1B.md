# M-1B — Resale movement costs and use-tax withdrawals (built together with M-1A in one PR)

Approved by `docs/designs/BATCH-M.md` D-M1 (which units a movement uses; moving-average resale cost) and D-M2.

## Acceptance
- `RECEIPT` of a resale line adds resale units and cost; `SALE` takes resale units first; `USAGE` and downward
  `ADJUSTMENT`/`RECOUNT` take ordinary units first; `REVERSAL` restores exactly what the original movement removed; the last
  resale unit removes exactly what remains. Invariants hold under retry and concurrent calls (same lock order as today).
- A movement that takes resale units records use tax on the cost it removed (`PurchaseUseTax`, `sourceType
  "PART_WITHDRAWAL"`, `sourceId` = movement id) through the existing use-tax recorder; a reversal cancels it (or opens the
  normal amendment when its return is filed). If the business tax address or rates are not ready, the stock change still
  happens and a visible To do says use tax is waiting; it is recorded the first time the tax setup is ready. Never silently lost.
- A resale-bought receipt creates no use tax ("Bought for resale"). Tax-paid units never owe it.
- Test from the design: sell out a $5 batch, receive a $10 batch, use one → use tax on $10, not $7.50.

## Not in this card
Selling screens and invoices (M-1C/D).
