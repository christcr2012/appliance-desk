# Screen spec — Rentals: the list, the rental record, and "End this rental"

Built in **AR-4a**. Design: `APP-REDESIGN.md` sections 4.2 (record page, guided flow), 4.3 (hand-offs), 7 (agreement
sub-pages become one "End this rental" flow). Kit: KIT.md. Everyday word: **rental** ("rental agreement" only for the
signed document). **No rental rule changes:** every button calls the server action that exists today.

Roles: STAFF keeps `OperationalAgreement` on the record and the staff branch of `getDeskAgreementsPage` on the list
(no money). Everything else below is OWNER/ADMIN.

## 1. Fixes found while specifying (do them in this card)

- **"Mark ended" ends a rental with one tap and no confirmation** (`agreement-detail-panel.tsx`, `handleEnd`). Ending
  stops the Stripe subscription, frees the appliances and creates a pickup visit, and cannot be undone. It moves into
  "End this rental" (section 5) behind a confirmation.
- **The rental's visit list shows stored codes** (`{j.type} — {j.status}`, e.g. "DELIVERY — SCHEDULED"). Use
  `jobTypeLabel` and `jobStatusLabel` (`src/lib/status-labels.ts`).
- **`getAgreementsCount` has no role check** (`src/domains/agreements/index.ts`). Add `await requireRole("OWNER",
  "ADMIN", "STAFF")` (the list page allows staff; staff counts reveal nothing beyond what their list shows).
- The record header says "Agreement for …" and "Back to agreements" — use the words below.

## 2. Rentals list — `/desk/agreements` (same URL)

**Params** (`src/app/desk/agreements/params.ts`, zod): `status` = `active` (default) | `signing` (AWAITING_SIGNATURE) |
`starting` (SCHEDULED) | `drafts` (DRAFT) | `ended` (ENDED) | `cancelled` (CANCELLED); `starts` = `this-week` |
`this-month` (startDate in that Denver week/month); `ends` = `this-week` | `this-month` | `ending-soon` (the same rule
as To do `RENTAL_ENDING_SOON`: ACTIVE, fixed term, `terminationRequestedAt` null, `endDate` within
`getRentalEndingNoticeDays()`); `q`; `sort` = `newest` (default) | `ends-soonest` | `rent-desc` | `customer-asc`;
`cursor`. **Old links:** `?status=ACTIVE` etc. (upper case) map to the new values; `?page=` is ignored.

**Data** `src/domains/agreements/rentals-list.ts`: `getRentals(params, now)` and `getRentalCounts(params, now)`
(KIT 5.1 cursor rule). Role-aware exactly like `getDeskAgreementsPage`: STAFF rows have no money fields (the type has
`monthlyCents?: never` for staff — two return types). Select only: id, status, startDate, endDate, termMonths,
reservationExpiresAt, customer (name, company), serviceAddress (line1, city), lines (label, monthlyPriceCents,
packageId, assignments where `unassignedAt: null` → appliance assetNumber + type name). Search `q`: customer
name/email/company contains, address line1/city contains, or an exact appliance `assetNumber` on a current
assignment.

**Layout** (KIT 5.1): `ScreenHeader` "Customers" (area title; the area tabs come from the layout); `StatusTabs`
"Active {n}", "Waiting for signature {n}" (hide 0), "Starting {n}" (hide 0), "Drafts {n}" (hide 0), "Ended",
"Cancelled"; Toolbar search "Name, address or appliance number", filters Starts and Ends (the presets above), sorts
"Newest first", "Ending soonest", "Highest rent", "Customer A–Z", built-in views from AR-12 (`rentals`). Cards/rows:
customer name · `"{line1}, {city}"` · lines summary (`describeRentalLine` joined " + ") · right: monthly rent
(owner/admin) and the pill (`AGREEMENT_PILL`, CUSTOMER-RECORD 4.5) · detail: fixed term `"Ends {formatShortDate}"`,
month to month "Month to month", draft/signing with a stale reservation `"Hold ends {formatShortDate}"` (attention).
Desktop columns: Customer · Address · Rental · Monthly rent · Ends · Status · ⋯. Row ⋯: "Open", "View customer",
"Schedule a visit" (`/desk/jobs/new?agreementId=`), "End this rental…" (ACTIVE only; opens section 5 on the record).
Fab / header button "New rental" → `/desk/agreements/new`. Empty: "No rentals here" (+ "Clear filters" when filtered).

