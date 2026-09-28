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
   log condition photos (taken with the device's camera or picked from
   its library — see `docs/ARCHITECTURE.md`'s "Photo uploads (Vercel
   Blob)" section) and mark it in-progress/completed.
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

Appliance statuses — `AVAILABLE`, `RESERVED`, `RENTED`,
`AWAITING_PICKUP`, `AWAITING_INSPECTION`, `MAINTENANCE`, `RETIRED` —
live in one central enum with clear rules for which transitions are
allowed, enforced server-side (`canTransitionApplianceStatus` in
`src/domains/inventory/lifecycle.ts`) — `RETIRED` is terminal, and
every other move follows a fixed allow-list. Built in Phase 3.

## Rental lifecycle (2026-09-28)

A machine's status now separately tracks **paperwork signed**,
**actually delivered**, **agreement ended**, and **back and checked
over** — these used to be collapsed into fewer steps, which meant "a
customer signed" and "a customer has the machine" looked the same in
the system even though they aren't (see `docs/DECISIONS.md`'s
2026-09-27 review entry for why this changed). The full path:

`AVAILABLE` → (assigned to a draft agreement) `RESERVED` →
(delivery/installation job marked **Completed**) `RENTED` →
(agreement ends) `AWAITING_PICKUP` → (removal job marked
**Completed**) `AWAITING_INSPECTION` → (Chris inspects it) back to
`AVAILABLE`, or to `MAINTENANCE` if it failed inspection.

Concretely:

- **Signing an agreement does not move a machine to `RENTED` anymore.**
  It stays `RESERVED` — reserved for that customer, but still
  physically at Chris's shop — until it's actually delivered.
- **Completing a delivery or installation job** is what moves it to
  `RENTED`. This is also what starts real billing — see Billing rules
  below.
- **Ending an agreement** moves a still-`RENTED` machine to
  `AWAITING_PICKUP` (it's still physically at the customer's home
  until Chris goes and gets it) rather than straight back to
  `AVAILABLE`. A machine that was only ever `RESERVED` (agreement
  ended before delivery) simply returns to `AVAILABLE`.
- **Completing a removal (pickup) job** moves it to
  `AWAITING_INSPECTION` — back at the shop, but not yet checked over.
- **Chris records an inspection** (checklist, `ApplianceInspection`)
  to move it the rest of the way: passed → `AVAILABLE`, failed →
  `MAINTENANCE`. `BusinessSettings.inspectionChecklist` holds the
  reusable checklist items Chris can customize.
- Maintenance visits and swaps are still Chris's own call — the job
  page suggests a next status but never moves an appliance
  automatically for those job types.
- Which appliances a completed job affects: whichever ones are listed
  directly on that job; if none were listed but the job belongs to an
  agreement, that agreement's own currently-assigned appliances — so
  forgetting to tick the box when scheduling a delivery doesn't
  silently skip the whole lifecycle.

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

## Appliance guided actions and history (2026-09-28)

An appliance's own page (`/desk/inventory/[id]`) has, alongside the raw
status-change buttons, four "guided actions" that each replace a
multi-step (or, for a swap, previously outright impossible without a
manual database edit) process with one click:

- **Start a repair** — moves the unit to `MAINTENANCE` and creates a
  maintenance-visit job for it, together, so a status change and its
  job can never end up out of sync (one without the other). If the
  unit is currently on an active rental, the job is automatically
  linked to that customer/address; otherwise it's just logged against
  the appliance itself (e.g. a shop-floor unit).
- **Retire this appliance** — the same terminal move the raw status
  buttons already allow, but now requires a reason, since retiring is
  permanent and an unexplained retirement in the history later is a
  lot less useful than "compressor failed, not economical to repair."
  The reason is saved both on the appliance's own notes and in its
  history.
- **Swap for a working unit** — only offered for a unit currently
  `RENTED`. Unassigns the broken unit from its rental line, assigns a
  same-appliance-type `AVAILABLE` replacement in its place, moves the
  broken one to `MAINTENANCE` and the replacement to `RESERVED` (same
  convention as a brand-new agreement — Chris marks it `RENTED`
  himself once the swap job is actually completed), and creates one
  `SWAP` job carrying both appliances. There was previously no way to
  actually reassign an appliance mid-rental at all.
