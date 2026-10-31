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
AR-4a (Rentals) is merged (PR #723). AR-4b (Leads) is merged — see the top
STATUS entry and packet AR-4B: queue, record, bulk actions, board,
quote-for-an-existing-lead, lead editing and CSV export, all on the kit.
AR-4c (Customers list) is merged (Lane 5, packet AR-4C, PR #761, squash
125fb162; the native-workspace pilot card — see the top STATUS entry).
One follow-up is named: "CU-1 perf: base-table query redesign". AR-4d
(Quotes and Messages) is merged (Lane 5, packet AR-4D, PR #773, squash
32263c85 — see the top STATUS entry). Its packet names the same CU-1 perf
follow-up next. **That follow-up is now complete:** CU1-PERF merged (Lane 5,
PR #776, squash fa170dbd) — the Customers list reads run on base tables;
the two budgets the redesign could not meet at the 20,000-customer seed
(attention sort, segment counts) were amended to 300 ms by the owner's
2026-10-30 ruling (CUSTOMERS.md §1). See the top STATUS entry.

**The CU-1 chain is now fully closed:** CU1-VIEW (packet CU1-VIEW, following
CU1-PERF) retired the `customer_list_v1` view itself — CU1-PERF had moved
every production read to base tables and left the view "for other readers
until a separate card retires it"; its only remaining readers were the two
oracle queries in `tests/customer-list-integration.test.ts`, which now
compute the segment facts from the base tables directly. Migration
`20261218000000_customer_list_view_retire` drops the view; no table, column
or data changes. See the top STATUS entry.
