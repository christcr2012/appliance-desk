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
AR-5a started 2026-10-30 (Lane 6) — execution packet `docs/pr-cards/execution/AR-5A.json` (baseline `fa170dbd`, main after CU1-PERF #776); branch `ai/vivienne/ar-5a` in a native GitHub MCP workspace. AR-5a builds spec sections 1–4, 6–8 in slices S1–S6 per the packet; AR-5b (section 5) follows as its own PR. Drift found at packet time: section 1 fix 6 (Repairs area layout) is already delivered by AR-1's AreaLayout; the remaining section 1 fixes verified live against the tree (the maintenance read has no role check; `maintenancePriorityLabel` does not exist yet).
AR-5a built 2026-10-30 (Lane 6) — all six slices landed on `ai/vivienne/ar-5a`: shared words/pills + standalone fixes (S1), the Visits cursor list (S2), the Schedule board (S3), the visit record + hand-off toasts (S4), the Repairs cursor list + record (S5), and `e2e/schedule.spec.ts` + docs (S6). Local unit/integration suites green per slice; local full typecheck is environment-blocked in the lane VM (declared in the PR), so CI at the PR head is the deciding gate.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Start with SCHEDULE section 1 and the real `src/domains/jobs/{index,scope,scheduling,completion}.ts` and
   `src/domains/maintenance/index.ts`. Locate the existing page/action callers from those imports; spec URLs
   are target routes, not proof a same-named folder already exists. Preserve the existing scheduling writer.
2. Prove the staff route predicate first: own assigned jobs; unassigned only when the stored setting permits.
   Reuse it for list, count and route reads. Seed two staff and one job for each plus one unassigned; test each
   setting state. Confirm denied completion writes nothing.
3. Build AR-5a’s read models/labels/cursor before its Board and record UI. Include tie-breaking IDs in page
   ordering and test two jobs with identical timestamps across page boundaries. Then wire the existing
   completion action’s typed result to each specified hand-off toast (no money words for staff).
4. AR-5b extends the existing service worker/offline shell; first inspect its cache exclusions. Cache only the
   authorized route snapshot, partitioned by person and Denver day. Never cache mutation responses or replay
   a completion offline. Test A signs out → B signs in on the same phone, day rollover, and revoked access
   on the next online request, plus the spec’s poor-signal read path.
5. Run affected jobs/maintenance regressions and the new route-offline spec on the supported launcher.
   New browser paths go in `e2e/shards.json`; follow the card’s existing size/keyboard/axe acceptance.
