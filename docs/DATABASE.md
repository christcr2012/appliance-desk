# Database — plain-English guide

The full technical definition lives in `prisma/schema.prisma`. This file
explains *why* each table exists, in order, for whoever picks this up
next (human or AI). Money is always stored as **integer cents** (never a
decimal/float) — see `docs/BUSINESS-RULES.md`. Every timestamp is stored
in UTC and only converted to Mountain Time for display.

## Auth & people

- **User** — anyone who can log in: Chris (`OWNER`), any staff he adds
  later (`ADMIN`), or a customer (`CUSTOMER`). `role` decides what they
  can reach.
- **Session / Account / Verification** — Better Auth's own bookkeeping
  tables (login sessions, the hashed password record, email
  verification/reset tokens). Not hand-queried by app code.
- **Customer** — the business-side profile attached to a `CUSTOMER`
  user: phone, whether they're a business/property manager, a
  referral code (see `Referral` below), and `smsOptInAt` (Task #71 —
  real, recorded SMS consent, never assumed from having a phone number
  on file).
- **ServiceAddress** — a physical address a customer's appliances live
  at. A customer can have more than one (e.g. a landlord with several
  properties).

## Leads

- **Lead** — an inquiry from the public site's request form, or added
  directly by Chris for a phone call/walk-in (`createdByUserId` is set
  when staff added it, null when it came from the public form — see
  `docs/DECISIONS.md`'s 2026-09-29 "Adding a lead by hand..." entry).
  Holds everything the form captures plus the computed
  `score`/`scoreReasons` (see `docs/BUSINESS-RULES.md` for the scoring
  rules) and a `status` (new → contacted → converted / lost).
  `lostReason` (2026-09-29, CRM buildout) is required whenever `status`
  is set to `LOST`, free text.
- **LeadNote** — a per-entry contact-log line for a lead ("called
  Tuesday, no answer") — the same pattern `CustomerNote` gives
  customers, added for leads 2026-09-29 (CRM buildout) since a lead
  previously only had the one flat `Lead.notes` field.
- **LeadApplianceRequest** — which appliance types + quantities a lead
  asked for (a lead can ask for more than one kind of appliance).

## Inventory

- **ApplianceType** — a category Chris rents (Washer, Dryer,
  Refrigerator, ...) and its *current* published price. Adding a new
  category is a data change, never a code change.
- **Appliance** — one physical machine: asset number, serial number,
  condition, current status (available/reserved/rented/maintenance/
  retired), and where it currently is. A washer/dryer "set" is priced
  together but is always **two** separately tracked `Appliance` rows —
  never one fake combined appliance — so swapping a broken dryer never
  loses the washer's own history.
- **`PartRecord.quantityOnHand`/`reorderThreshold`** (2026-09-29,
  purchasing & supplies) — see `docs/BUSINESS-RULES.md`'s "Purchasing &
  supplies" section. Only moved by `receivePurchaseOrder` (up) and
  `recordPartUsage` (down) — never touched automatically elsewhere.
- **Supplier** — a purchasing contact: name, phone, email, notes.
- **PurchaseOrder** / **PurchaseOrderLineItem** (2026-09-29) — an order
  placed with a `Supplier`, DRAFT → ORDERED → RECEIVED/CANCELLED. A
  line optionally ties to a `PartRecord` (`partRecordId`, nullable —
  free text otherwise); receiving the order adds each tied line's
  quantity onto that part's `quantityOnHand`.

## Estimates (2026-09-29)

- **Estimate** — a staff-created, custom-priced proposal for a deal
  that doesn't fit standard self-serve pricing (a property manager
  ordering for several units, a whole building, and similar — see
  `docs/BUSINESS-RULES.md`'s "Property managers / portfolio accounts").
  Belongs to a `Customer` **or** a `Lead` (`customerId`/`leadId` are
  both optional, but a `CHECK` constraint requires at least one — see
  `docs/DECISIONS.md`'s 2026-09-29 "Adding a lead by hand..." entry):
  an estimate started for someone who isn't a customer yet is tied to
  their `Lead` instead, and gets `customerId` filled in once they
  approve it online (both end up set at that point — `leadId` stays as
  a trace-back). Moves through `EstimateStatus` (DRAFT → SENT
  → VIEWED → APPROVED/CHANGES_REQUESTED/DECLINED/EXPIRED → CONVERTED),
  and records who actually approved it (`approverName`/
  `approverEmail`/`approverIpAddress`) the same way `SignatureRecord`
  records who signed.
- **EstimateLineItem** — one free-form priced line on an estimate
  (description, quantity, a monthly amount, a one-time fee, or both),
  optionally tied to one of the customer's `ServiceAddress` rows.
- **`RentalAgreement.sourceEstimateId`** — set when an agreement was
  created by converting an approved estimate
  (`src/domains/estimates`'s `convertEstimateToAgreements`); null for
  every ordinarily-created agreement. Purely a trace-back link — never
  read by pricing or billing logic, and conversion never copies
  `EstimateLineItem` rows into real `RentalLine`s automatically (see
  that function's own comment for why).
- **`Estimate.depositPaidAt`** / **`Estimate.followUpSentForSentAt`**
  (2026-09-29) — see `docs/BUSINESS-RULES.md`'s "Deposit collected at
  approval, and a follow-up if it goes quiet" section. The deposit
  payment itself is recorded as an ordinary `Invoice`/`Payment` pair
  with `Invoice.agreementId` left null (no agreement exists yet at that
  point — `agreementId` has always been nullable for exactly this kind
  of one-off charge).

## Rentals & pricing

- **RentalAgreement** — one signed (or in-progress) contract with a
  customer at a service address. Its money fields
  (`depositCents`, `lateFeeCents`, `taxRatePermille`, ...) are a
  **snapshot** taken at signing — changing prices later in
  `/desk/settings` never changes what an existing customer owes. Can
  optionally trace back to the Estimate that produced it — see above.
  `taxRatePermille` (also on `BusinessSettings`) is stored as tenths
  of a percent — `73` means 7.3% — see `docs/BUSINESS-RULES.md`'s
  "Sales tax" note for why.
- **RentalLine** — one priced line on that agreement (e.g. "Washer/Dryer
  set @ $60/mo").
- **ApplianceAssignment** — which physical `Appliance` fulfills a given
  `RentalLine`, with a start/end so a swap keeps history for both the
  old and new machine.
- **PricingRule** — the audit trail of price changes over time (who,
  when, old value, new value) — separate from `ApplianceType`'s current
  price so Chris can see history in `/desk/activity`.
- **SignatureRecord** — the e-signature provider's record for one
  agreement (who signed, when, link to the signed PDF).
- **Deposit** — a security deposit tied to an agreement; see the
  Billing section below for its refund-tracking fields.

## Jobs (delivery / install / swap / maintenance visit / removal)

- **Job** — one scheduled visit: type, status, who/where/when, and
  before/after condition photos. Chris schedules every job by hand —
  there's no dispatch optimization. `dayOfReminderSentAt` (Task #71)
  dedupes the same-day SMS reminder.
- **JobAppliance** — which physical appliance(s) a job involves.

## Maintenance

- **MaintenanceRequest** — a customer-submitted problem report, its
  priority, and its status (submitted → reviewing → scheduled →
  in_progress → resolved → closed).

## Billing

Redesigned for Phase 6B (docs/DECISIONS.md has the dated writeup) and
now wired up for real: signing an agreement creates a Stripe Checkout
Session, and Stripe's webhooks (`src/domains/billing/webhooks.ts`) are
what actually writes these rows — never our own server, since Stripe
is the one source of truth for whether money moved. See
`docs/ARCHITECTURE.md`'s "Payments (Stripe)" section for the moving
parts.

- **Invoice** — one bill, covering one billing period (billing is
  always *in advance* — see docs/BUSINESS-RULES.md). Has a
  human-facing `invoiceNumber` separate from its internal id, and its
  own subtotal/discount/tax/late-fee breakdown, computed once at
  creation and never recalculated.
- **InvoiceLineItem** — one priced line on an invoice (rent, a fee, the
  deposit, tax, a discount, a later credit or correction), snapshotted
  at creation and never edited afterward — the same immutability rule
  RentalAgreement's own price fields already follow. Fixing a mistake
  or crediting a customer always adds a new line, never changes an old
  one.
- **Payment** — one attempt to collect an invoice (card or ACH), with
  its own status (including `ach_pending`, since a bank transfer takes
  a few business days to clear, unlike a card) and attempt number.
- **Refund** — money refunded from an already-paid invoice (a security
  deposit's own refund stays on `Deposit` below — different kind of
  money, its own existing record). Always has a reason and who
  authorized it; never automatic.
- **CustomerCredit** — an account-level credit (goodwill, resolving an
  overpayment, a referral reward — see `Referral` below) that reduces
  what a customer owes on a *future* invoice.
- **WebhookEvent** — every Stripe webhook event this app has ever
  processed, by Stripe's own event id, so a duplicate delivery (webhook
  delivery is at-least-once) is never acted on twice.
- **Deposit** — a security deposit tied to an agreement, now also
  recording who authorized a refund and why it was less than the full
  amount, when it's less.
- **Referral** (2026-09-28, Task #68) — links a customer
  (`referrerCustomer`) to whoever they referred in
  (`referredCustomer`, `@unique` — a customer can only be the referred
  party once), `PENDING` until the referred customer's billing starts,
  then `REWARDED` with a frozen snapshot of what was actually paid out
  (`rewardCents`). See `docs/DECISIONS.md`'s 2026-09-28 "Referral
  program" entry.

## Settings, content & compliance

- **BusinessSettings** — the one-row table behind `/desk/settings`:
  pricing defaults, fees, tax rate (starts at 0% with a warning until a
  CPA confirms the real rate), business info, service area, and the
  homepage announcement banner. Public pages read this at request time.
- **SiteContent** — editable text blocks for the public site (headline,
  FAQ entries, etc.), keyed by a string like `"home.headline"`.
- **Photo** — an uploaded image (appliance condition, job before/after,
  maintenance report), always with an `altText` field for accessibility.
- **ConsentRecord** — records that a customer agreed to something (lead
  form privacy consent, SMS opt-in, a data export/deletion request) —
  required for the CCPA-style privacy work in `docs/BUSINESS-RULES.md`.
- **AuditLog** — who changed what, when, old value → new value. Powers
  `/desk/activity`.
- **StaffTask** — a staff member's own follow-up reminder (2026-09-29,
  CRM buildout), a note plus an optional due date, optionally linked to
  a `Lead`, `Customer`, or `Job` for convenience (all three foreign keys
  are `onDelete: SetNull` — deleting the linked record never deletes the
  task). Powers `/desk/tasks` and the "Follow-up tasks" panel on a
  lead's/customer's own page. Distinct from the automatically-detected
  exception flags in `src/domains/growth`/`src/domains/exceptions` —
  this is something a person chose to write down, not something the
  system inferred.

## What's *not* modeled yet, on purpose

Online self-service ordering and customer self-scheduling are
explicitly out of scope for launch (Chris approves every step by hand —
see `docs/BUSINESS-RULES.md`), but the shapes above (separate `Lead`,
`RentalAgreement`, `Job` records with clear statuses) were chosen so
those can be added later without a redesign.


## Prelaunch interest (2026-09-29)

- **LaunchSettings** — singleton with prelaunch-mode and email-enable switches,
  the owner-confirmed postal address for marketing footers, and reply inbox.
- **LaunchSubscriber** — opt-in local interest, normalized unique email,
  name/city/appliance interest/source, exact consent text/version/time,
  random 256-bit unsubscribe token, suppression timestamp, and sequence cursor.
  `deliveryBlocked` is an atomic claim before a send and stays true for an
  ambiguous/failed outcome so it cannot be retried blindly.
- **LaunchDelivery** — unique subscriber/step attempt, SENDING/SENT/FAILED
  status and timestamps. Subscriber deletion cascades to its attempts.
  The owner list selects only display fields and never serializes tokens.

Migration `20260930040000_prelaunch_interest` creates only these three tables
and their indexes. It does not rewrite or delete any existing business data.
