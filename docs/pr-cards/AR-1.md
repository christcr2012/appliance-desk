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
- [ ] Phone shows the 5-item bottom bar and area tabs; PC shows the sidebar (collapsible, remembered), top bar with
      the command bar field, and area tabs — matching the samples.
- [ ] Staff never receives a link to a page it cannot open (unit test on the serialized props + browser test that
      opens every tab staff is shown). Job roles still narrow.
- [ ] Every old URL still works; `/desk/more` and `/desk/control-center` go to Today.
- [ ] Ctrl K / ⌘K opens the command bar anywhere; records, actions, areas and help are found; results respect roles.
- [ ] The Today count shows without any new database query on other pages.
- [ ] Axe + 5 sizes + keyboard (Skip to content, Tab order sidebar → top bar → main).
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist row
None new (the AR-0 look-over row covers the new look).

## Not in this card
Moving pages' content (each area's unit does that); the Money overview page (AR-3); Settings sections (AR-8);
notifications bell (later, its own card).

## Progress
Not started.
