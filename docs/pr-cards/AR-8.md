# AR-8 — Settings: one place, sections, search, setting rows with history

Design: `docs/designs/APP-REDESIGN.md` 4.2(4), 4C, 4D.4–4D.7. Build spec: `docs/build-specs/screens/SETTINGS.md`
(everything is decided there). Depends on **AR-1** (profile menu, command bar, top bar back crumb) and **AR-12**
(feature visibility; `/desk/settings/features`). Uses DEC-1's Decisions & reviews when it is merged (feature-detected).
Risk: **settings writes** — no setting's behaviour changes; every save goes through its existing domain save
function, plus one generic row save that uses `updateBusinessSettings` with a per-field stale-page check.

## Why
Settings is one long page plus 16 sub-pages reached by link buttons, a few stored settings have no screen at all, and
nothing tells Chris what a value does, what it started as or how to put it back. After this card every setting is a
row he can find by search, with its explanation, "Restore recommended" and its history.

## Decisions already made (do not re-decide)
- Nine sections in this order: Decisions & reviews, Business, Prices & packages, Rentals & policies, Team & access,
  Messages & phone, Money & taxes, Website, Advanced. Old `?section=` ids redirect.
- Big editors (prices table, packages, team, terms text, Spanish wording, website) stay as they are and open from a
  row; tax setup, record retention, books and budget pages stay in Money and are linked rows (AR-7 owns them).
- Each person's own sessions and notification choices live in Your account, not Settings.
- The website banner fields stay unused (no screen reads them); reported, not built here.

## Steps (in order)
1. Fixes (SETTINGS.md section 1): bounded `checkUndo`, role check in `listSettingsHistory`, remove the
   no-revision `updateSettingsAction` fallback, with tests.
2. `src/domains/settings/catalog.ts` with every row, `NOT_A_SETTING`, and `tests/settings-catalog.test.ts`.
3. `updateBusinessSettings` accepts `{ keys, value }` revisions and returns the audit id (update callers);
   `saveSettingRowAction` + the delivery-window rule; export `setRetiredFollowUpDays` / `setApprovalExpiryDays`
   writers if needed; integration tests.
4. `getSettingsPage` (one settings read, one bounded history query) + tests.
5. Kit `SettingRow` and `SettingsLayout`; `src/app/desk/settings/layout.tsx`; rebuild `page.tsx` as sections of rows
   and panels (reusing the existing forms inside `Sheet`s); search; command-bar entries.
6. Add the settings pages to `docs/build-specs/migrated-pages.json`; `e2e/ar8-settings.spec.ts` in a shard; STATUS;
   card Progress.

## Acceptance
- [ ] Every BusinessSettings field is a row, part of a panel, or listed as not a setting with a reason (test).
- [ ] Every row explains what it does, its starting value and why, and who can change it; Restore recommended works.
- [ ] The eight stored settings that had no screen can be changed and are audited (tests).
- [ ] Saving from an old page is refused with the conflict message, for rows and sections (test).
- [ ] Each row shows who changed it last and when; History and Undo work from the row.
- [ ] Search finds rows by name and keyword; old section links land in the right place.
- [ ] ADMIN sees owner-only rows read-only and the server refuses their saves; STAFF never reaches Settings.
- [ ] Axe + 5 sizes, keyboard; `ci` green at the exact head; every review comment read.

## Not in this card
New settings from later cards (they add their catalog rows); notification preferences (AR-13); the banner.

## Execution packet (2026-10-28, base `5725161f` — Lane 6; build gated on AR-1)

Packet: `docs/pr-cards/execution/AR-8.json` (registered in the work-index). Sequence:
S1 fixes (spec section 1) → S2 catalog → S3 revisioned saves → S4 page data →
S5 kit rows + page rebuild → S6 registration + docs.

### Drift check (spec vs the repo as it stands at `5725161f`)

