# M-2B — Retired workflow screens, scrap receipts and the Today reminder (built with M-2A in one PR)

## Acceptance
- Appliance page: a "What's next for it?" panel on retired appliances (choose, note, add parts, mark done, owner reopen).
- `/desk/inventory/retired` (tab "Retired" under Equipment): list with filters (All, Decide later, Sell, Parts, Scrap,
  Throw away, Other, Done), "Mark a truckload done" for scrap / throw-away / other plans, the "Scrap money received" list
  with entry and void, and the reminder-days setting (starts at 30, 0 = never).
- Today shows one item "Retired appliances waiting on a decision (n)" when a retired appliance has had no plan, or an
  unfinished one, for at least the owner's number of days (Denver days; 29/30/31 tested); never per appliance.
- Owner and admin only. Backup, restore order, route inventory, owner guide and menu tests updated.

## Not in this card
A browser spec for the new screens, and selling a retired appliance (M-2C, stopped by S-M3; see
`docs/designs/M-2C-STRONGER-MODEL-PROMPT.md`).
