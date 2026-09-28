# Business rules — the one source of truth

If code and this document ever disagree, this document (and Chris) win.
Update this file in the same PR that changes a rule.

## Pricing

- Every price lives in the database (`BusinessSettings`, `ApplianceType`,
  `PricingRule`), never hard-coded in a page or component. All pages,
  quotes, and invoices must go through one pricing service on the
  server.
- Current defaults (all editable by Chris in `/desk/settings`, built in
  Phase 2):
  - Individual appliance: **$35/month**
  - Washer + dryer set: **$60/month**
  - Delivery fee, installation fee, and removal/pickup fee are three
    separate, independently configurable one-time fees (Chris may
    charge for any combination of them), each shown as its own line
    item on `/pricing`. All default to **$0** until Chris sets them.
    `/desk/settings` accepts and displays these (and the flat late fee)
    in real dollars and cents — the database still stores integer
    cents underneath (see "Billing rules" below); the dollar-to-cents
    conversion happens in the settings server action, not in the form.
  - Refundable security deposit and/or non-refundable damage waiver:
    both supported, each can be turned on/off and priced per appliance
    type.
  - Late fee: configurable grace period (days) + flat fee and/or
    percentage.
  - Sales tax: configurable rate, applied at invoice time. **Defaults to
    0% with a visible warning** until Chris confirms the real rate with
    a CPA. Never guess a tax rate.
