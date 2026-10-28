# AR-1 — Navigation: five areas, area tabs, profile menu, command bar

Design: `docs/designs/APP-REDESIGN.md` sections 4.1, 4.3, 4C, 7. Build spec: `docs/build-specs/screens/NAVIGATION.md`
(everything is decided there). Kit: `KIT.md`. Depends on **AR-0a**, **AR-11** (shortcuts, remembered lists, safe
areas) and **AR-12** (feature visibility, help guides). If AR-12 is not merged, skip its two hooks (feature filter,
Help group) and note it. Risk: **permissions** — the menu is a data surface: restricted links must never reach a
person who cannot open them (read `docs/AI-PR-READ-FIRST.md`).

## Why
Today's menu is grouped by category with a "More" page of leftovers. Chris wants an application: five areas used
every day, tabs inside each area, settings and account in a profile menu, and one search that finds anything.

## Steps (in order)
1. `src/lib/desk-areas.ts` + `tests/desk-areas.test.ts` (NAVIGATION 1). Rewrite `desk-navigation.ts` and
   `desk-sections.ts` as wrappers; update the six existing tests and `scripts/preflight.mjs` (NAVIGATION 7).
2. Kit shell: `AppFrame`, `Sidebar`, `TopBar`, `BottomBar`, `ProfileMenu`, `InboxCountBeacon`, `PageTitle` store,
   with tests in `tests/kit/`. Swap `AppShell` for `AppFrame` in `src/app/desk/layout.tsx` (pass the user's name,
   email and role from the session it already loads).
3. Area tabs in layouts: replace every `<SectionTabs …/>` with `<AreaTabs area=… />` and add the missing area
   layouts (NAVIGATION 2).
4. Command bar + `src/app/desk/command-actions.ts` (NAVIGATION 4) with tests.
5. Redirects and removals (NAVIGATION 5).
6. Browser spec `e2e/navigation.spec.ts` (add to a shard), STATUS entry, card Progress.

## Acceptance
- [x] Phone shows the 5-item bottom bar and area tabs; PC shows the sidebar (collapsible, remembered), top bar with
      the command bar field, and area tabs — matching the samples.
- [x] Staff never receives a link to a page it cannot open (unit test on the serialized props + browser test that
      opens every tab staff is shown). Job roles still narrow.
- [x] Every old URL still works; `/desk/more` and `/desk/control-center` go to Today.
- [x] Ctrl K / ⌘K opens the command bar anywhere; records, actions, areas and help are found; results respect roles.
- [x] The Today count shows without any new database query on other pages.
- [x] Axe + 5 sizes + keyboard (Skip to content, Tab order sidebar → top bar → main).
- [x] `ci` green at the exact head; every review comment read.

## Owner checklist row
None new (the AR-0 look-over row covers the new look).

## Not in this card
Moving pages' content (each area's unit does that); the Money overview page (AR-3); Settings sections (AR-8);
the in-app notifications bell (AR-13, after AR-2).

### Implementation and verification plan — October 27 (one full AR-1 outcome)

Approved scope: NAVIGATION 1–7, five areas and their safe tabs; profile/settings menu and help, responsive shell, server-checked command search and quick actions, redirects, Today count, accessibility and old-link compatibility. AR-11 and AR-12 are dependencies; if either remains open, keep this PR in review until its real acceptance is merged. No permissions are widened.

Acceptance evidence to record before merging:
- [x] `desk-areas.ts` is the sole role/job-role/feature-filtered source of five areas, active tabs and profile links, with all exact routes and finance restrictions checked.
- [x] Phone bottom bar and scrollable area tabs, desktop collapsible remembered sidebar, top search, profile menu, Today count with zero additional cross-page DB reads, keyboard skip/focus and theme/sign-out.
- [x] Command search and quick actions (2-character minimum; 150 ms debounce; grouped areas/actions/records/Help), server-side role-filtered existing search, and disabled/absent actions for staff.
- [x] Safe redirects for /desk/more and /desk/control-center, no existing deep URL broken, old menu wrappers work for remaining pages.
- [x] Security tests for each role and job-role, record search authorization on disposable PostgreSQL, client/component tests, five-width axe/browser and keyboard paths.
- [x] Docs/card and owner records accurate, full exact-head CI and Reviewgate green, no unanswered Codex findings. Phone real-world acceptance remains unchecked.

## Progress

Implementation accepted on PR #720 on October 28, 2026. Five-area navigation, staff/accountant and job-role filtering, screen-tab deep links, signed-in command search, profile/workspace access, responsive sidebar and bottom tabs, Today badge and legacy redirects were reviewed against the implementation and regression tests. GitHub CI run #40681386667 passed at code head `5e5a1553c57c7903c6ad09bd2942f05754f737c6`: secret scan; typecheck/lint and repository checks; three unit/database shards; five browser shards (including five widths and axe). All three Codex P2 findings have written dispositions and resolved threads. Review gate passed following the head-specific self-review on October 28. This documentation-only acceptance commit requires a new exact-head CI/review-gate check before merging. The separate owner real-phone look-over remains unchecked, and AR-2 is intentionally paused.
