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
  user: phone, whether they're a business/property manager, etc.
- **ServiceAddress** — a physical address a customer's appliances live
  at. A customer can have more than one (e.g. a landlord with several
  properties).

## Leads

- **Lead** — an inquiry from the public site's request form, before
  Chris has done anything with it. Holds everything the form captures
  plus the computed `score`/`scoreReasons` (see `docs/BUSINESS-RULES.md`
  for the scoring rules) and a `status` (new → contacted → converted /
  lost).
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

## Rentals & pricing

- **RentalAgreement** — one signed (or in-progress) contract with a
  customer at a service address. Its money fields
  (`depositCents`, `lateFeeCents`, `taxRatePermille`, ...) are a
  **snapshot** taken at signing — changing prices later in
  `/desk/settings` never changes what an existing customer owes.
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
- **Deposit** — a security deposit or damage-waiver charge tied to an
  agreement, with its own refund tracking.

## Jobs (delivery / install / swap / maintenance visit / removal)

- **Job** — one scheduled visit: type, status, who/where/when, and
  before/after condition photos. Chris schedules every job by hand —
  there's no dispatch optimization.
- **JobAppliance** — which physical appliance(s) a job involves.

## Maintenance

- **MaintenanceRequest** — a customer-submitted problem report, its
  priority, and its status (submitted → reviewing → scheduled →
  in_progress → resolved → closed).

## Billing

- **Invoice** / **Payment** — what's owed and what's been paid, tied to
  Stripe (test mode until Chris turns on live payments). The server
  always computes what's owed; the browser is never trusted with a
  price.

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

## What's *not* modeled yet, on purpose

Online self-service ordering and customer self-scheduling are
explicitly out of scope for launch (Chris approves every step by hand —
see `docs/BUSINESS-RULES.md`), but the shapes above (separate `Lead`,
`RentalAgreement`, `Job` records with clear statuses) were chosen so
those can be added later without a redesign.
