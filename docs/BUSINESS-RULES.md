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

## How the business operates at launch — Chris approves everything

1. Customer submits an inquiry → becomes a `Lead`.
2. Chris reviews it and contacts the customer.
3. Chris converts the lead into a `Customer` (one click carries the
   lead's info over — built in Phase 3). Converting requires the lead
   to have an email address, since a customer account needs one to
   sign in; a brand-new account gets a one-time random password shown
   once to Chris in the desk UI (there's no self-serve "set your own
   password" flow yet — see `docs/ROADMAP.md`).
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

## Billing rules

- Stripe in **test mode only** until Chris explicitly authorizes going
  live.
- The server always calculates what's owed — a price sent from the
  browser is never trusted.
- Money is stored as integer cents, never floating point.
- ACH/bank payments are offered alongside cards (lower fees) via
  Stripe's hosted Checkout/Customer Portal, so card details never touch
  our own servers.

## Privacy & accessibility baseline

U.S. (CCPA/CPRA-style) privacy, not GDPR — this is a U.S.-only business.
Full detail in `docs/DESIGN-SYSTEM.md` (accessibility) and the
Phase 2 privacy/terms pages. Short version: consent is recorded (not
assumed), customers can request export/deletion of their data from the
portal, and an SMS opt-in checkbox (TCPA-compliant) is required before
any texting feature is added.