## 3. Rental record — `/desk/agreements/[id]` (same URL)

Data: everything the page loads today, unchanged (agreement, appliances, packages, signing payment, recovery,
cancellation, end quote, signed artifact, signing preview/charges/tax review, frozen order, business review, delivery
offer, route review inputs). Combine the three separate `businessSettings` and `rentalAgreement` reads used for the
route review into the existing `Promise.all` (one select each) — same values, fewer queries.

**Header** (`RecordHeader`): back "← Rentals" (`/desk/agreements`); eyebrow "Rental"; title customer name (links to
the customer); pill `AGREEMENT_PILL`; subtitle `"{line1}, {city}"`; contact = the customer's phone/email.
**StatStrip:** "Monthly rent" (sum of lines) · "Term" (`"{n} months · ends {formatShortDate(endDate)}"` or "Month to
month") · "Deposit" (`formatMoney(depositCents)` or "None") · "Billing" (the `agreementProgress` billing milestone in
short words: Started → `"Next bill {formatShortDate(nextBillingDate)}"`; Blocked → "Not running" attention;
Prepaid → "Paid in advance"; Not started → "Not started").

**Progress strip** (new kit `Stepper`, read-only variant): four steps from `agreementProgress(a).milestones`:
"Signed" · "Appliances" · "Delivered" · "Billing", each done (check, good) / waiting (neutral) / problem (attention:
billing blocked). Labels only; the long milestone text goes in an InfoTip per step.

**Next step card** — new pure `rentalNextStep(a, extras)` in `src/domains/agreements/next-step.ts`, built on the same
conditions as `agreementProgress().next` (do not change that function; it is used elsewhere). Short words:
| Condition (first match) | Title | Action |
|---|---|---|
| cancellation exists with refund due and not settled | "Refund {formatMoney(refundDueCents)} is waiting" | "Open cancellation" → `/desk/agreements/{id}/cancel` |
| `cancellation.refundState === "PENDING_EXTERNAL_REFUND"` | "A returned refund needs matching" | "Match the refund" → `/desk/agreements/{id}/refund` |
| closed (ENDED/CANCELLED) | — (no card) | — |
| SCHEDULED | "Starts {formatShortDate(startDate)}" (InfoTip with the progress label) | — |
| DRAFT, no lines | "Add appliances" | "Resume rental builder" → `/desk/agreements/new?draftId={id}` |
| DRAFT with lines | "Ready to send for signature" | "Send for signature" (form → existing `sendForSignatureAction`) |
| AWAITING_SIGNATURE | "Waiting for the customer to sign" | "Send a reminder…" (opens the text Sheet, family `signature_reminder`) |
| signed, no appliances, not delivered | "Pick the appliances" | "Pick appliances" → existing progress action href |
| signed, not delivered, visit scheduled | "Delivery is booked" | "Open the visit" → `/desk/jobs/{id}` |
| signed, not delivered, no visit | "Schedule the delivery" | "Schedule delivery" → `/desk/jobs/new?agreementId={id}` |
| billing blocked | "Monthly billing isn't running" | "See why" → `/desk/today?group=money` |
| ACTIVE, fixed term, ending within the notice window and no renewal/ending set | "Ends {formatShortDate(endDate)} — decide what's next" | "Decide…" (opens section 5 at "The term is ending") |
| otherwise | — (no card) | — |
Unit-test every row.

