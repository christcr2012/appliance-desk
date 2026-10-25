# AR-0 — Application kit, guards and three reference screens

Design: `docs/designs/APP-REDESIGN.md` sections 4–5. Build specs: `docs/build-specs/README.md` (read first),
`KIT.md`, `screens/TODAY.md`, `screens/MONEY-BILLS.md`, `screens/CUSTOMER-RECORD.md`. Visual targets:
`docs/build-specs/samples/`. Batch AR, first unit. Risk: **UI only** — no money, permission or provider behavior
changes. Read `docs/AI-PR-READ-FIRST.md` anyway: the Bills screen shows money and must keep role filtering.

## Why
Every desk page is built differently, explains itself in paragraphs and lists links. Chris wants one application
that looks and works the same everywhere, phone first. AR-0 builds the shared kit once and three finished screens that
every later unit copies.

## Split (two PRs, both in this card)
Write this reason in each PR: *the kit is reviewable on its own and is a dependency of AR-11/AR-12; the screens are
reviewable only against the kit.*
- **AR-0a — kit + guards** (steps 1–5). Merge when green.
- **AR-0b — the three screens** (steps 6–10), branched from `main` after AR-0a merges.

## Steps (in order)

**AR-0a**
1. **Tokens.** In `src/app/globals.css` add `--color-success-soft`, `--color-info-soft`, `--color-info-ink`,
   `--radius-field` in the light and dark blocks and the `@theme` mapping (KIT 1). Add their pairs to the existing
   contrast test.
2. **Dependencies.** `npm install --save-exact` the five packages in KIT 2. Commit `package-lock.json`.
3. **Date and word helpers.** In `src/lib/business-date.ts` add `formatShortDate`, `formatMonthYear`,
   `formatWeekdayDate`, `relativeBusinessDay`, `businessWeekStart`, `ordinal` (KIT 8, TODAY 2). Tests in
   `tests/business-date-display.test.ts`: each helper across both 2026 DST changes (Mar 8, Nov 1) and New Year.
4. **Kit components.** Create `src/components/kit/` with `types.ts` (KIT 3) and components 4.1–4.17, 4.19 (`Sheet`) and
   4.21 (`Icon`); `index.ts` exports them all. Logo per KIT 4.20 (no component; use `next/image` with
   `/brand/badge.svg`). One test per component in `tests/kit/<name>.test.tsx` covering the behaviors KIT lists
   (roles, keyboard, empty states, tone classes). Build in this order because later ones use earlier ones:
   Icon → StatusPill → ActionButton → ActionBar → EmptyState → Skeleton → Toaster → ConfirmDialog → Sheet → ScreenHeader →
   AreaTabs → StatusTabs → Toolbar → DataTable → SidePanel → RecordHeader/StatStrip → NextStepCard → InboxCard →
   Timeline → Fab.
5. **Guards.** `tests/kit-guards.test.ts` implementing KIT 9 rules 1–5. Create
   `docs/build-specs/migrated-pages.json` as `[]` (AR-0b fills it) and `scripts/kit-guard-allowlist.json` as
   `{ "entries": [] }` with the shape `{ "file": string, "rule": 3, "reason": string }`. The guard test must pass
   with an empty page list and must fail on a fixture page (`tests/fixtures/kit-guard-bad-page.tsx`) that breaks each
   rule once (one assertion per rule).

**AR-0b**
6. **Shared domain reads** (no UI yet): `pastDueInvoiceWhere(now)` in `src/domains/billing/index.ts` and switch
   `getRevenueDashboard` to it (TODAY 2); `src/domains/billing/bill-status.ts` and `bills-list.ts` (MONEY-BILLS 2–3,
   plus the optional `customerId` from CUSTOMER-RECORD 4.5); `src/domains/dashboard/weekly-health.ts`;
   `ExceptionItem.contact` (TODAY 2); `markTodoItems` refactor and the scoped `list*` parameter (CUSTOMER-RECORD 3);
   `src/domains/exceptions/inbox.ts`; `src/domains/customers/record.ts`. All their tests from the three specs.
7. **Today** per `screens/TODAY.md`.
8. **Money › Bills** per `screens/MONEY-BILLS.md`.
9. **Customer record** per `screens/CUSTOMER-RECORD.md`.
10. **Register the pages.** Add the three `page.tsx` paths to `docs/build-specs/migrated-pages.json`; add
    `loading.tsx` (skeleton) and `error.tsx` (KIT 5.3) next to each; add the three e2e specs to a group in
    `e2e/shards.json`; add one row to `docs/OWNER-CHECKLIST.md` (below). Update STATUS.

## Acceptance
- [ ] AR-0a: tokens in light and dark pass contrast; five dependencies pinned exactly; every kit component has a
      passing test; guard test passes on real pages and fails on the fixture for each rule.
- [ ] Today, Bills and Customer record match their samples at 390 px and 1280 px (spacing, order, words).
- [ ] Every string in the three specs' "Words" sections appears exactly; no page header description; no paragraph
      over 140 characters on the three pages (guard).
- [ ] Old links work: `/desk/billing?filter=delinquent|statements|deposits|waiting`,
      `/desk/customers/{id}?tab=overview|properties|service|billing` (tests in the params specs).
- [ ] Roles unchanged: STAFF sees the existing operational customer view and no money on Today; STAFF still refused
      on Bills (browser specs).
- [ ] No business behavior changed: the same server actions are called (review the diff: no edits under
      `src/domains/**` except the new read-only functions, the optional `ExceptionItem.contact`, the optional `scope`
      parameter and the `markTodoItems` move).
- [ ] Browser specs pass at the 5 sizes with axe (README definition of done).
- [ ] `ci` green at the exact head; every review comment read and answered.

## Owner checklist row to add (once)
"**Look at the new Today, Bills and Customer screens on the testing app.** Sign in to the testing app on your phone
(owner@example.test), open Today, then Money › Bills, then any customer. Ready when: AR-0b is merged and the 10 pm
testing release has run. Worked if: the screens look like the samples you approved; tell the agent anything you
want changed. This never blocks building."

## Open questions
None. If something comes up, write it here and in STATUS, and continue with the next step.

## Not in this card
Navigation shell, command bar and redirects (AR-1); install/offline/keyboard/optimistic helper (AR-11);
plain-words dictionary in the lint check, built-in views for other lists, Settings → Features (AR-12); moving
deposits/processing to Payments and inline payment sheets (AR-3); any other page.

## Progress
Not started.
