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
    a CPA. Never guess a tax rate. Stored in the database as
    `taxRateMilliPercent` — thousandths of one percent, so **7.375% is
    stored as the number 7375** (7.3% is 7300), not `7.375` or `0.07375`.
    `/desk/settings` and the rental builder show and accept a normal
    percent with up to three decimals; conversion happens only through
    `parseTaxRatePercent` / `formatTaxRate` in `src/domains/billing/tax.ts`,
    and `getOrCreateTaxRate` in `src/domains/billing/checkout.ts` sends
    Stripe the exact percentage. The old `taxRatePermille` columns are
    deprecated: code never reads them, and a database trigger keeps them in
    step with the exact column so a deploy or rollback can never leave tax at zero.
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

- Scoring uses rule values that are **currently hard-coded** in
  `src/domains/leads/scoring.ts` (making them editable in
  `/desk/settings` is a later-phase idea, not built yet — see
  `docs/ROADMAP.md`), and stores the specific reasons applied to each
  lead (e.g. `"+ 12-month term"`, `"+ property manager"`, `"+ 4
  units"`), shown to Chris next to the lead so it's never a black box.
  Current point values:
  - Month-to-month term: **+0**. 6-month term: **+10**. 12-month
    term: **+20**.
  - Each additional unit beyond the first (bulk): **+5 per unit**
    (e.g. 4 units = +15).
  - Business account: **+10**.
  - Property manager / landlord / apartment operator needing multiple units
    (`quantity > 1`): **+25**. One unit receives the ordinary term/business
    points, without the multi-unit property-manager premium.
  - A lead is flagged **high-value** once its total score reaches
    **30**.