- **Record inspection** — the guided version of moving a unit out of
  `AWAITING_INSPECTION`. Saves the checklist as answered plus Chris's
  notes and condition assessment as an `ApplianceInspection` record,
  and moves the status the same way a manual inspection always has
  (pass → `AVAILABLE`, fail → `MAINTENANCE` — see Rental lifecycle
  above). Uses Chris's customized checklist from `/desk/settings` if
  he's set one, otherwise the built-in default.

Each guided action is atomic (the status change, any job, and the
audit-log entry all happen together or not at all) and uses the same
race-safe "changed by someone else, refresh and try again" check as
every other status change in the app.

**Appliance history** — every appliance's own page shows one merged,
newest-first timeline of everything that's happened to it: status
changes (from the audit log), every job it's been on, and every
recorded inspection. This is read-only — there's nothing to edit here,
it's just the record.

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

## Customer workspace: notes and contacts (2026-09-28)

A customer's own page (`/desk/customers/[id]`) now has:

- **Notes** — free-text, written by Chris (a call, a reminder). Never
  edited or deleted once saved — an honest record of who said what and
  when, same reasoning as the audit log.
- **Other contacts** — for a business/property-manager account, the
  people Chris actually needs to reach for a given property aren't
  always the one login on the account (a site manager for scheduling
  access, an accounts-payable contact for billing). Purely
  informational — never a login, never billed.
- **Activity timeline** — notes plus the customer's own history (signed
  agreements, job status changes, maintenance requests) merged into one
  chronological feed, so Chris doesn't have to piece it together from
  separate agreement/job pages.
- **Quick actions** — "New agreement" and "Schedule a job," right on
  their page.

## Guided rental builder wizard (2026-09-28)

`/desk/agreements/new` walks Chris through setting up a new rental
step by step, instead of the two disconnected pages it used to be (a
"new agreement" form, then a separate agreement page to add appliances
and send it for signature — easy to leave half-done without noticing).
Four steps, each gated on the previous one being complete:

1. **Customer** — pick an existing customer and one of their service
   addresses, or add a brand-new customer (name, email, phone, one
   service address) right here without leaving the wizard.
2. **Term & fees** — the same term/deposit/damage-waiver/late-fee/tax
   fields the agreement has always had. Submitting this step is what
   actually creates the `DRAFT` agreement row.
3. **Appliances** — add one or more rental lines (label, monthly price,
   which physical unit(s)), same as before; each one shows up in a
   running list as it's added.
4. **Review & send** — the total monthly price, every line, and one
   button to send it for signature (or "finish this later" to leave it
   as a draft and pick it up from the agreement's own page).

This is a guided sequence over the exact same server actions the two
old pages already used (`createDraftAgreementAction`,
`addRentalLineAction`, `sendForSignatureAction`) — not a new creation
path, so nothing about how an agreement is actually built changed, only
how Chris is walked through building it. A new customer created inline
gets the same activation email and account rules as adding one from
`/desk/customers/new` (`createCustomerDirectly`).

## Dispatch board (2026-09-28)

`/desk/dispatch` is the scheduling view of the same jobs `/desk/jobs`
already lists — three ways to look at what's coming up, plus what
hasn't been put on the calendar at all:

- **Day** — everything scheduled for one day, in time order.
- **Week** — a 7-day grid (Sunday–Saturday), each day showing its jobs
  at a glance; click a day to jump into its Day view.
- **Agenda** — a flat, day-grouped list for the next two weeks.

Only active jobs (`SCHEDULED` or `IN_PROGRESS`) appear on the board —
completed and cancelled jobs are done, and don't belong on a
forward-looking schedule.

**Unscheduled queue** — active jobs with no time on the calendar yet
(created but not scheduled) always show at the top of every view, so
nothing Chris created gets forgotten just because he hasn't picked a
time for it.

**Conflict warnings** — Chris is a one-person crew, so two jobs booked
close together means he can't actually make both. Jobs don't record how
long a visit takes, so this uses one assumed duration (2 hours,
`ASSUMED_JOB_DURATION_MINUTES` in `src/domains/jobs/dispatch.ts`,
deliberately generous to include drive time) — any two jobs scheduled
within that window of each other are flagged with a warning badge. This
is advisory only; nothing stops Chris from actually double-booking if
that's genuinely what he means to do (e.g. a quick drop-off right
before a nearby delivery).

