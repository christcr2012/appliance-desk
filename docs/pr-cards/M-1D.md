# M-1D — Shop sales screens

## Acceptance
- `/desk/sales` lists sales (newest first, 100 shown) with who, what, pickup or delivered, status and total.
- `/desk/sales/new` takes items (price filled from the Parts screen, a reason required when lower), a customer or
  walk-in, pickup or delivery (address and optional delivery and installation charges), and a note. The screen sends one
  identity per page load so a double tap cannot make two sales. Tax problems are shown in plain words.
- `/desk/sales/[id]` shows the lines, tax by area and totals, **Record a payment** (the existing manual-payment action) and
  **Cancel this sale** while unpaid.
- Owner and admin only; Shop sales is a tab under Money. Both list screens are in the accessibility route inventory.

## Not in this card
A browser test that rings up a sale (the CI seed has no tax setup or sellable part; sale behavior is proved on real Postgres).
