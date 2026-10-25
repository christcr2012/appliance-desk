# Screen spec — Customer portal redesign (PORTAL-1)

Card: `docs/pr-cards/PORTAL-1.md`. Approved by Chris 2026-10-25 ("Yes, redesign it too"; DECISIONS.md 2026-10-25:
"the customer portal gets the redesign too (new unit after the desk)"). Read first: `../README.md`, `../KIT.md`,
`CUSTOMER-RECORD.md` (record-page pattern), `docs/designs/APP-REDESIGN.md` sections 4B (phone first), 4D.4 (no
paragraphs), 4D.6 (plain words), 4D.7 (Spanish), and `docs/AI-PR-READ-FIRST.md` (customer isolation, payments).

**Scope:** every page under `src/app/account/` — Home, Rentals, Repairs (today "Maintenance"), Bills (today
"Billing" + the bill page), Properties, Account (today "Settings" + Privacy). Same URLs, same server actions, same
domain reads. The signing page (`/sign/[id]`), quote page (`/estimate/[id]`), tenant repair link and public website are
**not** in scope (they keep their current look; listed in section 9 as later work).

**What does not change:** which customer's data a page reads (every read stays keyed on the signed-in user id —
section 2), money math, Stripe paths ("Pay now" route, billing portal button), the legal English terms readback,
consent records, the 30-minute idle sign-out, the existing language system.

## 1. Fixes found while specifying (do these in this unit)
1. **Money added up in page code.** `src/app/account/page.tsx` (~line 124) and `rentals/page.tsx` (~line 126) sum
   `line.monthlyPriceCents` in the page. AGENTS section 4 forbids money math in UI. Add
   `rentalMonthlyTotalCents(lines: { monthlyPriceCents: number }[]): number` to a new pure module
   `src/domains/agreements/totals.ts` (unit-tested: empty → 0, several lines, rejects non-integers by throwing) and
   return `monthlyTotalCents` from `getPortalHome` (each rental) and `getPortalData` (each agreement). Pages only
   format it. Same for the home "remaining" amount (`amountDueCents − amountPaidCents`, ~line 205): return
   `balanceCents` from `getPortalHome`.
2. **Two `<main>` landmarks.** `src/app/account/properties/page.tsx` renders its own `<main>` inside the shell's
   `<main>` (`account-shell.tsx` ~line 157). Use a `<div>` (axe "landmark-no-duplicate-main" / "landmark-main-is-top-level").
3. **"Report a problem" means two things.** The portal uses "Report a problem" for appliance repairs; the app-feedback
   box (MCP-10a, `engines/FEEDBACK.md`) needs a different name. Rename the repair action to **"Ask for a repair"**
   everywhere in the portal (home header, help card, Repairs page) and keep app feedback as **"App feedback"**.
   Also: FEEDBACK.md section 1 links "Request a repair" to `/account/maintenance/new`, which does not exist — the
   correct link is `/account/maintenance?request=repair` (this spec adds that value, section 5.3). Tell the MCP-10a
   builder; this unit owns the portal side.