**Per-job checklist** — each job's own page has a checklist Chris can
check off in the field (defaults per job type — e.g. a delivery's is
"delivered, installed and leveled, tested a cycle, customer
walkthrough" — see `DEFAULT_JOB_CHECKLISTS`). The dispatch board shows
each scheduled job's progress (e.g. "2/4") so Chris can tell at a
glance which visits still need attention. This is purely a memory aid —
nothing here is required to actually mark a job Completed, and a
completed job with an unchecked item is not an error.

## The exception inbox and "Today" (2026-09-28)

`/desk/today` is where Chris lands after logging in — what's scheduled
today, plus a "Needs your attention" list gathering anything stuck,
across the whole app, into one place (`src/domains/exceptions`). None of
these are new failure states; they're existing ones that used to require
Chris to notice them by opening the right page at the right time. Each
item links straight to the page where it's actually fixed — this is a
list, not its own separate workflow.

What shows up there, and why:

- **Billing blocked** — an agreement's `billingBlockedReason` is set
  (see Billing rules above). Always high severity — it's money not
  being collected.
- **Reservation expired** — a `DRAFT`/`AWAITING_SIGNATURE` agreement
  past its `reservationExpiresAt` hold, still tying up equipment that
  could go to someone else.
- **Past due** — an invoice past its due date, still `OPEN` or
  `DELINQUENT`. High severity.
- **Overdue job** — a `SCHEDULED` job whose `scheduledAt` has already
  passed without being marked in progress or completed.
- **Needs review** — a maintenance request still `SUBMITTED` after 2
  days (`UNREVIEWED_MAINTENANCE_REQUEST_DAYS` in
  `src/domains/exceptions/rules.ts`).
- **Needs inspection** — an appliance sitting `AWAITING_INSPECTION` for
  more than 3 days (`UNINSPECTED_RETURN_DAYS`) — it can't be rented out
  again until Chris checks it over.

Sorted high-severity first, then oldest first within each severity — the
thing that's been sitting the longest and matters the most shows up at
the top. The stats dashboard (`/desk/dashboard`) still exists separately
for a broader numbers view; `/desk/today` is the actionable one.

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

**Billing starts at delivery, not at signing** (confirmed with Chris
2026-09-28 — see `docs/DECISIONS.md`'s dated entry): signing an
agreement no longer starts the recurring monthly charge. What signing
does collect, right then, is a one-time charge for the security
deposit and/or damage waiver (if either applies) and — always — a
saved payment method for later. The real recurring monthly billing
only begins once Chris marks the delivery/installation job
**Completed**, i.e. once the machine has actually reached the
customer.

- If there's nothing to charge at signing (no deposit, no damage
  waiver), the signing checkout just saves a payment method and
  charges nothing.
- Either way, the payment method saved at signing
  (`Customer.stripeDefaultPaymentMethodId`) is what the real monthly
  Subscription is created with once delivery happens.
- If, for any reason, billing can't actually start when delivery
  completes (no saved payment method yet, a declined card, a Stripe
  problem) it's never silently dropped and never blocks the delivery
  itself from being marked complete — the reason is recorded on
  `RentalAgreement.billingBlockedReason` so it surfaces to Chris (the
  exception inbox) instead of the customer just quietly never getting
  billed.
- An ACH (bank transfer) signing charge can take a few days to clear —
  Stripe reports it as pending first, then either
  `checkout.session.async_payment_succeeded` (it cleared — recorded
  the same as an instant card charge) or `checkout.session.async_payment_failed`
  (it didn't — nothing was ever recorded as paid, just a note in the
  audit trail so it isn't invisible). **Chris needs to add these two
  event types to his Stripe dashboard's webhook configuration** — see
  `docs/ARCHITECTURE.md`'s Payments section; card payments work fine
  in the meantime either way, this only affects ACH deposit
  confirmation until he updates it.

## Cross-cutting desk tools (2026-09-28)

Task #44 of the September 2026 build plan. Small tools shared across
several desk pages rather than one feature of their own:

- **Global search** (`/desk/search`, a search box in the desk header on
  every page): looks across customers (name/email/company), appliances
  (asset number/manufacturer/model/serial number), and leads
  (name/email/company) at once, up to 8 matches per category. A plain
  GET form, so it works without JavaScript and a search is just a
  normal shareable URL.
- **Pagination**: the customers, inventory, jobs, and activity lists
  now page at 25 rows instead of loading everything at once. Page
  number lives in the URL (`?page=2`), so a page is bookmarkable and
  works with the browser's back button. Other places that need the
  *complete* list at once for a picker (the rental wizard's customer/
  appliance pickers, the job form) keep using the original unpaginated
  lookups — pagination was only added to the pages Chris scrolls
  through himself.
- **CSV export**: "Export CSV" on the Customers and Inventory pages
  downloads the *full* matching list (not just the current page, and
  respecting an active status filter on Inventory) as a spreadsheet-
  ready file, for anything Chris wants to do outside the app
  (accounting, a mail merge, a one-off analysis).
- **Bulk actions**: the Inventory page's checkboxes let Chris select
  several appliances and set their status at once (e.g. retiring a
  batch together). Each appliance is still checked against the normal
  status-transition rules individually — a selection that mixes valid
  and invalid changes applies to what *can* move and reports back
  exactly what didn't and why, rather than failing the whole batch
  over one appliance that was, say, already retired.

**Deliberately not built in this pass** (scope decisions, not
oversights):
- **CSV import.** Bringing appliance or customer data in from a
  spreadsheet needs real validation (duplicate detection, malformed
  rows, matching existing records) that's its own careful piece of
  work — building it quickly here risked bad data getting into the
  system with no safety net. If Chris needs to bulk-load data before
  this is built, it can be done as a one-off script reviewed by hand.
- **Saved views as a separate feature.** Every list's filters (status
  tabs, search) already live in the page's URL, so any filtered view
  is already bookmarkable and shareable as-is — there was no need for
  a separate "save this view" database feature on top of that.

## Reports: actual vs. estimated earnings, missing-cost warnings (2026-09-28)

Task #45 of the September 2026 build plan. `/desk/reports` reconciles
what Chris's agreements say he *should* be collecting against what has
*actually* been collected, and flags a specific way that reconciliation
can quietly go wrong.

- **Estimated earnings**: for every agreement that has started billing,
  its agreed monthly price (summed across its rental lines) prorated for
  how long it's actually been in its billing period — the same
  days-since-`billingStartedAt` reconstruction already used for the
  Revenue page's MRR trend (`src/domains/billing/revenue.ts`), just
  summed per-agreement instead of bucketed per-month.
- **Actual earnings**: the real amount collected, straight from
  `Invoice.amountPaidCents` — the same Stripe-confirmed number the
  Revenue page's "Collected" figures already come from.
- The Reports page lists any agreement more than $10 behind its own
  estimated figure, worst gap first, alongside the fleet-wide totals.
  This is a reconciliation aid, not a new source of truth — the real
  invoice/payment history on a customer's own page is always the exact
  record; a gap here just means "worth a look," not "something is
  definitely wrong" (an invoice that posted a day late shows up the
  same as a genuinely stuck one until the next billing cycle catches
  up).
