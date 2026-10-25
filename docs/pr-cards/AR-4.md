# AR-4 — Customers area: Rentals, Leads, Customers list, Quotes, Messages

Design: `docs/designs/APP-REDESIGN.md` sections 4.1, 4.3 (hand-offs), 7. Build specs (decided there):
`screens/RENTALS.md`, `screens/LEADS.md`, `screens/CUSTOMERS.md`, `screens/QUOTES-MESSAGES.md`; engines
`engines/LEADS-PIPELINE.md` (LD-1). Approved by Chris 2026-10-25. Depends on AR-0b, AR-1, AR-11, AR-12.

## Split (four PRs, any order after their prerequisites)
Reason: each list is an independent, usable screen with its own data and risks; together they are unreviewable.
- **AR-4a — Rentals** (`RENTALS.md`): list, record, "End this rental", the "Mark ended" confirmation fix, plain visit
  words, `getAgreementsCount` role check. Risk: rental endings (existing actions only).
- **AR-4b — Leads** (`LEADS.md`), after **LD-1**: queue, record, bulk, board, quote-for-an-existing-lead, lead
  editing, lead export.
- **AR-4c — Customers list** (`CUSTOMERS.md`): the CU-1 engine (view, segments, search, capacity) and the screen.
- **AR-4d — Quotes and Messages** (`QUOTES-MESSAGES.md`): paged quotes, role checks on quote reads, inbox words,
  "Link to a person…".

## Hand-offs (design 4.3) that land in this card
- Quote approved → the Quotes card's primary is "Make it a rental" (AR-4d).
- Rental signed → the rental's next step "Schedule the delivery" (AR-4a). Delivery-done and pickup-done toasts come
  with the visit record in AR-5.
- Rental ending → "Decide…" next step opens "End this rental" (AR-4a).

## Acceptance (per PR; each PR's spec "Tests" section is its checklist)
- [ ] Old URLs keep working (params tests).
- [ ] Staff see what they see today and no money (browser specs).
- [ ] Every money or irreversible action goes through its existing confirmation.
- [ ] Axe + 5 sizes; `ci` green at the exact head; every review comment read.

## Progress
Not started.