4. **Descriptions under every header.** Every portal page has a `PageHeader description=` paragraph (e.g. "Your
   rentals, next visit, billing and help in one place."). Redesigned pages follow guard 9.1: no header description;
   needed help moves into an `InfoTip`.
5. **Accounting words for customers.** "Invoice", "Invoices", "frozen statement", "agreement" appear on everyday
   portal screens. Use the dictionary (section 3).
No customer-A-sees-customer-B path was found: every portal read and action resolves the customer from the session
user (`getPortalHome`, `getPortalData`, `getPayNowUrl`, `lockAgreementForActor`, properties `scopedActor`, the
statement route) and `tests/customer-isolation.test.ts` covers the main reads. Section 8 adds the missing cases.

## 2. Data (read-only; no new tables)
- Keep `getPortalHome(addressId)` and `getPortalData(userId)`; add only the computed fields from 1.1 and, for the
  home "Needs you" card, `signingWaiting: { agreementId, signHref }[]` from the existing
  `src/domains/portal/signing-status.ts` (call it from `getPortalHome`; it is already customer-scoped by user id).
- Every new or changed read: resolves `customer` from `getServerSession()` → `prisma.customer.findUnique({ where:
  { userId } })`, refuses archived customers, and never accepts a customer id from the URL. An `address` param only
  narrows within the customer's own addresses (existing rule in `getPortalHome`).

## 3. Words (portal dictionary; English shown, Spanish added to `PORTAL_TRANSLATIONS`)
| Today | Portal says |
|---|---|
| Billing / Invoices / Invoice #N | Bills / Bill #N |
| View frozen statement | Monthly statement ({formatMonthYear}) |
| Maintenance | Repairs |
| Report a problem (appliance) | Ask for a repair |
| Request pickup | Ask for a pickup |
| agreement (everyday text) | rental (the signed document stays "rental agreement") |
| Settings / Account | Account |
| currently owed | You owe |
Every new English string gets its Spanish entry in `src/domains/language/portal-copy.ts` in the same commit (the
`PortalLabel` type makes a missing key a type error). Changing portal strings changes `spanishCopyDigest()`
(`src/domains/language/review.ts`), so Spanish display switches back to English until the reviewed copy is
re-recorded — that is the existing safety rule (IN-83). The PR lists the changed strings for Chris's translator, and
DEC-1's translator questionnaire gets a "Portal wording, {date}" subject (audience TRANSLATOR) with the list.

## 4. Shell (`src/components/account-shell.tsx`)
- Keep the component and its props; restyle with kit tokens. Tabs (same URLs): Home `/account`, Rentals
  `/account/rentals`, **Repairs** `/account/maintenance`, **Bills** `/account/billing`, Account `/account/settings`.
  Phone: bottom bar (exists) with kit `Icon`s: `washing-machine` (exists) for Rentals, and four new names added to the kit icon set the KIT 4.21 way (paths copied from `lucide-static@0.468.0`): `house`, `wrench`, `receipt`, `user`, 56 px tall,
  safe-area padding, active tab `aria-current="page"`. Desktop (≥1024): top bar with logo (KIT 4.20 badge), the five
  tabs, and on the right the business phone (`tel:`), language switch and "Sign out".
- Mount the kit `Toaster` in the shell (KIT 4.15 says desk layout; the portal gets its own mount).
- **Kit words in Spanish.** Kit components contain a few fixed words ("Load more", "Cancel", "Undo", "Next step",
  "Narrow your filters to see more", "Something went wrong loading this page.", "Try again"). Add
  `src/components/kit/words.tsx`: `KIT_WORDS_EN` (those strings), `KitWordsProvider({ words })` and `useKitWords()`;
  every kit component reads its fixed words from the hook (default English, so the desk needs no change). The portal
  shell passes `portalKitWords(language)` built from `PORTAL_TRANSLATIONS` (add the Spanish for each). Unit test:
  every key in `KIT_WORDS_EN` has a portal translation.
- Footer line under the content on every page (not a tab): "App feedback" link (`/account/feedback/new?from={path}`,
  shown only when the MCP-10a route exists — check with a constant exported by MCP-10a, else omit) and "Call us
  {phone}" when the public phone is set.

## 5. Pages

### 5.1 Home `/account`
Phone layout top to bottom; desktop = two columns (`lg:grid-cols-[minmax(0,1fr)_360px]`, right column = Help + Next
visit).
1. `ScreenHeader` title "Hi {first name}" (name from session; fallback "Your account"), no description, primary
   **Ask for a repair** (`/account/maintenance?request=repair`), overflow: "Ask for a pickup"
   (`/account/maintenance?request=pickup`), "My properties" (`/account/properties`).
2. Property picker (only when > 1 property): kit native `<select>` labelled "Property" with "All properties" + each
   address line; changing it navigates to `?address=` (existing param).
3. `NextStepCard` "Needs you" — first match wins: a bill past due → "Bill #{n} is {k} days late · {formatMoney}"
   action **Pay now** (POST form to the existing `/account/billing/invoice/{id}/pay` route) when
   `isPayNowEligible`, else "Open bill"; a rental waiting for signature → "Your rental is ready to sign" action
   **Sign** (`signHref`); a bill due within 7 days → "Bill #{n} is due {relativeBusinessDay}" action "Open bill";
   otherwise nothing (card not rendered).
4. `StatStrip`: "Monthly rent" `formatMoney(sum of monthlyTotalCents)`; "You owe" `formatMoney(balance)` (tone
   attention when > 0 and past due); "Next visit" `formatShortDate` + time, or "None booked".
5. Rentals list (max 6, existing `take`): cards `{address line1, city}` · appliance names (`describeRentalLine`) ·
   `"{formatMoney(monthlyTotalCents)}/mo"`; out-of-service line as today (`portalStatement(…"repair"…)`); card links to
   `/account/rentals#rental-{id}`. "See all {n}" when more.
6. Open visits (`OpenVisits` component, restyled as a `Timeline`: requested → scheduled → done).
7. Help card: "Need help?" + **Ask for a repair**, "Ask for a pickup", `tel:` "Call us"; InfoTip "A pickup request
   doesn't end your rental or change your bills by itself — we'll confirm with you." (replaces the paragraph).
Empty (no customer record): `EmptyState` "No rental account is linked to this sign-in" + action "Call us" (tel).

### 5.2 Rentals `/account/rentals`
`ScreenHeader` "Rentals", primary "Ask for a pickup". One record-style card per agreement (`id="rental-{id}"`):
- Header: address · pill: "Active" (good) / "Ending {formatShortDate(terminationEffectiveOn)}" (attention) /
  "Month-to-month" or "{termMonths}-month rental" (neutral).
- `StatStrip`: "Monthly total" `formatMoney(monthlyTotalCents)`; "Started" `formatShortDate(startDate)`; "Next visit".
- Items list (existing lines, list price and term-discount line kept, wording unchanged except "agreement" → "rental").
- Section "Ending or renewing" — keep the existing components (`end-rental.tsx`, `end-fixed-term.tsx`,
  `auto-renew-control.tsx`, `turn-off-auto-renew.tsx`) and their server actions untouched; wrap each in a kit `Sheet`
  opened by a button ("End this rental", "Automatic renewal") instead of always-open forms. The early-ending quote
  list stays exactly as today inside the sheet. The Spanish note "The recorded English terms below control this
  rental agreement." stays.
- "Visit history" below all rentals: kit `Timeline` with the existing `getPortalJobsPage` paging ("Newer visits" /
  "Older visits" keep their params).

### 5.3 Repairs `/account/maintenance`
`ScreenHeader` "Repairs"; `StatusTabs` built from the existing data: "Open {n}" (SUBMITTED, REVIEWING, SCHEDULED,
IN_PROGRESS) and "Done" (others) — filter in the existing `getPortalMaintenancePage` query by adding an optional
`status: "open" | "done"` argument (still keyed on the user). Primary **Ask for a repair** opens the existing
`new-request-form.tsx` in a `Sheet`; overflow "Ask for a pickup" opens the existing pickup form in a `Sheet`.
`?request=repair|pickup` opens the matching sheet on load (`repair` is new; `pickup` exists). Request cards: appliance
or "General" · pill from `maintenanceStatusLabel(status, language)` (`src/lib/status-labels.ts`) · `"Sent {formatShortDate(createdAt)}"` · photos count.
Pickup requests: their own small list "Pickup requests" with "Scheduled {date}" / "Waiting for us to schedule it".
Empty: "No repair requests yet" + action "Ask for a repair".

### 5.4 Bills `/account/billing` and bill `/account/billing/invoice/[invoiceId]`
List: `ScreenHeader` "Bills", overflow "Monthly statement ({formatMonthYear(previous month)})" (existing
`/api/documents/statement/{month}` link, new tab) and "Card or bank details" (existing `ManageBillingButton` action).
`StatStrip`: "You owe" (statement total), "Next bill" (`NextBillCard` data: amount + date). `StatusTabs`: "To pay {n}"
(OPEN, PARTIALLY_PAID, DELINQUENT, FAILED) and "Paid" (others) — computed from the existing `getCustomerStatement(…,
{ customerVisible: true })` result (no new query). With several properties, a "Property" `<select>` filters the list
client-side from the loaded statement (no extra data). Bill cards: "Bill #{n}" · property line · `formatMoney(owed)`
or "Paid" · due `relativeBusinessDay` / "{k} days late" (attention) · **Pay now** form when `isPayNowEligible`, else
"Pay as arranged with Robinson Appliance Rentals." as an InfoTip on the card. InfoTip on "You owe": "Bills can include
deposits, fees and tax, so they can differ from your monthly rent."
Bill page: keep `InvoiceDocument` (the printable document, its wording is the legal document and may say "Invoice");
above it a kit `RecordHeader` title "Bill #{n}", pill state, back "Bills", primary **Pay now** (eligible only),
overflow "Print" (existing `PrintDocumentButton`). The `payError=1` message becomes a danger toast "The payment page
couldn't open. Try again, or call us." plus the inline message for no-JS.

### 5.5 Properties `/account/properties`
Header "My properties" with back "Home"; keep `LocationsPanel` and every action as is (only shell spacing and the
`<main>` fix). InfoTip replaces the paragraph: "Add the people at each property so we can reach them about visits. They
never see your bills or account."

### 5.6 Account `/account/settings` and `/account/settings/privacy`
Settings becomes three kit setting rows (no new data): "Language / Idioma" (existing `language-preference-form.tsx`),
"Text messages" (existing `sms-preference-form.tsx`; the "off by default" sentence becomes its InfoTip), "Your
information" → link to Privacy. Privacy page keeps its forms and the required retention sentence (legal wording,
allowed in `scripts/kit-guard-allowlist.json` with reason "Privacy law notice required by the privacy policy").