- **Repair cost warnings**: a completed `MAINTENANCE_VISIT` job with no
  parts or labor cost entered contributes $0 to that appliance's repair
  cost in the fleet profitability/ROI figures (`src/domains/inventory/
  analytics.ts`'s `computeRepairCostCents`) — which is correct behavior
  for a job that really did cost nothing, but silently wrong for one
  Chris just forgot to log. Both `/desk/reports` and the exception inbox
  (`/desk/today`, new `MISSING_REPAIR_COST` category) list these jobs so
  they don't go unnoticed.

## Growth signals (2026-09-28)

Task #46 of the September 2026 build plan — picks up a subset of
`docs/reviews/2026-09-27-business-growth-ideas.md`'s brainstorm (ideas
#3, #4, #6, #7, #8, #11). `/desk/growth` groups five read-only signals,
all pulled from data the app already has:

- **Churn risk** (idea #5): an ACTIVE agreement showing one or more of —
  a past-due invoice, a recent failed payment, its fixed term ending
  within 30 days with no renewal recorded, or 2+ repair requests in the
  last 90 days. Simple, explainable scoring (`src/domains/growth/
  churn.ts`), same "no AI/ML, every point has a plain-English reason"
  approach as lead scoring.
- **Lead win-back** (idea #7): a `NEW`/`CONTACTED` lead that's gone
  quiet for 14+ days, or a `LOST` lead old enough (60+ days) that
  circumstances might genuinely have changed — re-approaching a fresh
  "no" a week later would just be annoying.
- **Price review reminders** (idea #8): an ACTIVE agreement whose price
  was agreed a year or more ago. Since agreement pricing is frozen at
  signing and never edited in place, "hasn't been revisited" is simply
  "started a year+ ago" — never an automatic change, only a reminder.
- **Fleet flags** (ideas #3/#4): an appliance type (with at least 3
  units, so one washer isn't a statistic) running near-fully-rented is a
  probable lost-rentals-to-no-availability signal; one sitting mostly
  idle may be overpriced or overstocked. Reuses the same
  `computeUtilizationFraction` the Fleet page already shows.
- **Review/referral candidates** (idea #6): a customer billing cleanly
  for 90+ days with nothing currently past due — a reasonable moment to
  ask. **Deliberately a list, not an automatic sender**: the brainstorm
  described an automatic email at a set milestone, but sending
  unsolicited customer-facing email on a timer is exactly the kind of
  thing `AGENTS.md` asks Chris to be looped in on — this surfaces who to
  reach out to and leaves the actual asking to him.

**Local-search landing pages** (idea #11): `/rent/[city]` — one real
page per city Chris has actually listed in Settings' service area
(`BusinessSettings.serviceAreaCities`), reusing the same real
pricing/appliance content as `/pricing`. Never a fabricated city, and no
invented claims (review counts, "hundreds of happy customers," etc.) —
only what's actually true from real settings data. Linked from
`/service-area` and included in `sitemap.ts`.

**Formal referral program** (idea #10) — **done (2026-09-28, Task #68)**.
Give-one/get-one: every customer gets a shareable `Customer.referralCode`
automatically; a new lead who enters someone's code on the public form
gets linked to them (`Referral`, PENDING) the moment that lead converts
to a customer; the reward — one owner-adjustable dollar amount
(`BusinessSettings.referralRewardCents`, $25 default), same for both
sides — fires only once the *referred* customer's billing actually
starts (`RentalAgreement.billingStartedAt`), never on signup alone.
Applied as a real Stripe account-balance credit (automatically reduces
that customer's next invoice) on whichever side already has a Stripe
customer on file, plus a `CustomerCredit` record on both sides either
way — visible on each customer's own page — so Chris can honor it by
hand for a side that doesn't have a Stripe account yet. See
`src/domains/referrals`.

**SMS notifications** (idea #12) — **built (2026-09-28, Task #71),
dormant until Chris has a phone number to send from.** Chris approved
the ongoing per-text cost and set up a real Twilio account, but
couldn't buy a phone number yet — Twilio requires his LLC's business-
texting (A2P 10DLC) registration first, which isn't done. Everything
is wired up and ready: a real, off-by-default opt-in on
`/account/settings` (`Customer.smsOptInAt`, a `ConsentRecord` on every
change — TCPA compliance, see "Privacy & accessibility baseline"
below), and a same-day "your visit is today" text for scheduled jobs
(`src/domains/jobs/day-of-reminders.ts`, a second daily Vercel Cron
job). Sending itself no-ops safely until `TWILIO_PHONE_NUMBER` is set
in Vercel — see `docs/DECISIONS.md`.

**An accounting export** (idea #14) — **done (2026-09-28, Task #73)**.
`/desk/reports` has an "Export transactions (CSV)" download
(`/desk/reports/export`) — every succeeded payment, invoice refund, and
security deposit collected/refunded, oldest first, as a generic CSV
(date, type, customer, invoice #, a signed dollar amount, method/
reason, notes) any bookkeeping tool can import. Deliberately not
QuickBooks-specific, since Chris doesn't have accounting software yet.
See `src/domains/reports/accounting-export.ts`.

**Not picked up in this pass** (the brainstorm's bigger, separate-schema
ideas — still just a menu, per that doc's own "nothing gets built
without Chris picking it"): a separate Contacts concept (idea #13). The
driver/technician mobile job view (ideas #1/#2) is also **done
(2026-09-28, Task #65)** — see the automation-rules entry in
`docs/DECISIONS.md`.

## Privacy & accessibility baseline

U.S. (CCPA/CPRA-style) privacy, not GDPR — this is a U.S.-only business.
Full detail in `docs/DESIGN-SYSTEM.md` (accessibility) and the
Phase 2 privacy/terms pages. Short version: consent is recorded (not
assumed), customers can request export/deletion of their data from the
portal, and an SMS opt-in checkbox (TCPA-compliant) is required before
any texting feature is added — **done, 2026-09-28**:
`/account/settings`'s off-by-default checkbox, see "Growth signals"
above and `docs/DECISIONS.md`.