- The lead form captures: individual vs. business, landlord/property-
  manager status, appliances needed + quantity, desired term, service
  address (and whether it's inside the service area), desired start
  date, name, phone (required), email (encouraged), best time to
  contact, how they heard about us, notes, and a required privacy/terms
  consent checkbox. When no appliance types are published, visitors can still
  submit a general enquiry with no appliance selection; name, phone and consent
  remain required. When options exist, select at least one published type.
- Chris is notified immediately by email of every new lead (SMS is a
  possible later addition). High-value leads are flagged as such.
- **Or, Chris adds a lead directly** (`/desk/leads/new`, "+ Add a
  lead" on `/desk/leads`, 2026-09-29 — see `docs/DECISIONS.md`) for a
  phone call or walk-in that didn't come through the public form.
  Only name and phone are required — no appliance list, quantity, or
  consent checkbox, since Chris is talking to the person directly.
  `Lead.createdByUserId` records that it was added by staff rather
  than the public site; no notification email is sent (the creator
  already knows about it). Scored the same way as any other lead
  (`scoreLead`), and shows up in the same `/desk/leads` pipeline.
- **Spam/abuse protection:** the form has a honeypot field invisible to
  real visitors (any automated submission that fills it in is silently
  dropped — no Lead saved, no email sent) and a per-IP rate limit (at
  most 5 submissions per 10 minutes) that shows a plain "please wait
  and try again" message if tripped. Neither ever blocks a real
  customer under normal use. See `src/lib/rate-limit.ts` for the
  in-memory limiter's honest limitations and `docs/DECISIONS.md` for
  why a heavier solution (Cloudflare Turnstile, a persistent store)
  isn't built yet.

## CRM: contact history, lost reasons, follow-up tasks (2026-09-29)

Built the same day as the lead/estimate gap above, from Chris's own
follow-up request to "really build out the CRM aspect of this system."
Six ideas were put in front of him; three turned out to already exist
(customer contact/communication history via `CustomerNote`, separate
contacts per customer account via `CustomerContact`, and a combined
activity view via `/desk/activity`), so only the genuinely new pieces
were built:

- **Contact history for leads, too.** A lead only ever had one flat
  notes field (what the lead themself said when they submitted the
  form); there was no way to log "called Tuesday, no answer" the way
  customers already could. Every lead's own page now has the same kind
  of running log (`LeadNote`) — timestamped, who logged it, freeform
  text — right next to the lead's other details.
- **A reason when a lead is marked Lost.** Picking "Mark as Lost" now
  asks why first — a short pick-list (too expensive, went with a
  competitor, outside the service area, never heard back, changed their
  mind) plus "Other" for anything else — and won't save without one.
  Shown back on the lead's own page once it's lost.
- **Where leads actually come from.** The public form has always asked
  "how did you hear about us," but nothing ever added the answers up.
  `/desk/reports` now has a breakdown of leads and their conversion rate
  by source.
- **A shared team follow-up list.** `/desk/tasks` — a simple due-date-plus-
  note reminder list, separate from the system's own automatic alerts
  (churn risk, overdue billing, maintenance due, all still on
  `/desk/growth`/`/desk/today`). A task can optionally be tied to a
  lead, customer, or job by adding it right from that record's own
  page — open with STAFF logins too. O09 explicitly preserves team-shared
  visibility; tasks are not private to their creator. Assignment/Mine views
  remain gated on O02 and the O09 data contract.
- **A quick "what did I do today/this week" view.** `/desk/activity`
  now has Today/This week/All time tabs and a small category breakdown
  (leads, estimates, jobs, billing, ...) for whichever range is picked
  — built entirely from the audit log that already existed, no new
  tracking needed.

See `src/domains/tasks`, `src/domains/leads`'s `LeadNote`/`lostReason`
additions, and `docs/DECISIONS.md`'s matching entry for the technical
detail, including which of the six original ideas turned out to already
exist.

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

Built (2026-09-28): the customer detail page in the desk now has a
"Properties" panel (`src/app/desk/customers/[id]/service-addresses-
panel.tsx`) that does two things at once — a desk-side portfolio
rollup (each of a customer's addresses, with the agreements and jobs
at that address and the active $/mo total, grouped per property
instead of Chris having to cross-reference three flat lists), and a
"+ Add property" form that adds another `ServiceAddress` to a
customer who already exists (previously a direct database edit — see
`src/domains/customers`'s `addServiceAddress`).

Built (2026-09-28, Task #72): consolidated statements and manual
payments — see "Billing: consolidated statements, manual payments, and
automated late fees" below for the full writeup. In short: every
property manager customer now has one combined statement
(`/desk/billing/customer/[id]` in the desk, and `/account/billing`
itself once a customer has more than one property) showing every
property's invoices and a running balance, and Chris can record one
payment (a check, cash, a bank transfer) that spreads across several
properties' open invoices at once — the actual scenario a "combined
invoice" request usually means in practice. **Each `RentalAgreement`
still bills independently through its own Stripe subscription** — see
that section for why combining the underlying Stripe charges
themselves was deliberately not attempted.

Lease term (month-to-month / 6-month / 12-month), billing cadence, and
prepayment are already three separate concepts, not one — see the
prepaid-term discount rules under "Pricing" above. A property
manager's individual agreements use the same term/pricing rules as any
other customer's; there's no separate "portfolio pricing" concept, on
purpose, until Chris asks for one — a bulk/portfolio discount would be
a new, explicit `PricingRule`, not inferred from address count.

**Built (2026-09-29): estimates, for the deals that genuinely need
custom terms.** The rule above ("no separate portfolio pricing, on
purpose") still holds for ordinary self-serve pricing — this is the
deliberate exception, for when Chris himself decides a deal needs one.
Chris's own framing: a client ordering appliances for an entire
apartment complex isn't standard free-delivery/standard-fee self-
checkout, nor an ordinary one-off inquiry — it needs a real, custom-
priced proposal, but only for the deals that actually need it. So:

- An Estimate is always staff-created (`/desk/estimates`, OWNER/ADMIN
  only) — never auto-generated from a Lead's `isPropertyManager` flag
  or anything else. That flag, and a lead's requested `quantity`, are
  signals Chris judges by eye when deciding whether a deal needs one;
  they never trigger anything automatically.
- It usually starts from an existing Customer, but doesn't have to
  (2026-09-29 — Chris flagged there was no way to add a lead by hand
  or start an estimate for anyone who wasn't already a full customer,
  see `docs/DECISIONS.md`'s "Adding a lead by hand, and starting an
  estimate for someone new" entry). Picking "Someone new" on
  `/desk/estimates/new` creates a `Lead` first (same lightweight
  entry as the standalone "+ Add a lead" button on `/desk/leads`) and
  starts the estimate against that lead instead — it shows up in the
  ordinary lead pipeline right away, exactly like a website inquiry.
  **The lead becomes a real `Customer` automatically the moment they
  approve the estimate online** — not when Chris sends it, and not
  waiting for a deposit or delivery. See that same doc entry for why
  approval is the point this happens (in short: collecting any money
  or scheduling delivery both require a real customer account to
  already exist, so approval is the earliest honest moment).
- Its line items are free-form: any description, quantity, a
  recurring monthly amount, a one-time fee, or both — Chris sets
  every number by hand, same as he already does for an agreement's
  `RentalLine.listPriceCents`. Nothing here overrides or bypasses
  `BusinessSettings`' standard fees; it's a parallel, explicit
  proposal that standard pricing never applies to.
- A line item can optionally be tied to one of the customer's
  properties (`ServiceAddress`) — useful when the deal already spans
  several named units/buildings, optional when it doesn't (a bulk
  mobilization fee covering the whole deal, say).
- The customer approves or asks for changes online, no login needed
  (`/estimate/[id]`), the same "unguessable link" security model the
  e-signature flow already uses — approving it records a real,
  timestamped name/email/IP, same spirit as a signature.
- **An estimate never reserves real inventory on its own.** Converting
  an approved one only creates DRAFT `RentalAgreement` shell(s) with
  the agreed high-level terms (deposit, which propert(y/ies)) — Chris
  still adds real `RentalLine`s with actual physical appliances the
  normal way, with the same atomic reservation safeguard every other
  agreement already has (`addRentalLine`). This is deliberate: an
  estimate's line items are pricing intent, decided before Chris may
  even know which physical units will fulfill it, not a reservation.
- Converting picks, per deal, either one combined agreement (all the
  estimate's pricing on a single property Chris chooses — e.g. the
  complex's own address on file) or one agreement per distinct
  property the line items reference. Chris chooses which at the
  moment he converts, not locked in when the estimate is created,
  since he said this "depends on the deal."

See `src/domains/estimates` and `docs/DECISIONS.md`'s "Estimates for
property managers / bulk & multi-unit deals" entry for the full
technical writeup.

### Deposit collected at approval, and a follow-up if it goes quiet (2026-09-29)

Two small additions to the estimate flow above, from
`docs/ROADMAP.md`'s "Ideas surfaced researching Jobber" list:

- **If an estimate has a deposit, the customer pays it the moment they
  approve it online** — not left until the resulting agreement is later
  signed. Real money, through the same Stripe Checkout every other
  charge in this app goes through; nothing in this app's own database
  ever marks it paid — only Stripe's webhook does, once it's actually
  confirmed. If the customer cancels out of that checkout, the estimate
  is still APPROVED (approving and paying are separate steps) and their
  same link shows a "Pay deposit" button to pick it back up.
- **If the resulting agreement is later signed for real, its own
  checkout never asks for that deposit again** — the already-collected
  amount just shows up on the agreement as a real `Deposit` record. This
  only applies automatically when the estimate converts into exactly one
  agreement ("single" mode); a "per property" conversion produces
  several agreements from the one collected deposit, which has no
  single honest owner to assign itself to, so Chris is flagged (on the
  estimate's own page) to reconcile that by hand.
- **If a sent estimate sits unanswered for 3 days**, one polite
  follow-up email goes out automatically (a daily cron, same pattern as
  the billing-reminder emails), pointing back to the same no-login link.
  Re-sending a revised estimate resets this — one follow-up per version
  actually sent, not one ever per estimate.

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
   from `RESERVED` to `RENTED`. **Exception: a renewal** (an agreement with
   `renewedFromAgreementId`) becomes `SCHEDULED` ("Signed, starts later"), not
   `ACTIVE`; see "Renewal" below.
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

- When Chris has recorded `paidInFullInAdvance`, delivery never starts a
  recurring rent subscription, with or without the free-month bonus. This flag
  records his full-term payment decision; the guard does not invent a new
  payment receipt or recurring-billing start date. Existing subscriptions are
  not cancelled automatically or backfilled by this repair.
- Damage waiver labels in the builder, owner agreement and customer signing
  page explicitly say one time at signing, matching this later approved rule.
  The earlier monthly-waiver review recommendation is superseded by the
  September 28 lifecycle decision; frozen fee amounts remain unchanged.
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

### Consolidated statements, manual payments, and automated late fees (2026-09-28, Task #72)

Built in response to "formal B2B invoicing for property managers" —
see `docs/DECISIONS.md`'s dated entry for the full reasoning behind
what was and wasn't built.

- **Each `RentalAgreement` still bills independently** through its own
  Stripe Subscription. Combining several agreements' actual Stripe
  charges into one transaction was deliberately not attempted — it
  would mean redesigning how proration, partial payments, and failed
  charges work across a bundle of subscriptions, a change to core
  payment correctness with no real property-manager customer yet to
  validate the design against (`AGENTS.md`'s "don't add abstractions
  in case").
- **What's new is a consolidated view and a way to collect one payment
  across several properties at once** — the part of "one combined
  invoice" a property manager actually needs day to day:
  - `/desk/billing/customer/[id]` — one customer's whole billing
    picture, grouped by property, with a running balance
    (`src/domains/billing/statements.ts`). `/desk/billing`'s new "By
    customer (statements)" view lists every customer with an open
    balance, largest first.
  - `/account/billing` groups a customer's own invoices by property
    the same way, once they have more than one — this is what answers
    the "customer portal's own 'All properties' selector" gap: seeing
    every property's balance in one place turned out to serve a
    property manager better than a dropdown that hides all but one.
  - **Recording a payment** (`/desk/billing/customer/[id]`'s "Record a
    payment" form) is for money that moved outside Stripe — a check,
    cash, or a bank transfer Chris confirmed himself. With no specific
    invoice picked, the amount spreads across that customer's open
    invoices oldest-due-first — the "one check covers three
    properties" case. Any amount left over once everything's paid
    becomes a `CustomerCredit` (the same model referral rewards
    already use), never silently dropped. This never calls the Stripe
    API — it's purely catching our own ledger up to money that already
    changed hands another way (`src/domains/billing/manual-payments.ts`).
  - **Writing off an invoice** — for a dispute Chris isn't going to
    win or a debt he's decided to stop chasing. Sets `Invoice.status`
    to `WRITTEN_OFF` (already in the schema, unused before this) with
    a required reason, which is never treated as "paid." (Batch B: the write-off locks the invoice
    row, so it cannot overwrite a payment that is landing at the same
    moment; see "The payments ledger" below.)
- **Automated late fees** (docs/ROADMAP.md's "Deliberately deferred
  within Phase 6B," built now): a once-daily check
  (`src/app/api/cron/late-fees`) finds any invoice past its
  agreement's own grace period with no fee applied yet, and adds
  whichever of that agreement's flat `lateFeeCents` or `lateFeePercent`
  (of the outstanding balance) is larger — the exact fee already
  disclosed to that customer at signing, never a business-wide default
  that could have changed since. It never attempts a new charge itself
  (Stripe already retries a failed payment on its own schedule) — it
  only adds to what's owed, which then already shows up correctly on
  the existing past-due exception and on the invoice's own statement.
  Chris gets a same-day digest email if any fees were applied; nothing
  is sent on a quiet day. **A given invoice can only ever get one late
  fee** — the check only looks at invoices where `lateFeeCents` is
  still `0`, and that same field becomes the fee amount once applied.
  Batch B also enforces this in the database (a partial unique index allows
  at most one `LATE_FEE` line per invoice) and runs the job under an advisory
  lock, so two overlapping cron runs still produce exactly one fee.
  If a customer pays down part of the balance after a fee lands, the
  invoice never gets a second, larger fee later even if it falls
  behind again.

## The payments ledger (Batch B, 2026-10-03)

- **One payment, one receipt.** Every real payment (a card charge or a payment
  Chris records) is one `Receipt`, however many invoices it pays. Its
  `Payment` rows are the per-invoice allocations. A Stripe charge id is unique
  on receipts, so a replayed webhook cannot record the same cash twice. A
  receipt's `receivedOn` is the day the money moved (shown and totalled in
  Colorado time), not the day the app wrote the row.
- **Overpayment is never lost or spendable twice.** Whatever part of a receipt is
  not applied to an invoice becomes one `CustomerCredit` tied to that receipt
  (`sourceType = RECEIPT_OVERPAYMENT`); the database allows only one such
  credit per source. A refund kept as account credit is another source
  (`REFUND_TO_CREDIT`). Spending a credit creates a `CreditApplication`, a
  negative CREDIT invoice line and a lower remaining balance in one locked
  step, so concurrent spending can never exceed what the credit holds.
  A credit already pushed to Stripe, or reserved for it, cannot also be spent
  locally.
- **Locks.** Every money change locks the customer first, then the invoices it
  touches (in id order). A write-off, a manual payment and a Stripe payment
  event therefore take turns instead of interleaving.
- **Payment on a closed invoice.** If Stripe reports money for an invoice that
  was already written off or voided, the money is recorded as a receipt plus a
  payment row with status `held`. It is **not** applied to the closed invoice,
  the invoice is not reopened, and **no spendable account credit is created**:
  the owner decides what happens to it (IN-23). It shows in the drift workbench
  (`HELD_PAYMENT`), on the revenue page as "held for your decision", and in an
  audit entry `billing.payment_on_closed_invoice`. If Stripe later refunds that
  charge, the refund is recorded against the closed invoice like any other.
  Cash reports still count it as cash received, because it was. The owner
  settles each held payment, one at a time, on Billing → Held payments
  (owner and admin only), choosing: **mark the invoice paid** (reverses the
  write-off; only for a written-off invoice; recommended when the customer did
  owe it; any amount above what was still owed becomes credit), **keep as account
  credit** (invoice stays written off), or **refund to the card** (through
  Stripe, recorded as a refund on the closed invoice; recommended for a voided
  invoice). The screen highlights the recommended choice with its reason. The
  payment then ends as `succeeded`, `held_to_credit` or `held_refunded`; a
  refund made directly in Stripe also settles it.
- **Provider operations.** Every Stripe write Batch B owns (customer or
  subscription create/cancel, balance credit, refund) first records a
  `ProviderOperation` with a fixed idempotency key, then calls Stripe, then
  records the result. Statuses: PENDING, SUCCEEDED, FAILED, UNKNOWN (the call's
  outcome is not known) and DRIFT (local and Stripe disagree and a person must
  look). A crashed process is healed on the next attempt: a claim that has sat
  PENDING for more than two minutes is taken over and the call is repeated with
  the same key, which Stripe answers with the original object. (Stripe keeps
  idempotency keys for about 24 hours, so a very late retry relies on the
  reconciliation job instead.) Retries inside the two minutes are refused with
  a visible "already being started" message.
- **Drift workbench** (`/desk/billing/reconciliation`, owner/admin only) lists
  mismatches between local records and Stripe: stuck or failed provider
  operations, an active agreement with no subscription, a closed agreement
  whose subscription is still live, an invoice whose paid amount does not
  match its status, a payment with no receipt, and customers missing at
  Stripe. It only reads; nothing is repaired automatically. It checks a bounded
  number of records per run.

## Fixed terms, renewal, early termination and tax rounding (Batch B, 2026-10-03)

Mechanism only: no screen exposes any of this yet (Batch D). Every number the
owner has not decided is stored as null, and null means "not available" — it
is never replaced by a default.

- **Billing dates are Colorado calendar dates.** An agreement's billing
  anchor day is kept for its whole life: period N starts on the anchor's
  day-of-month N months later, computed from the anchor each time (a 31st
  anchor bills Feb 28/29, Mar 31, Apr 30 and does not drift). Periods tile
  with no gap or overlap across daylight-saving changes
  (`billingPeriodFor` in `src/lib/business-date.ts`). No proration inside a
  month.
- **Early termination can only take effect on a billing anniversary.**
  Effective date = the first anniversary on or after (request date + notice
  days), counted from the next billing date. If that falls past the end of the
  term, nothing remains to charge.
- **Early-termination fee** = min(cap, max(flat fee, remaining rent × percent)),
  where remaining rent is the monthly total × the whole billing periods from
  the effective date to the end of the term. Percent amounts round half up to
  the cent. Zero whole months remaining means a zero fee.
- **A fixed term starts at delivery** (owner decision IN-20, 2026-10-03). The
  end date is saved the first time billing is started after delivery: the last
  second, Colorado time, of the day before the anniversary that would open the
  next term (a 12-month term starting Nov 8 ends Nov 7 of the next year). The
  same date is sent to Stripe as the automatic stop date, and a retry never
  changes it. Prepaid fixed terms get their end date at delivery too.
- **Termination policy** is entered by the owner in Settings → Ending and
  renewing rentals and lives in `BusinessSettings` (flat fee, percent, cap,
  notice days, unused-term treatment REFUND / CREDIT / RETAIN, terms text);
  nothing is fixed in code. It is "set" only when notice days, the treatment,
  at least one fee value **and the wording customers will see** are present and
  valid; `0` is a deliberate answer, null is not. Each quote carries
  a policy version (a fingerprint of every value and the terms text) so a
  request made against an older quote is refused.
- **Agreements keep their own terms** (owner decision, 2026-10-03). A fixed-term
  agreement is locked, when it is sent for signing, to the ending/renewal terms
  in force at that moment (or the per-customer terms the owner entered for it);
  changing the system-wide terms later never reaches it. Stored in
  `RentalAgreement.termsSnapshot` (override in `termsOverride`). A section that
  was not fully set at that moment is stored as "never agreed", so ending early
  or auto-renew stay unavailable for that agreement even if the owner completes
  the settings later. Agreements sent before this existed have no snapshot, so
  they have no early-ending quote. Month-to-month agreements follow the live
  system-wide terms; the 30-day notice for changing those is not built yet.
- **Requesting early termination records it; it does not end the agreement.**
  Ending still goes through the normal close path on the effective date. The
  owner/admin can do it for any agreement; a customer can do it only for their
  own (another customer's id looks like a missing agreement). The request time
  is the server's clock, never the caller's: the displayed quote is checked
  against a fresh quote and refused if anything changed.
- **A prepaid term needs owner review.** The quote reports the unused prepaid
  rent but does not decide how a free month or prepay discount is settled
  (flagged `prepaidReviewRequired`).
- **Renewal** creates a linked DRAFT copy of the lines and prices. It must start
  the day after the current term ends (that start date is saved on the draft and
  signing early keeps it), is allowed once, never charges a deposit
  again, and does not copy appliance assignments (the appliances stay on the
  current agreement until it ends).
- **A signed renewal is `SCHEDULED` until its start date** (owner decision IN-22,
  2026-10-03). `SCHEDULED` is not in force: it is not an active rental, not
  revenue (MRR/ARR), not billed, and holds no equipment, so inventory and
  reports are never wrong. Transitions: `AWAITING_SIGNATURE → SCHEDULED →
  ACTIVE` or `CANCELLED`. At signing the term end date is saved and the Stripe
  subscription's end date is moved to the renewal's end (removed for
  month-to-month), so billing continues. On the start date (nightly job, or at
  once if signed after it) one transaction ends the old agreement, makes the
  renewal `ACTIVE`, and moves the appliance assignments, the Stripe
  subscription, the next billing date and any deposit to the renewal; the
  renewal's billing start is its own start date. Equipment is not sent for
  pickup. It will not start (and shows in Today) if the old rental was ended or
  cancelled, if Stripe has not confirmed the new end date, or if the renewal's
  lines do not match the old ones one-to-one or already hold equipment. Ending
  or cancelling the old rental is refused while a renewal waits; cancelling the
  renewal puts the old end date back on the subscription.
- **Auto-renew** wording and notice days are entered by the owner in the same
  settings screen; the terms version is generated from them (it changes when the
  wording or notice days change). Consent is recorded only for the renewal-terms
  version the agreement was signed with, by the owner/admin or by the customer on
  their own agreement, with a consent record each time it is turned on or off.
  Turning it off never ends the agreement. **Owner master switch:** nothing below happens automatically unless the owner has turned "Automatic renewals" ON (Settings; OFF by default; owner only). While OFF, opt-out, early endings and cancelling a queued renewal still work. **Acting on consent (nightly):** once
  the agreement's own reminder window opens (term end minus the notice days it was
  signed with), the system queues a month-to-month renewal ("signed, starts later",
  marked as automatic, no signature record) with the same lines and prices; Stripe's
  end date is cleared. Rentals paid in advance are never auto-renewed (no monthly
  billing to carry on; the owner decides). Turning auto-renew off, or asking to end
  early, cancels a queued automatic renewal; a renewal started by hand is never
  cancelled that way, and ending early is refused while one is in progress. An
  automatic renewal never starts if consent was withdrawn, and never starts before
  its renewal reminder (Colorado: 25-40 days before) has been delivered. The reminder is
  written when the renewal is queued, from the wording the customer agreed to, saved as a
  notice, emailed when live customer email is on, or marked delivered by hand by the owner.
- **Agreed early endings (nightly):** requesting an early ending sets Stripe's end
  date to one second before the agreed ending date. On that date the fee (if any) is
  invoiced once as an OPEN invoice with an "Early ending fee" line (no tax added yet,
  IN-25; never charged automatically) and the rental ends with its last day as the end
  date. Rentals paid in advance are not ended automatically; they appear in "Needs your
  attention" (owner and admin only) for the owner to settle the unused months.
- **Sales tax rounding** (owner decision IN-17): rates are exact to 0.001
  percentage point, held in thousandths of a percent (7.375% is 7375). Tax is
  computed per line, rounded half away from zero to the cent, then summed, so an
  invoice's tax can differ by a cent or two from taxing the subtotal once. The
  old tenths-of-a-percent rates were copied across exactly by migration
  `20261003180000_tax_rate_milli_percent` (73 became 7300). Helpers are in
  `src/domains/billing/tax.ts`; storage, the settings screen, the rental
  builder, the public pricing page, agreement snapshots and Stripe tax-rate
  creation all use thousandths of a percent.
- **Reports and statements read the ledger** (Batch B, WU-B11). "Collected"
  means money actually received (`Receipt`, by the Colorado day it was
  received, including any overpayment) minus cash refunds (`collectedBetween`
  in `src/domains/billing/collected.ts`). A refund the owner kept as account
  credit (`CustomerCredit.sourceType = REFUND_TO_CREDIT`) returns no cash, so it
  is reported separately and not subtracted from collected cash. "This month"
  everywhere in revenue reporting is the Colorado calendar month
  (`revenuePeriod`); the six-month rate trend still uses UTC months. Invoice
  lines map to owner-facing groups in `src/domains/billing/categories.ts`.
  The earnings report's "collected" for an agreement is money received and credit
  applied to its invoices minus refunds recorded on them, on every row and total.
  A customer statement shows: carried forward + billed (excluding DRAFT and
  VOID) − payments applied − account credit applied − written off = balance
  owed, and warns when the records do not add up. Only OPEN, PARTIALLY_PAID,
  DELINQUENT and FAILED invoices count as owed; written-off, voided and draft
  invoices never do. The accounting CSV gives every row its record ID and source
  and uses the Colorado date.

## Pickups and deliveries: late return, late delivery, pickup day (2026-10-03)

Chris's rules (IN-24 / IN-26 / IN-27), each an owner-changeable setting on
Desk → Settings → **Pickups and deliveries** with its recommended value
pre-selected and explained on the screen. Nothing here is hard-coded; the
technical layout is in `docs/ARCHITECTURE.md` ("Pickup and delivery billing").
Every rule counts from the date staff record the work as done (or the job's
scheduled date), never from the moment a status button is pressed.

1. **Late return.** A customer who keeps an item past the end date of their
   agreement is charged a daily rate for each day past the end date, per
   item — whether or not the agreement has been marked ended yet. Setting:
   the daily rate is the item's monthly price ÷ 30 (**default**) or a fixed
   owner-set dollar amount per day. The late days appear on the next bill as
   their own line, labeled `Late return – [item] – [N] days` (one line per
   item), with the agreement's sales tax. The bill is an ordinary open
   invoice: it is never charged to a card automatically, so the owner can
   adjust or write it off (for example a late pickup that was the company's
   fault — the automatic waiver for that is still to be built, IN-24).
2. **Late delivery (an item missing from the first delivery).** When one or
   more items on an agreement are not delivered as agreed on the original
   delivery, the **whole agreement** is billed as normal from that original
   delivery date. Staff tick the missing items when completing the delivery
   job; they stay on the customer's attention list until a later delivery job
   brings them. Then, on the **next** bill, the customer gets a credit for
   each late item, prorated by the day, for each day between the original
   delivery date and the day before it was actually delivered. Setting: the
   per-day amount is the item's monthly price ÷ 30 (**default**) or ÷ the
   actual number of days in that billing month. The credit is its own line,
   `Credit – [item] delivered late – [N] days`, rounded once on the total and
   never more than was billed for that item. An item that is never delivered
   and is taken off the agreement is credited the full amount billed for it
   (`Credit – [item] never delivered – [N] months billed`). A washer+dryer
   set's price is split evenly per machine. Rentals paid in full in advance
   get no automatic credit (owner decides, as with early endings).
   **What happens to the monthly subscription (Chris, 2026-10-03):** an
   item delivered late, or swapped for an alternate unit of the same type
   delivered later, stays on the subscription — the credit is the whole
   remedy. An item permanently cancelled (never delivered, taken off the
   agreement) comes off the Stripe subscription from the next billing period,
   on top of the credit. *The subscription removal is not built yet — Batch C
   (`docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`); until then the audit
   entry tells the owner to adjust the subscription in Stripe by hand.*
3. **The pickup day is not billed.** The final chargeable day of any rental
   is the day **before** the pickup/return date — for normal end-of-agreement
   pickups and late returns alike. An item picked up on the 1st of the month
   is not charged for the 1st. Setting: on/off, **default on**.

Days are Colorado calendar days. Daily amounts are rounded once on the
total, not per day. There is no "early return" rule: an item returned before
the end date while the agreement continues is not credited (that reading was
a misunderstanding, removed the same day — `docs/DECISIONS.md`).

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
(2026-09-28, Task #65)**. The current route is shared and unassigned,
explicitly showing the team's scheduled visits; individual assignment remains
gated by O02/O13. Swap completion opens the job detail for incoming-unit follow-up,
with owner confirmation required when legacy replacement intent is missing.
See the automation-rules entry in
`docs/DECISIONS.md`.

## Purchasing & supplies (2026-09-29)

`/desk/suppliers` and `/desk/purchase-orders` — deliberately minimal,
built to match a one-person operation rather than a full procurement
system:

- **A `Supplier` is just contact info** — name, contact person, phone,
  email, notes. No vendor scoring, no contracts.
- **A `PurchaseOrder` moves DRAFT → ORDERED → RECEIVED**, or CANCELLED
  at any point before RECEIVED. "ORDERED" is Chris recording that he
  actually placed the order himself (by phone, email, or the
  supplier's own website) — nothing here talks to a supplier's system.
  Marking one RECEIVED is all-or-nothing per order — there's no
  partial-quantity receiving. If a shipment genuinely comes up short,
  Chris corrects the affected part's on-hand count directly (see below)
  rather than this needing to track "3 of 5 arrived."
- **A line can be tied to a real part on file** (`PartRecord`) or be
  free text (a whole appliance, a bulk supply not in the parts
  catalog). Only lines tied to a real part affect its stock count.
- **Stock tracking lives on `PartRecord` itself** — `quantityOnHand`
  only moves two ways: up, when a purchase order that lines it is
  marked received; down, when Chris logs using some on a real repair
  (the "Used some" quick action on `/desk/parts`). There's no automatic
  per-job consumption tracking — this is only as accurate as Chris
  keeps it, same honesty tradeoff as every other manually-tracked field
  in this app.
- **The "running low" flag** (`getLowStockParts`) only ever appears for
  a part Chris has explicitly given a reorder threshold to (the "Edit
  stock" quick action) — a part with no threshold set (the default,
  for anything he doesn't keep real stock of) is never flagged.

## Privacy & accessibility baseline

U.S. (CCPA/CPRA-style) privacy, not GDPR — this is a U.S.-only business.
Full detail in `docs/DESIGN-SYSTEM.md` (accessibility) and the
Phase 2 privacy/terms pages. Short version: consent is recorded (not
assumed), customers can request export/deletion of their data from the
portal, and an SMS opt-in checkbox (TCPA-compliant) is required before
any texting feature is added — **done, 2026-09-28**:
`/account/settings`'s off-by-default checkbox, see "Growth signals"
above and `docs/DECISIONS.md`.


## Prelaunch interest list and welcome emails (2026-09-29)

Chris authorized a local online-presence/automation build while the business
is still preparing to open. This phase adds an **interest list**, separate
from quote requests, Leads, customer accounts, reservations, and SMS consent.
Only name, email, city, appliance interest, and an unchecked required email
opt-in are collected. The exact consent text/version/time and link-source
label are retained. Email is trimmed/lowercased; repeat signups never create
another subscriber, change their details, or reactivate an unsubscribe.

`/desk/launch` (OWNER/ADMIN only) controls prelaunch mode and email activation.
Prelaunch mode defaults on; email delivery defaults off. Turning prelaunch
off closes signup, restores the ordinary homepage, and pauses this sequence.
Activation requires an owner-confirmed business mailing address and monitored
reply inbox. The production sender and canonical URL must also be configured.
Previews never send launch emails, even if they share production settings.

The finite sequence is: welcome on the next daily run; the family-business
story at least 3 days after acceptance of the first email; and a needs/setup
question at least 4 days after acceptance of the second. Daily runs process
at most 25 emails, so a backlog can delay these intervals. No invented opening
date, inventory promise, guaranteed free delivery, or automatic launch-date
announcement. Maintenance is always included; delivery/installation fees and
requirements depend on the situation. Copy is visible in `/desk/launch`.

Unsubscribe applies immediately to future marketing attempts. A send already
in flight may arrive. Repeated signups cannot undo suppression. The owner can
also stop a subscriber's emails from the desk. Failures/uncertain sends stop
that person's sequence for review instead of blindly retrying. A database
claim plus a unique subscriber/step record prevents overlapping cron runs
from sending duplicates. SENT means accepted by Resend, not inbox delivery.
There is no open tracking, SMS automation, purchased list import, or automated
outreach to people who have not opted in.


## Team follow-ups — October 1, 2026

Tasks remain shared across OWNER/ADMIN/STAFF. Team lists all open tasks; Mine
means assigned to the signed-in person, Unassigned means no assignee, and
Completed permits reopening. Assignment is to an active OWNER/ADMIN/STAFF
account only. Deactivated assignees remain visible as inactive until reassigned.
Priority is explicit Low/Normal/High, Normal for existing tasks; higher priority
sorts first, then the date-only Colorado deadline (undated last) and stable ties.
Edits require the displayed version. Competing changes return conflict and keep
the user's draft. Completion/reopen already in that state has no extra effects;
all effective mutations receive atomic audit entries. Links remain unchanged on
editing/reassignment/completion/reopening. STAFF cannot create or see lead links;
archived customer/job links are omitted. Notes may create a linked follow-up
without sending any message or recording an invented contact promise.