- **Prepaid-term discount** (Chris's explicit request — see
  `docs/DECISIONS.md` for the dated design decision this section
  summarizes): signing a 6- or 12-month term automatically lowers a rental
  line's monthly rate. A "set" means 2+ appliances on the same rental line
  (e.g. a washer+dryer pair); a single appliance on its own always gets its
  own, separate rate. Four independent, owner-adjustable dollar amounts in
  `/desk/settings` ("6-month prepay discount — per month, for a
  set"/"...for a single appliance", and the same for 12 months) — **never
  derived from one another** (never "single = set ÷ 2" in code), even
  though Chris's own starting figures happen to follow that ratio
  ($5/$2.50 for 6 months, $10/$5 for 12). The discount is tied to the
  agreement's **contractual term**, not to a separate lump-sum payment
  event (Stripe billing doesn't exist yet to detect one).
  - **Separate "first month free" bonus**: only for a 12-month term the
    customer pays in full, in advance, in one lump sum — Chris records
    this himself (`RentalAgreement.paidInFullInAdvance`) at agreement
    creation, since there's no billing system yet to detect a real
    lump-sum payment. Independently owner-toggleable
    (`BusinessSettings.twelveMonthPrepayFreeMonthEnabled`) from the
    recurring discount above.
  - Both the discount and the free-month decision are snapshotted
    immutably: `RentalLine.listPriceCents` /
    `RentalLine.prepayDiscountCentsPerMonth` freeze the moment a line is
    added (a line can only be added/removed while the agreement is
    DRAFT), and `RentalAgreement.freeMonthGranted` freezes at agreement
    creation. Changing any of the four discount amounts, or the free-month
    toggle, in `/desk/settings` later **never** changes what an existing
    signed agreement charges.
  - Visible to both Chris (agreement detail page) and the customer
    (the public `/sign/[id]` review-and-sign page and the `/account`
    portal) as its own line — never folded silently into a lower number.
- **Price history is sacred**: a signed `RentalAgreement` snapshots the
  prices/fees/deposit at signing (see `docs/DATABASE.md`). Changing a
  price later in settings must never change what an existing customer
  owes. Every pricing change is logged (who, when, old → new) via
  `PricingRule`/`AuditLog`, visible in `/desk/activity`.
- New appliance categories (refrigerators, ranges, dishwashers,
  freezers, ...) are added as **data** (`ApplianceType` rows), never as
  a code change — and since Phase 2.1, Chris can add one himself from
  `/desk/settings` ("Add an appliance type") without a developer. A new
  type starts hidden from the public site (`showOnWebsite: false`)
  until he sets a real price and turns it on.
- An appliance type is never hard-deleted (that would orphan any
  Lead/PricingRule/Appliance history that references it) — instead
  it's **retired** (`isActive: false`), which also force-hides it from
  the public site. A retired type can be restored later.
- Each appliance type may have a real photo (`ApplianceType.photoUrl`)
  of a basic/representative model, shown next to the standard "actual
  appliance may vary" disclaimer. Until a real photo is supplied, the
  public site falls back to one generic, appliance-agnostic icon —
  never a guess at which specific appliance it is.

## Lead scoring (simple, explainable — no AI/ML scoring)

Default ranking, **lowest to highest** value:

`month-to-month → 6-month → 12-month → bulk (multiple units) → landlord/property manager/apartment operator needing multiple units`

- Scoring uses configurable rule values (edited in `/desk/settings` in a
  later phase) and stores the specific reasons applied to each lead
  (e.g. `"+ 12-month term"`, `"+ property manager"`, `"+ 4 units"`),
  shown to Chris next to the lead so it's never a black box.
- The lead form captures: individual vs. business, landlord/property-
  manager status, appliances needed + quantity, desired term, service
  address (and whether it's inside the service area), desired start
  date, name, phone (required), email (encouraged), best time to
  contact, how they heard about us, notes, and a required privacy/terms
  consent checkbox.
- Chris is notified immediately by email of every new lead (SMS is a
  possible later addition). High-value leads are flagged as such.
- **Spam/abuse protection:** the form has a honeypot field invisible to
  real visitors (any automated submission that fills it in is silently
  dropped — no Lead saved, no email sent) and a per-IP rate limit (at
  most 5 submissions per 10 minutes) that shows a plain "please wait
  and try again" message if tripped. Neither ever blocks a real
  customer under normal use. See `src/lib/rate-limit.ts` for the
  in-memory limiter's honest limitations and `docs/DECISIONS.md` for
  why a heavier solution (Cloudflare Turnstile, a persistent store)
  isn't built yet.

## Property managers / portfolio accounts

A landlord, property manager, or apartment operator renting appliances
for several properties on one account (the Astra design review's
"property/portfolio rentals" ask, 2026-09-27 — see `docs/DECISIONS.md`
and `docs/ROADMAP.md`). The data model already supported this before
that review — `Customer.isPropertyManager` and `Customer.serviceAddresses`
(a **list** of `ServiceAddress`, not a single one) existed from Phase 3
onward, and `Lead.isPropertyManager` already made "landlord/property
manager/apartment operator needing multiple units" the single
highest-value lead category (see "Lead scoring" above). What was
missing was a way to actually *use* that: a property manager could only
end up with one address on file (whatever the lead form or lead
conversion captured), and Chris had no way to add one directly with
several properties up front.

Built (2026-09-27): `/desk/customers/new` lets Chris add a customer
directly with as many `ServiceAddress` rows as needed at once — a
property manager's whole portfolio in one form, not one address added
at a time afterward. The customer detail page and `/desk/agreements/new`
already let Chris pick which of a customer's addresses a given
`RentalAgreement` is for, so a property manager can have several active
agreements, each at a different property, under one login.

**Still open** (tracked in `docs/ROADMAP.md`, not built yet): a
portfolio rollup view (all of a property manager's properties and
their agreements/charges in one place, both in the desk and in the
customer portal's own "All properties" selector), and adding more
properties to an *existing* customer from their own page (today, more
than the addresses given at creation still need a direct database
edit — not exposed in the UI yet).

Lease term (month-to-month / 6-month / 12-month), billing cadence, and
prepayment are already three separate concepts, not one — see the
prepaid-term discount rules under "Pricing" above. A property
manager's individual agreements use the same term/pricing rules as any
other customer's; there's no separate "portfolio pricing" concept, on
purpose, until Chris asks for one — a bulk/portfolio discount would be
a new, explicit `PricingRule`, not inferred from address count.

## How the business operates at launch — Chris approves everything

1. Customer submits an inquiry → becomes a `Lead`.
2. Chris reviews it and contacts the customer.
3. Chris converts the lead into a `Customer` (one click carries the
   lead's info over — built in Phase 3). Converting requires the lead
   to have an email address, since a customer account needs one to
   sign in; a brand-new account is emailed a "set your password" link
   automatically (Phase 6A) — Chris never sees or relays a password
   himself. If that email doesn't arrive or its link expires, "Resend
   activation email" on the customer's own page in the desk sends it
   again.
   - **Or, Chris adds a customer directly** (`/desk/customers/new`,
     added 2026-09-27 in response to a design review flagging that
     there was no way to add one without an inbound lead — see
     `docs/DECISIONS.md`) — for someone he's signing up himself: a
     call-in, a walk-in, or a property manager he's already been
     talking to. Same account-creation rules as lead conversion (one
     shared code path — see `src/domains/customers`'s
     `createCustomerDirectly`), and it can put more than one
     `ServiceAddress` on file at once — see "Property managers /
     portfolio accounts" below.
4. From that customer's page, Chris starts a **draft** `RentalAgreement`
   — picks the service address, terms (deposit, damage waiver, late
   fee, tax rate), and assigns the specific physical `Appliance` unit(s)
   it covers (a washer/dryer set is two units on one line). Adding a
   unit to a draft agreement reserves it (`AVAILABLE` → `RESERVED`) so
   two agreements can never double-book the same physical unit.
5. When the draft is ready, Chris sends it for signature. The customer
   gets a private link (no login needed — the customer portal doesn't
   exist yet, Phase 5) where they review the terms and sign
   electronically: typed full legal name + a checkbox + submit, which
   is logged with a timestamp and the signer's IP address
   (`SignatureRecord`, `provider: "typed_signature"`). **This is
   deliberately not a paid e-signature service** (SignWell, DocuSign,
   etc.) — that's a real future upgrade if Chris wants a fuller
   signing/audit experience, but it's a cost decision for him to make,
   not one to make unasked (see `docs/ROADMAP.md`, `docs/DECISIONS.md`).
6. Signing moves the agreement to `ACTIVE` and its assigned appliances
   from `RESERVED` to `RENTED`.
7. Chris manually schedules the delivery/installation `Job` (and later,
   swaps, removals, or maintenance visits) from the agreement, and can
   log condition photos (pasted URLs for now — no file-upload/blob
   storage decision has been made yet, see `docs/ROADMAP.md`) and mark
   it in-progress/completed.
8. Ending or cancelling an agreement frees its appliances back to
   `AVAILABLE`.

Customers **cannot** reserve inventory, pick installation slots, or
finalize an order themselves at launch — that's an intentional later
feature, not an oversight (see `docs/ROADMAP.md`). The data model
already supports adding it without a redesign.

**Reservation aging:** assigning an appliance to a draft agreement
reserves it immediately, before the customer has signed anything. If
that agreement is still DRAFT or AWAITING_SIGNATURE past the
owner-adjustable hold period (`/desk/settings`, defaults to 7 days),
the desk flags it as a "stale hold" on the agreements list and on the
agreement's own page. From there Chris either cancels it (frees the
appliance back to `AVAILABLE` for another customer) or clicks "Extend
reservation" if it's just a slow-moving deal. Nothing is ever freed or
cancelled automatically — a legitimate in-progress agreement is never
silently touched.

## Inventory & status rules

Appliance statuses — `AVAILABLE`, `RESERVED`, `RENTED`, `MAINTENANCE`,
`RETIRED` — live in one central enum with clear rules for which
transitions are allowed, enforced server-side (`canTransitionApplianceStatus`
in `src/domains/inventory`) — `RETIRED` is terminal, and every other
move follows a fixed allow-list. Built in Phase 3.

A washer/dryer **set** is priced together but is always two separately
tracked physical appliances (see `docs/DATABASE.md`) — swapping one
broken machine must never lose the other machine's own history.

Each physical `Appliance` unit can record: manufacturer, model, serial
number, color, condition, current location, notes, what Chris paid for
it, and a purchase date. **Features** (e.g. front-load/top-load/agitator
for a washer, or whatever's relevant to any other appliance type) are a
free-form list of tags, not a fixed set of checkboxes per category — a
brand-new appliance category, or a feature nobody anticipated, should
never require a code change (same philosophy as `ApplianceType` itself:
new categories are added as data, not code).

**Parts** are logged against a **model number**, not against one
physical unit — once Chris looks up a part number for a given model, it
stays available for every future unit of that same model, not just the
one he was repairing when he found it. See `/desk/parts` (browse
everything logged) and the "Parts for this model" section on an
appliance's own detail page (add a new one). When the same part is
known to also fit other model numbers, Chris can list those at the same
time he logs it — each additional model number gets its own row for
that same part, so it shows up when he looks up parts for any of those
models later too, not just the one he started from.

## Fleet analytics, appliance profitability, and QR codes (2026-09-27)

**Appliance profitability/ROI** (`/desk/inventory/[id]`'s summary panel,
`/desk/fleet`): for each appliance, revenue is estimated from how many
days it's actually been assigned to a customer (`ApplianceAssignment`)
times the rental line's agreed monthly price — split evenly if it shared
a line with another appliance (e.g. a washer+dryer set). Repair cost
comes from parts/labor cost Chris enters on a completed repair job (see
below). Net contribution = revenue − repair cost − what the appliance
cost to buy; "paid for itself" is a plain yes/no, not a projected date,
since projecting a future date from a variable monthly amount would be a
guess dressed up as a fact. **This is an estimate from agreed pricing and
real assignment dates, not a substitute for the exact amounts actually
invoiced** — see `docs/DECISIONS.md` for the full reasoning.

**Repair cost entry**: on a `MAINTENANCE_VISIT` job's own page, Chris can
record what the repair cost in parts and labor. Left blank, it counts as
$0 toward that appliance's lifetime repair cost — never a guessed number.

**Fleet utilization** (`/desk/fleet`): what percentage of an appliance's
time in the fleet it's actually been assigned to a customer, 0–100%.
Sitting `AVAILABLE` or in `MAINTENANCE` counts against it the same as any
other non-assigned time.

**Revenue dashboard** (`/desk/revenue`): Monthly/Annualized Recurring
Revenue (MRR/ARR) is calculated from active agreements' own agreed
pricing — collected revenue, past-due amounts, and failed payments come
directly from what Stripe has actually processed, always the exact real
number, never estimated.

**QR codes on appliances**: every physical appliance gets a printable QR
label (`/desk/inventory/[id]` → "Print QR label") pointing at one URL
that does something different depending on who scans it — staff go
straight to that unit's own inventory page; a customer currently renting
that exact unit goes to a pre-filled service-request form, so they never
need to know its model or serial number; anyone else (not signed in, or
scanning a unit that isn't theirs) sees a safe, generic page and never
any appliance detail.

## Maintenance status flow

`submitted → reviewing → scheduled → in_progress → resolved → closed`

Status rules are centralized (not scattered across pages). Chris is
notified by email of new requests; the customer sees status updates in
the portal. When Chris schedules a job for a request ("Schedule a job
for this"), that `Job` is linked back to the `MaintenanceRequest` it
resolves, and the new-job form pre-fills the customer, address, and
appliance from the request instead of starting blank — but scheduling a
job does **not** automatically change the request's own status; Chris
still moves it through the flow above by hand.

## Customer data isolation (security-critical)

A customer must **never** be able to see another customer's records.
This is enforced on the **server**, on every query and action — hiding
a button in the UI is not security. Every phase that touches customer
data must include a test proving customer A cannot read or change
customer B's data.

This is proven by a real, database-backed test
(`tests/customer-isolation.test.ts`, added Phase 6A item 3) — it
creates two real customers in a real database and checks that the
customer portal (`src/domains/portal`) never returns or accepts the
other one's rentals, service addresses, appliances, or maintenance
requests. Unlike this project's other tests, it does not fake
("mock") the database — a faked database can't actually prove one
customer's data is walled off from another's, since the fake just
returns whatever the test tells it to. It runs as part of the normal
automated checks (CI), which use a real, temporary database for
exactly this reason.

## Billing rules

- Stripe in **test mode only** until Chris explicitly authorizes going
  live.
- The server always calculates what's owed — a price sent from the
  browser is never trusted.
- Money is stored as integer cents, never floating point.
- ACH/bank payments are offered alongside cards (lower fees) via
  Stripe's hosted Checkout/Customer Portal, so card details never touch
  our own servers.

**Billing policy, confirmed with Chris 2026-09-27** (see
`docs/DECISIONS.md`'s dated entry for the full reasoning):

- **Anniversary billing** — each customer is billed monthly on the same
  day of the month they signed their agreement, not a single fixed date
  for everyone. Avoids partial-month proration entirely.
- **Deposits are charged as real money up front**, not just
  authorized/held — a hold expires after about a week and this is a
  multi-month rental, so a hold alone can't cover the whole term.
  Refunded (in full or in part) when the rental ends, per the existing
  `Deposit` record.
- **Both cards and ACH bank-transfer payments are offered** from the
  start, via Stripe's own hosted Checkout/Customer Portal.
- **Billing is in advance** — a customer is charged at the start of the
  month they're about to rent for, not billed afterward for the month
  they already used. Protects the business's cash flow if a customer
  stops paying partway through a term.

## Privacy & accessibility baseline

U.S. (CCPA/CPRA-style) privacy, not GDPR — this is a U.S.-only business.
Full detail in `docs/DESIGN-SYSTEM.md` (accessibility) and the
Phase 2 privacy/terms pages. Short version: consent is recorded (not
assumed), customers can request export/deletion of their data from the
portal, and an SMS opt-in checkbox (TCPA-compliant) is required before
any texting feature is added.
