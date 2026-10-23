# O-2B — Close the gaps in "Change business settings"

Design: `docs/designs/BATCH-O.md` D-O2. Follow-up to O-2A (`docs/pr-cards/O-2A.md`).

## Why
O-2A let the owner take "Change business settings" away from one admin, but only the main settings save honoured it. An admin
with that permission removed could still change an appliance price, an appliance picture, a rental set, the month-to-month notice
rules, the lead scoring policy and the retired-appliance reminder days through their own screens. That defeated the limit.

## Acceptance
- These now need the same permission, checked inside the same database transaction as the change: appliance price, appliance
  picture, create / change / show-on-website / retire a rental set, month-to-month notice settings, lead scoring policy and
  the retired-appliance follow-up days. A limited admin gets the same plain message as everywhere else and nothing is written.
- Nobody gains access: the owner and every admin who has not been limited behave exactly as before. Staff still cannot.
- Operational actions (completing a retired plan, splitting an appliance, scheduling a follow-up on a lead, writing a payment
  link) are not "settings" and are unchanged.
- Test: `tests/capabilities-integration.test.ts` (real Postgres) limits an admin and proves each of the nine entry points refuses,
  the price and the sets are untouched, and the restored admin and the owner can again. `tests/lead-scoring-policy.test.ts` fake updated.

## Not in this card
- The role-shaped proof of what each admin page sends to the browser (the rest of the original O-2B title) stays open.
- GRANT_CREDIT, EDIT_PRICES, EXPORT_DATA as separate permissions (their guards are spread over several modules) and granting
  anything to staff (an owner decision; see the checklist).
