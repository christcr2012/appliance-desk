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

## Progress
Not started.
