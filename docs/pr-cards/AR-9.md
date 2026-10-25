# AR-9 — Insights: Customers › Insights, Equipment › Insights, Money Overview additions (includes LD-4 and CU-3)

Design: `docs/designs/APP-REDESIGN.md` 4.1, 4D.5, 7; `docs/designs/LEADS-WORKSPACE.md` section 7 (LD-4);
`docs/designs/CUSTOMERS-WORKSPACE.md` section 6 (CU-3 insights). Build spec: `docs/build-specs/screens/INSIGHTS.md`.
Depends on **AR-3**, **AR-4**, **AR-6**, **LD-1**. Risk: **read-only reports plus one additive migration**
(`Lead.closedAt`) and a **job-role mapping change** that keeps today's access exactly.

## Why
Reports, Revenue, Fleet, Growth and the Dashboard are five separate pages of numbers. Chris gets the numbers where he
works: how leads and customers are doing on Customers › Insights, how the fleet is doing on Equipment › Insights,
and how rent is doing on the Money Overview — each with plain definitions and "Not enough data yet" instead of
misleading percentages.

## One PR
The three insight screens replace the same five pages and share the redirects, role wrappers and the job-role
mapping; splitting would leave old and new pages disagreeing.

## Steps (in order)
1. Fixes (INSIGHTS.md section 1): grouped lead-source query; `Lead.closedAt` migration + writers + backfill; job-role
   two-segment map; move the phone-cost section to `/desk/settings/telecom`.
2. `src/lib/business-hours.ts` + tests.
3. `src/domains/insights/{customers,equipment,money,thresholds}.ts` + integration tests.
4. Kit `MiniBars`; glossary entries.
5. Pages `/desk/customers/insights`, `/desk/inventory/insights`, `/desk/money/income`; Money Overview sections;
   `DESK_AREAS` tabs; redirects from growth, fleet, revenue, reports, dashboard.
6. `migrated-pages.json`; `e2e/ar9-insights.spec.ts` in a shard; STATUS; mark LD-4 and CU-3 done in their cards.

## Acceptance
- [ ] Every figure in INSIGHTS.md 4–6 is computed from recorded data with a definition (fixture tests).
- [ ] Speed to lead counts only opening hours and skips holidays and estimated first contacts (tests incl. DST).
- [ ] Win rate uses when leads closed; leads with no known close date are left out and the definition says so.
- [ ] Rates and averages wait for 10 leads/rentals; counts always show.
- [ ] Old pages redirect; `/desk/customers/insights` and `/desk/inventory/insights` don't hit the `[id]` pages.
- [ ] OWNER/ADMIN only; job roles keep exactly today's access (tests); staff refused by every insights function.
- [ ] Axe + 5 sizes, keyboard; `ci` green at the exact head; every review comment read.

## Not in this card
A "why they left" pick-list when a rental ends (would belong to "End this rental", AR-4a — reported as a gap);
charts beyond `MiniBars`.

## Progress
Not started.