**Primary action** (header, first match): DRAFT → "Resume rental builder"; AWAITING_SIGNATURE → "Send a reminder…";
signed and not delivered → "Schedule delivery" / "Open the visit"; ACTIVE → **"End this rental…"**; otherwise none.
**⋯ menu:** "Send a text…" (Sheet with the existing `SendTextPanel`, same props), "View customer", "View statement"
(`/desk/billing/customer/{customerId}`), "Signed rental agreement" (when `signedArtifactId`; `/api/documents/{id}`,
new tab), "Extend the hold" (DRAFT/AWAITING_SIGNATURE with a stale reservation; existing `extendReservationAction`,
toast "Hold extended"), "Schedule a visit" (ACTIVE; `/desk/jobs/new?agreementId=`).

**Tabs** (`?tab=`; default `details`; desktop shows Activity in the right column per KIT 5.2):
- **Details** — the existing `AgreementDetailPanel` (lines, add/remove line, appliance picks, term/deposit line,
  free-month note) **minus** its action buttons row ("Send for signature", "Mark ended", "Review cancellation" move to
  the header/next step/End flow) and minus its "Jobs" box (moves to Visits). Pass a new prop `hideActions` rather than
  copying the component.
- **Signing** — shown only when status is DRAFT or AWAITING_SIGNATURE, or a signing payment, frozen order or signed
  artifact exists. Contains, in this order and unchanged: signing preview + `SetupFeeOverrideForm` (owner),
  `SigningChargePrepareForm` + readiness + tax review (DRAFT), "could not verify" status line, `ReviewedSigningOrder`,
  `SigningBusinessReviewForm`, `SigningPaymentSummary` + receipt + failed/checkout notes + recovery advice +
  `ManualSigningPaymentForm`. Their own headings stay; remove paragraph text over 140 characters by moving it into an
  InfoTip next to that heading (glossary keys `signing-*`, one per moved paragraph, same words).
- **Visits** — `AgreementDeliveryOfferPanel` + `DeliveryRouteReview` (unchanged props), `PickupVisitPanel`, and the
  visit list (jobTypeLabel · `formatShortDate(scheduledAt)` · jobStatusLabel pill → `/desk/jobs/{id}`), button
  "Schedule a visit" (ACTIVE).
- **Activity** — `ContextCommunicationPanel` supports only Job, MaintenanceRequest and Invoice, and
  `getMessageHistory` only Customer and Lead, so neither is used here (the customer record shows messages). Show a
  `Timeline` from a new read `getRentalTimeline(id)` (`src/domains/agreements/timeline.ts`, OWNER/ADMIN): the newest
  30 audit rows with `entityType: "RentalAgreement"`, `entityId = id`, actor = user name or "automatic". Titles
  (`RENTAL_EVENT_WORDS`, exhaustive for the keys the code writes today; unknown keys → "Rental updated"):
  `agreement.create` "Rental started as a draft" · `agreement.line.add` "Appliance added" · `agreement.line.remove`
  "Appliance removed" · `agreement.item_cancelled` "Item cancelled" · `agreement.signing_charges_prepared` "Signing
  charges prepared" · `agreement.signing_setup_fee_override` "Setup fee changed" · `agreement.send_for_signature`
  "Sent for signature" · `agreement.sign` "Signed by the customer" · `agreement.extend_reservation` "Hold extended" ·
  `agreement.pre_delivery_cancellation_approved` "Cancellation approved" · `agreement.pickup_visit_created` "Pickup
  visit added" · `agreement.ending_pickup_chosen` "Pickup chosen at the end of the term" · `agreement.renewal_drafted`
  "Renewal drafted" · `agreement.renewal_started` "Renewal started" · `agreement.auto_renewal_scheduled` "Automatic
  renewal scheduled" · `agreement.termination_requested` "Customer asked to end" ·
  `agreement.month_to_month_end_requested` "End of month-to-month requested" · `agreement.termination_fee_invoiced`
  "Early-ending fee billed" · `agreement.early_return_resolved` "Early return settled" ·
  `agreement.early_return_fee_voided` "Early-return fee removed". (`agreement.ending_notice_days.update` and
  `agreement.unsigned_follow_up_days.update` are settings rows, not rental rows, so they never appear.) A test greps
  `src/domains` and `src/app` for `action: "agreement.` and fails if a key other than those two settings keys is
  missing from the map.
  `RecordConnections` last.

