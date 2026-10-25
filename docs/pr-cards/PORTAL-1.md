# PORTAL-1 — Customer portal redesign

Build spec: `docs/build-specs/screens/PORTAL.md` (everything is decided there). Approved by Chris 2026-10-25 ("Yes,
redesign it too"). Depends on AR-0a (kit), AR-12 (plain-words list) and AR-1 (kit `Icon` additions follow its
pattern); runs after the desk units per DECISIONS.md. Risk: **customer-facing pages, Pay now, Spanish** — read
`docs/AI-PR-READ-FIRST.md` (customer isolation, payments) and say in the PR how each item is honored.

## Why
Customers see paragraphs under every heading, accounting words ("invoice", "frozen statement"), money added up in
page code, and "Report a problem" meaning appliance repairs while the app-feedback box needs that idea too. The portal
should feel like the redesigned desk: phone first, one clear "Needs you" item, short words, in English or Spanish.

## One PR
All six pages share the shell, the kit words in Spanish and the new portal dictionary; converting half would leave
customers with two looks and two vocabularies. No split.

## Steps (spec sections)
1. Fixes 1.1–1.5 (money totals moved to `src/domains/agreements/totals.ts`, `<main>` fix, repair wording, no
   header paragraphs, dictionary).
2. Kit words provider + portal Spanish (section 4).
3. Shell (section 4), then Home, Rentals, Repairs, Bills, Properties, Account (section 5).
4. Guards and plain-words scan for `src/app/account` (section 7).
5. Tests (section 8). PR lists every changed English string for Chris's translator.

## Acceptance
- [ ] Every portal page is on the kit, in `migrated-pages.json`, with no header paragraph.
- [ ] No money math in portal page code (`monthlyTotalCents`, `balanceCents` come from the domain; unit test).
- [ ] "Needs you" shows the right first item (late bill → Pay now, unsigned rental → Sign, due soon → Open bill).
- [ ] Rentals' ending and renewal forms open in sheets and call the same actions (browser test).
- [ ] Repairs `?request=repair` and `?request=pickup` open the right sheet; repair wording never says "Report a problem".
- [ ] Bills tabs and property filter work from the loaded statement; Pay now uses the existing route.
- [ ] Customer A never reaches B's data through any portal page, action or download (extended isolation tests).
- [ ] Every new string has Spanish; kit words appear in Spanish when Spanish is active (test).
- [ ] axe + keyboard at 360, 390, 820, 1280, 1920 px, light and dark; no sideways scrolling.
- [ ] `ci` green at the exact head; every review comment read.

## Owner checklist / decisions
No checklist row. Decisions & reviews gets one translator subject ("Portal wording, {date}") listing the changed
strings; Spanish stays off until the reviewed copy is re-recorded (existing IN-83 rule). Never blocks merging.

## Progress
Not started.
