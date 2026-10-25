# AR-5 — Schedule area: board, visits, my route (works with poor signal), repairs, visit record, hand-offs

Build spec: `docs/build-specs/screens/SCHEDULE.md` (everything is decided there). Design: `docs/designs/APP-REDESIGN.md`
4.1, 4.2, 4.3, 4B, 7. Approved by Chris 2026-10-25. Depends on **AR-0** (kit), **AR-1** (area frame), **AR-11**
(service worker + offline page, which this card extends for the route), **AR-12** (built-in views, searchable
picker). Risk: **who may see and work which visit** (staff route filter), **a copy of today's route kept on the
phone**. No scheduling, completion, billing or deposit rule changes. No migration.

## Why
Chris works from his phone in the truck. Today "My route" shows everyone's visits (staff then hit refusals), several
screens show stored codes ("DELIVERY", "IN PROGRESS", "URGENT") and times in the server's time zone, and finishing
a delivery or pickup doesn't tell him what happens next.

## Split (two PRs)
Reason: the route's on-device copy is a separate privacy/safety boundary with its own tests.
- **AR-5a** — spec sections 1–4, 6–8 (fixes, Board, Visits, visit record, hand-off toasts, Repairs) + tests.
- **AR-5b** — spec section 5 (My route with the person filter and the offline copy) + `e2e/route-offline.spec.ts`.

## Acceptance
- [ ] Every fix in spec section 1 is done, each with a test (route filter, labels, Denver times, maintenance role
      check, visits order/cursor, repairs tabs, "Finish visit…").
- [ ] Board: day/week/agenda, "Waiting for a time" capped, Schedule sheet books a visit including the double-booked
      confirm; staff see no schedule controls.
- [ ] Visits list tabs, search by appliance number and cursor paging work (integration test).
- [ ] My route: staff see only their own visits (plus unassigned when the setting allows); owner can switch to
      Everyone; the saved copy shows offline, only for the same person and today, and is removed on sign-out.
- [ ] Finishing a delivery/pickup/repair shows the hand-off toast from the spec table (staff never see money words).
- [ ] Repairs list and record use plain words and the existing status transitions.
- [ ] Axe, five sizes, light/dark, keyboard on every redesigned page; pages added to `migrated-pages.json`.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