## 6. Loading, errors, theme, size
Each page gets `loading.tsx` (KIT 5.3 skeletons) and the portal `error.tsx` uses kit words via `useKitWords()`. Light
and dark both. Every page works at 360 px wide with no sideways scrolling; tap targets ≥ 44 px.

## 7. Guards
Add every page in section 5 to `docs/build-specs/migrated-pages.json` (KIT guard 9 applies) and add
`src/app/account` to the plain-words scan in `scripts/check-owner-wording.mjs` with the `EVERYDAY_BANNED` list
(AR-12) — the bill document component (`src/components/billing/invoice-document.tsx`) and the privacy page's retention
sentence are listed in the allow-list with reasons (legal document / privacy notice).

## 8. Tests
- `tests/agreement-totals.test.ts` (1.1).
- `tests/customer-isolation.test.ts` (extend; throwaway Postgres, customers A and B): A's `getPortalHome(addressId of
  B)` ignores B's address; `getPortalMaintenancePage` with `status` returns only A's; the statement route for A never
  returns B's artifact; `getPayNowUrl(A, B's bill)` throws "We couldn't find that bill."; `setAutoRenew` as A on B's
  rental throws the not-found message; a STAFF user opening `/account` sees "No rental account…" and no data.
- `tests/kit-words.test.ts` (every kit word translated; desk default unchanged).
- `tests/portal-home-workspace.test.ts` (extend: `monthlyTotalCents`, `balanceCents`, "Needs you" order).
- `e2e/portal.spec.ts` (new, add to a shard; reuse the customer session from `e2e/global-setup.ts`): home → Needs
  you → Pay now posts to the route (Stripe stubbed as today in e2e); Rentals sheet opens and closes with focus return;
  Repairs `?request=repair` opens the sheet, submit a request with a photo; Bills tabs and property filter; Spanish
  preference (with the test-mode review flag the existing `e2e/customer-language-w26.spec.ts` uses) shows Spanish kit
  words; axe + keyboard at the five sizes, light and dark. Update `e2e/owner-portal-workspaces.spec.ts` selectors that
  change ("Billing" → "Bills", "Maintenance" → "Repairs").

## 9. Not in this unit (later, written as ROADMAP items, not hidden)
Signing page, quote page and tenant repair page on the kit (they are customer-facing legal/sales documents with their
own review); customer two-step sign-in (ACCOUNTS-AND-SIGN-IN section 12, out of scope); in-portal chat.