| # | Spec/card says | Repo reality | Resolution in this build |
|---|---|---|---|
| 1 | Depends on AR-1 (profile menu, command bar, top bar back crumb) and AR-12 (feature visibility) | AR-1 is not merged yet — PR #720 is open and in its final lap; AR-12's source is merged (#693/#695/#702/#716) | Packet and prep proceed now; the build starts the moment AR-1 merges. Packet references are anchored only to files AR-1 does not own; the step-5 command-bar entries are re-checked against the merged shell before that step is built |
| 2 | "Uses DEC-1's Decisions & reviews when it is merged (feature-detected)" | DEC-1 is merged — the decisions pages already sit in `docs/build-specs/migrated-pages.json` | The feature-detect stays (it is the spec's shape), with the live branch the expected path; the catalog's decisions section is built against the real pages |
| 6 | Settings save paths | The spec names the form fallback as the un-revisioned save | `updateTermsPolicyAction`/`updatePickupBillingAction`/`updateEarlyReturnAction`/`updateJobSchedulingAction` also save without a revision today | Left as the panels' own saves (outside the card's named scope; every row save and section save carries a revision) |
| 7 | §4.6 Your notifications link | Names `/desk/account/notifications` | That page is AR-13's and does not exist yet | The row links to `/desk/account` until AR-13 builds its page |
| 8 | §4.4 bank-payment / late-fee-warning rows | Listed among the Late payments rows | Both have their own owner-only forms with their own audit actions (BILL-1) | Panel rows over those forms — no behaviour or role change |
| 9 | §4.2 profile-extras panels | Sheet editors for hours / social links / logo / service area | Those fields live inside the one profile section form | The four panels open that existing form; splitting the extras into their own small forms is follow-up work |
| 10 | §4 section icons | Lucide names (scale, store, tag…) | The kit icon set has its own names | Mapped to the closest kit icons (help, home, money, equipment, customers, email, bill, map, gear) |
| 3 | The no-revision `updateSettingsAction` fallback is removed (spec section 1) | The fallback is live: `src/app/desk/settings/settings-form.tsx` still calls it | Step 1 removes it and moves its callers to the row/section actions, per spec section 8's test-update note |
| 4 | Old `?section=` ids redirect to the nine decided sections | Section ids already exist in `src/domains/settings/section-config.ts` and the current page | The catalog owns the old→new id map; the browser spec proves `/desk/settings?section=policies` lands on Rentals & policies |
| 5 | Work-index still records AR-0 as "AR-0b building" | AR-0b merged via PR #606 — every step 6–10 artifact is on main | Stale status only, no build impact; the AR-0 correction rides this card's close-out docs rather than this packet commit |

## Progress
Packet + drift check written 2026-10-28 by Lane 6 (prep only — no code yet). Build starts when AR-1 merges (PR #720).

- 2026-10-28 — Built on `ai/vivienne/ar-8` (Lane 6) in six steps: S1 spec §1 fixes (bounded `checkUndo`, self-guarding `listSettingsHistory`, the no-revision `updateSettingsAction` fallback deleted); S2 the catalog (`src/domains/settings/catalog.ts` — all 214 BusinessSettings fields are a row, a panel cover, or NOT_A_SETTING with a reason; coverage test reads the Prisma model); S3 the revisioned row save (`saveSettingRowAction`, keys-form `expectedRevision`, the delivery-window cross-field rule inside the locked save, `{ after, auditId }` return, `setApprovalExpiryDays` exported); S4 `getSettingsPage` (role/feature-shaped rows, one-query last-change walk, DEC-1 states); S5 the kit `SettingRow`/`SettingsLayout`, the settings frame layout, the catalog page (old section ids redirect; every existing editor opens from its panel row), command-bar entries; S6 registration (`migrated-pages.json`, `e2e/ar8-settings.spec.ts` in browser-a) and these docs. Verified locally: the new unit/integration suites green on Lane 6's own cluster (catalog 5/5, history bounds 5/5, row save 8/8, page data 4/4), preflight exit 0, full typecheck clean.
