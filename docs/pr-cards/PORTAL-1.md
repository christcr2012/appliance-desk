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
Built by Lane 4 on 2026-10-30 (branch ai/vivienne/portal-1), after W-11 parked at IN-61.
All five steps are in: totals moved into src/domains/agreements/totals.ts and the
workspace reads; the kit words provider with the portal's Spanish kit words; the shell,
Home, Rentals, Repairs, Bills + bill page, Properties, Account + Privacy on the kit;
the 8 pages registered in migrated-pages.json with zero new allow-list entries; the
packet's tests (agreement totals, kit words, portal home workspace, the customer
isolation suite extended to the new surfaces, new e2e/portal.spec.ts in browser-e);
and the translator subject "Portal wording, October 30, 2026"
(PORTAL-WORDING-2026-10-30) filed in Decisions & reviews. Isolation testing caught
and fixed one real leak (the raw stripeInvoiceId reached the home page payload).
Verified locally: full typecheck, lint 0 errors, guards 186/186, packet suites and
decisions suites green, plain-words pass. Local browser evidence is degraded by the
environment (production build OOM-killed under multi-lane box load), so CI's browser
shards at the exact head carry the portal spec. Drift from the spec is recorded in
the pull request (kit icon names, server-component kit words as props, the
NextStepCard form-kind limit, and seven smaller items).

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Before the spec’s page conversion, inspect `src/app/account`, its existing isolation tests and dictionary
   consumers. Make a finite table: page → current loader/action → changed English key → Spanish key → test.
   Reuse kit exports and current customer-scoped queries; do not widen desk permissions to share a component.
2. Implement the totals read helper and translated kit-word adapter first. Seed customer A and B with separate
   rentals/bills/properties: every page, action and download must refuse the other customer’s IDs without writes.
3. Convert the common shell, then Home/Rentals/Repairs/Bills/Properties/Account in the card’s specified single
   coherent outcome. Buttons call the existing signing, renewal, ending, repair and Pay now paths.
4. Use the specified priority fixtures for Needs you (late bill before unsigned rental before due-soon bill),
   repair/pickup query links and sheet close/back navigation. Every new displayed key has an English/Spanish
   value; no amounts are added in JSX. Translator review remains separate from development/merge.
5. Extend current isolation/translation tests and run the spec’s portal browser journeys at its five widths,
   light/dark, keyboard and axe. Keep Spanish activation under the existing review rule.