## 4. Cancellation box
The old boxed "Cancellation review" status text becomes the next-step card rows above. The cancel and refund pages stay
as they are (they are money reviews with their own confirmations).

## 5. "End this rental" — a chooser that hands off to the existing steps

Opened from the header (ACTIVE) or a next step. `Sheet` titled "End this rental". **OptionCards**, only the ones whose
condition holds (computed on the server in `endOptions(agreement, extras)` — pure, unit-tested):

| Option title · one line | Shown when | Goes to |
|---|---|---|
| "The term is ending" · "Renew, switch to month to month, or pick up the appliances." | ACTIVE, `termMonths` set, `endDate` set, `terminationRequestedAt` null | `/desk/agreements/{id}/ending-decision` |
| "The customer wants to stop" · "End a month-to-month rental with the notice your terms require." | ACTIVE, month to month, end quote available (`getMonthToMonthEndQuote` not null) | the existing `MonthToMonthEndForm` shown inside the Sheet's second step (same props) |
| "Everything came back early" · "Decide billing, refunds and fees for an early return." | ACTIVE and `firstDeliveredOn` set and `loadReturnPickup` found a pickup | `/desk/agreements/{id}/early-return` |
| "Cancel before delivery" · "Review the signing money and refund before cancelling." | not delivered (`firstDeliveredOn` null) and status DRAFT/AWAITING_SIGNATURE/SCHEDULED/ACTIVE | `/desk/agreements/{id}/cancel` |
| "End it today" · "Stops monthly billing now and adds a pickup visit if appliances are still there." | ACTIVE | `ConfirmDialog` (danger): title "End {customer}'s rental today?", summary "Monthly billing stops and a pickup visit is added to your To do list if appliances are still at the customer's. This can't be undone.", confirm "End the rental" → existing `endAgreementAction(id)`; error → toast with its message |

The Sheet's header shows a three-dot stepper "Choose · Decide · Done". Linked pages get a small top banner on arrival
via `?from=end` ("Ending {customer}'s rental — step 2 of 3", with "← Back to the rental"); nothing else on those pages
changes.

**Hand-off after it is done** (toast + next-step card, no behavior change): after "End it today" the toast says
"Rental ended. A pickup visit is in your To do list." with action "Open To do" (`/desk/today?group=rentals`); after the
ending decision redirects (existing), the new rental's or visit's page shows the next step as usual.

## 6. Words (exact)
"Rentals", "← Rentals", "Rental", "Active", "Waiting for signature", "Starting", "Drafts", "Ended", "Cancelled",
"Name, address or appliance number", "Newest first", "Ending soonest", "Highest rent", "Customer A–Z", "Month to
month", "Ends {date}", "Hold ends {date}", "New rental", "No rentals here", "Monthly rent", "Term", "Deposit",
"Billing", "Signed", "Appliances", "Delivered", "Details", "Signing", "Visits", "Activity", every next-step title and
option text above, "End this rental…", "Send a reminder…", "Send a text…", "View customer", "View statement",
"Signed rental agreement", "Extend the hold", "Schedule a visit", "Hold extended".

## 7. Tests
- `tests/rentals-params.test.ts`: defaults, upper-case legacy statuses, presets.
- `tests/rentals-list-integration.test.ts`: tabs, `ending-soon` equals the To do rule's rows, search by asset
  number, staff rows carry no money (type + runtime), cursor once-each.
- `tests/rental-next-step.test.ts`: every row of the next-step table.
- `tests/rental-end-options.test.ts`: every option's condition, incl. none for ENDED/CANCELLED.
- `tests/agreements-count-role.test.ts`: unauthenticated call refused.
- `e2e/rentals.spec.ts`: list tabs; record shows the right primary action for a draft, a signed undelivered and an
  active rental; "End it today" requires the confirmation and then shows ENDED; old `?status=ACTIVE` works; staff
  sees the operational view and no money; axe + 5 sizes.
