# Roadmap — deferred & suggested items

Things intentionally **not** built yet, either because they belong to a
later phase (see `docs/HANDOFF.md` for the phase plan) or because they're
a suggestion an AI had while working and is flagging for Chris to decide
on — never built unasked.

## Deferred to a later phase (already scoped, just not yet)

- Lead scoring UI (browsing/filtering leads in the desk, not just the
  score itself — that's done) — **done, Phase 3 (2026-09-26).**
  Lead → customer conversion — **done, Phase 3.** Owner dashboard
  numbers — **done, Phase 3.** `/desk/activity` (browsing the
  `AuditLog`) — **done, Phase 3.** Inventory management (adding/editing
  individual physical `Appliance` units — asset numbers, condition,
  status changes, color, free-form features, and a parts catalog keyed
  by model number) — **done, Phase 3 (2026-09-26)**, per Chris's
  request to be able to start adding inventory as he obtains it, and a
  same-day follow-up request to also capture color/features/parts.
  Needed one schema migration (`Appliance.color`, `Appliance.features`,
  new `PartRecord` table) — **Chris needs to run this migration's SQL
  in Neon before or right alongside deploying**, same as the PR #4
  incident documented in `docs/HANDOFF.md`, since Vercel's build does
  not run `prisma migrate deploy` automatically.
- Rental agreements, e-signature, job scheduling, condition photos —
  Phase 4.
- Customer portal (rentals, billing, maintenance/removal requests) —
  Phase 5.
- Stripe billing (test mode) — **done (2026-09-27), Phase 6B.** Checkout
  right after signing, hosted Billing Portal, and webhook-driven
  Invoice/Payment/Deposit records — see `docs/ARCHITECTURE.md`'s
  "Payments (Stripe)" section. **Still open, tracked here on purpose:**
  Chris needs to register the webhook endpoint in the Stripe dashboard
  once this is deployed (see that same section for the exact steps) —
  the webhook route intentionally refuses to work until then.
- Full accessibility/security review, backup/restore test, launch
  checklist — Phase 7. **Backup restore: done.** Verified 2026-09-28 (see
  `docs/DECISIONS.md`) — a real Neon snapshot restore had already been
  run and finalized against the live database, and its data checked out
  with no loss. **Automated accessibility coverage for every
  logged-in page — started (2026-09-27).** Previously only the public
  site + login/password pages were checked by axe in CI; every
  `/desk/**` and `/account/**` page (owner desk, customer portal) had
  never actually been run through an automated accessibility check.
  `e2e/accessibility-authenticated.spec.ts` now covers all of them, via
  a real login as test-only OWNER/CUSTOMER accounts CI seeds for this
  purpose. **Still not done, and not automatable:** a manual
  screen-reader + keyboard pass before launch — see
  `docs/DESIGN-SYSTEM.md`.

## Deliberately deferred within Phase 6B (not an oversight)

- ~~**Automated late fees / dunning** beyond what Stripe's own automatic
  payment retries already do. `invoice.payment_failed` is recorded
  (shows up as a DELINQUENT invoice at `/desk/billing`), but nothing
  automatically charges a late fee or escalates — that needs its own
  design (how many retries, what fee, when to involve Chris) rather
  than a bolt-on to this PR.~~ — **done (2026-09-28, Task #72)**. A
  daily cron adds the agreement's own disclosed late fee once its grace
  period passes; it never attempts a new charge itself (Stripe already
  retries on its own schedule), and Chris gets a same-day digest. See
  docs/BUSINESS-RULES.md's "Consolidated statements, manual payments,
  and automated late fees."

## Suggestions (not scoped into any phase — Chris should decide)

- **A second, independent design review Chris commissioned (OpenAI's
  "Astra"), 2026-09-27** — a large rebrand + redesign brief saved at
  `docs/reviews/2026-09-28-astra-redesign-brief.md`, discussed in
  `docs/DECISIONS.md`. Covers a full rebrand (new navy/teal color
  system and logo, replacing the original warm palette), an owner-desk
  navigation/dashboard rebuild, a customer-portal rebuild, adding a
  property-manager/portfolio line of business, longer lease terms with
  separate billing cadence, and a settings-page split. Overlaps with
  and partly duplicates ground already covered by the earlier in-house
  design review (mostly done, see the "brand-consistency" PR history
  above) — the new material is mainly the rebrand and the business-
  model additions.
  - **Rebrand: approved (2026-09-27)**, then **superseded (2026-09-29)**
    by a full production brand kit ("Evergreen," v2.0) Chris commissioned
    and delivered as a complete asset package — real logo, color system,
    fonts, favicon/manifest, social-share image, business-form templates,
    and more. Applied to the site's colors, fonts, logo, favicon,
    manifest, and social-share image — see `docs/DECISIONS.md`'s
    2026-09-29 "Brand kit v2.0 (Evergreen)" entry. **Still open**: the
    brief's non-color IA/layout ideas (from the earlier Astra brief,
    separate from this kit) haven't been evaluated.
  - **Property managers / portfolio accounts: done** — Chris
    said yes, build it. Turned out to need much less than a "new
    business line" — the data model already supported multiple
    properties per customer (`Customer.serviceAddresses`) and already
    ranked property managers as the highest-value lead type. First
    slice built (2026-09-27): `/desk/customers/new`, adding a customer
    directly with as many properties as needed at once. Second slice
    built (2026-09-28): the customer detail page's "Properties" panel
    — a per-property rollup of agreements/jobs/$ plus a way to add a
    property to a customer who already exists, both previously
    missing. Third slice built (2026-09-28, Task #72): consolidated
    statements (desk + portal) and manual payments spanning several
    properties — see `docs/BUSINESS-RULES.md`'s "Property managers /
    portfolio accounts" section for exactly what's built. **Still
    open, and deliberately not attempted**: combining several
    agreements' actual Stripe charges into one transaction (each
    property still bills independently) — a real design/risk question,
    not a UI gap, left for if Chris ever needs it.
  - Not started: the 6/12-month-lease framing already exists as the
    prepaid-term discount (see "Pricing" in `docs/BUSINESS-RULES.md`)
    — the brief's owner-desk dashboard/nav rebuild and customer-portal
    rebuild haven't been evaluated against what the in-house review's
    PR #39 already changed yet.
- **Require customers to verify their email before logging in** —
  **done (2026-09-28, Task #70)**. `requireEmailVerification: true` in
  `src/lib/auth.ts`. Because every account here is created server-side
  and activated via an emailed "set your password" link (proof of inbox
  control on its own), each account-creation code path marks
  `emailVerified: true` itself rather than adding a second, separate
  verification email — see `docs/DECISIONS.md`'s 2026-09-28 "Required
  email verification" entry for the full reasoning, including the
  migration that backfills existing accounts so nobody (Chris's own
  OWNER account included) gets locked out.
- **A real business email address on the domain** — **done (2026-09-27)**.
  Originally discussed 2026-09-26 as a deferred decision (options were
  Cloudflare Email Routing, Zoho Mail, or Google Workspace/Microsoft
  365). Chris ended up connecting a Google Workspace account for this
  project and had a real, separate mailbox set up:
  `ops@robinsonappliancerentals.com`, with role aliases `chris@`,
  `leads@`, `support@`, `no-reply@`, and `billing@`. Full detail and
  which address maps to which env var/code path is in
  `docs/ARCHITECTURE.md`'s "Email addresses (Google Workspace)" section.
  - **Wiring the app to use these addresses is done (2026-09-28, Task
    #69)** — `LEAD_NOTIFICATION_EMAIL`, `MAINTENANCE_NOTIFICATION_EMAIL`,
    and `RESEND_FROM_EMAIL` are set as real Vercel environment variables
    pointing at `leads@`, `support@`, and `no-reply@`
    `robinsonappliancerentals.com`. See `docs/DECISIONS.md`'s 2026-09-28
    "Real business email" entry. `publicEmail` (the address shown to
    customers on the public site, edited in `/desk/settings`) was
    deliberately left alone — Chris has it set to his own address today,
    and that's his call to change, not an automatic one.
- **Neon ↔ Vercel preview branching**: gives every PR preview deployment
  its own isolated database branch, so testing never touches real
  customer data. Skipped for now per the brief ("if it isn't simple,
  skip it and note it") since it adds moving parts before there's real
  data to protect; worth turning on once the team is actively merging
  schema-changing PRs.
- **Upgrading the Neon plan** (or freeing a protected-branch slot on
  another project) so this project's `main` branch can be marked
  protected before real customer data goes in — see `docs/DECISIONS.md`.
- **SMS lead notifications**, in addition to email — the brief mentions
  this as optional/later.
- **A friend's "complete rebuild" proposal, 2026-09-27** — saved
  verbatim at `docs/reviews/2026-09-27-friend-full-rebuild-proposal.md`,
  assessed in `docs/DECISIONS.md`. Most of what it describes already
  exists and works today (online rent flow, e-signature, Stripe
  billing, customer portal, appliance inventory, service/repair
  tracking, lead management, property managers) — not recommended as a
  full rebuild. Of its five genuinely-new ideas, Chris picked four and
  they're **done (2026-09-27)**: QR codes on appliances
  (`/desk/inventory/[id]/qr` + `/scan/[assetNumber]`), appliance-level
  profitability/ROI (`/desk/inventory/[id]`'s profitability panel,
  `/desk/fleet`), an MRR/ARR financial dashboard (`/desk/revenue`), and
  fleet-wide utilization analytics (`/desk/fleet`). Its fifth idea,
  formal B2B invoicing for property managers, is **done as a
  consolidated statement + manual-payment system (2026-09-28, Task
  #72)** — see docs/BUSINESS-RULES.md's "Consolidated statements,
  manual payments, and automated late fees" for exactly what that
  means (each property still bills independently through Stripe; what
  changed is the combined view and the ability to record one payment
  across several properties).
- **A second, more architectural review (ChatGPT "Astra"), 2026-09-27**
  — saved verbatim at
  `docs/reviews/2026-09-27-astra-operations-review.md`, assessed in
  `docs/DECISIONS.md`. Mostly validates the existing architecture (real
  relational schema, enforced status transitions, audit logging, an
  already-rigorous billing subsystem) rather than finding it thin. A
  few genuinely new ideas from it are folded into the business-growth
  ideas doc below rather than repeated here.
- **Business-growth ideas, 2026-09-27** — a brainstorm at
  `docs/reviews/2026-09-27-business-growth-ideas.md`, prompted by
  Chris's "help build out the business part, it's so basic" request.
  Covers a driver/technician mobile job view, route grouping,
  inventory-shortage and pricing-opportunity flags built from the new
  fleet analytics, a churn-risk view, review/referral requests, a lead
  win-back nudge, annual price-review reminders, a formal referral
  program, local-search landing pages, SMS notifications, a separate
  Contacts concept, and an accounting export. **Five of these are done
  (2026-09-28, Task #46)**: inventory-shortage/pricing-opportunity
  flags, a churn-risk view, lead win-back, annual price-review
  reminders, and local-search landing pages — see
  `docs/BUSINESS-RULES.md`'s "Growth signals" section for what shipped
  and, just as importantly, what didn't (review/referral requests
  shipped as a manual candidate list, not the brainstorm's automatic
  emailer). **A driver/technician mobile job view is done (2026-09-28,
  Task #65)** — `/desk/driver`, route grouping not included. **A
  formal referral-tracking program is done (2026-09-28, Task #68)** —
  give one/get one, see `docs/DECISIONS.md`. **SMS notifications are
  built (2026-09-28, Task #71) but dormant** — Chris's Twilio account
  is set up, but he can't buy a phone number until his LLC's business-
  texting registration is done; everything else (opt-in, the day-of
  job reminder text) is wired up and ready. **Real business email is
  done (2026-09-28, Task #69)** — see above. **An accounting export is
  done (2026-09-28, Task #73)** — a generic transactions CSV at
  `/desk/reports/export`, see `docs/DECISIONS.md`. **Still open**: a
  separate Contacts concept (idea #13) — not picked up yet, lower
  priority.
- **A third Astra review ("upgrade to a connected workspace"),
  2026-09-27** — saved verbatim at
  `docs/reviews/2026-09-27-astra-workspace-review.md`, fact-checked in
  `docs/DECISIONS.md`. The most ambitious of the three reviews this
  session: a unified customer workspace, a guided rental-builder
  wizard, richer appliance records with guided actions, a real dispatch
  board, an "exception inbox," global search/saved views/bulk
  actions/CSV import-export, an owner configuration center, and a
  "when this happens → do this" automation-rules engine. Several of its
  "quality standard" claims checked out as already true (concurrency-
  safe appliance reservations, tested customer-data isolation, working
  dark mode); two are real, worth-fixing gaps (no optimistic-
  concurrency guard against conflicting simultaneous edits; Neon backup
  restore capability exists but hasn't actually been drilled — the
  concurrency guard is **done (2026-09-28)**, see the optimistic-
  concurrency entry in `docs/DECISIONS.md`). Of the nine proposed
  feature areas, Chris has since picked a first slice of the
  "automation rules" idea — **done (2026-09-28, Task #67)**: billing
  reminders, overdue-rental flags, and maintenance-due flags (see
  `docs/DECISIONS.md`'s 2026-09-28 entry) — plus a first-cut "staff
  permissions" framework (**done (2026-09-28, Task #66)**). The
  remaining feature areas (unified customer workspace, guided
  rental-builder wizard, richer appliance records, a real dispatch
  board, global search/saved views/bulk actions/CSV import-export, an
  owner configuration center) are still not picked.
- **A fourth Astra message — an actual code review, 2026-09-27** —
  saved verbatim at `docs/reviews/2026-09-27-astra-code-review.md`,
  fact-checked in `docs/DECISIONS.md`. This one claimed to have read
  `main` at a specific commit and found three real billing-correctness
  bugs (a successful payment retry could stay marked unpaid forever; a
  pending ACH payment could show as paid before it actually settled;
  ending/cancelling an agreement never stopped its Stripe subscription)
  — all three verified and **fixed** in this same PR, not left as
  roadmap items, since they're correctness bugs in existing intended
  behavior. Two more findings (closing an agreement immediately frees
  its appliances; signing immediately marks appliances rented) turned
  out to already be deliberate, documented decisions — real trade-offs
  worth Chris knowing about, not bugs.
  - ~~No idempotency key on Stripe Checkout Session creation~~ — **done
    (2026-09-27)**, this note was just stale. Both
    `createCheckoutSessionForAgreement` and
    `startRecurringBillingForAgreement` pass a per-agreement
    `idempotencyKey` to Stripe, so a double-click or retried request
    reuses the same Checkout Session / Subscription instead of creating
    a second one. See `src/domains/billing/checkout.ts` and
    `docs/DECISIONS.md`.
- **Google Search Console / Google Business Profile** connection —
  needs a real public business name and domain first (Phase 2/7).
- **A design system / component library beyond Tailwind utilities** if
  the desk UI grows complex enough (e.g. a real data table for
  inventory) — evaluate shadcn/ui components as each screen needs them,
  rather than importing the whole library up front.
- **A real homepage hero photo** (Chris, his vehicle, or an actual
  delivered appliance) to replace the current generic stock-photo
  render — flagged in a 2026-09-27 design review as the single biggest
  mismatch between the site's "real local business" copy and what it
  shows. Chris said he doesn't have one ready yet; send one whenever
  it's available and it's a five-minute swap.
- **A testimonials/reviews section** on the public site — one of the
  highest-converting additions for a local service business, per the
  same design review. Needs real customers first (his upcoming live
  testing, then real launch, will produce some).
- **Icons throughout the owner desk and customer portal** — currently
  no icon set at all (status badges, nav items, buttons are plain text
  or hand-drawn SVGs). Flagged as lower-priority polish in the design
  review; not done in the 2026-09-27 brand-consistency pass since
  picking and applying a coherent icon set across ~50 files is a real
  design decision of its own, not a quick follow-on.
- ~~A social-share image made specifically for link previews~~ — **done
  (2026-09-29)**, part of brand kit v2.0. `public/brand/social-share.png`,
  a purpose-made 1200x630 image from the kit, replaces the homepage hero
  photo in `src/app/layout.tsx`'s Open Graph/Twitter metadata.
- **Real appliance photos** — **done (2026-09-26).** Chris supplied
  basic-model photos for washer/dryer/set; `ApplianceType.photoUrl` is
  settable per appliance type from `/desk/settings`, and any type
  without one still falls back to the generic icon + disclaimer. A
  future improvement could let Chris upload a file directly instead of
  pasting a URL — not needed yet.
- **A paid e-signature provider** (SignWell, DocuSign, HelloSign, etc.)
  instead of the in-house typed-name-and-checkbox signing built in
  Phase 4 — stronger identity verification and a tamper-evident signed
  PDF, at a real recurring cost. `SignatureRecord.provider` already
  anticipates this swap without a schema change. Worth it once
  transaction volume or dispute risk grows past what the lightweight
  version comfortably covers — Chris's call, not automatic.
- ~~Real file uploads for photos instead of pasting a URL~~ — **done,
  2026-09-28** (Chris's explicit request). See docs/ARCHITECTURE.md's
  "Photo uploads (Vercel Blob)" section and docs/DECISIONS.md.
  ~~Still not built: appliance-instance-level photos and
  customer-portal maintenance-request photos~~ — **both done,
  2026-09-28**, same upload component. See docs/DECISIONS.md's
  "Customer-submitted photos on maintenance requests" and "Photos on
  individual appliance units" entries.
- **Link a `Job` back to the `MaintenanceRequest` it fulfills** — **done
  (2026-09-26)**. `/desk/maintenance`'s "Schedule a job for this" now
  opens `/desk/jobs/new?maintenanceRequestId=...`, which pre-fills that
  customer, lets Chris pick from their service addresses, and pre-checks
  the specific appliance the request was about (if one was given). The
  maintenance request's own detail page now lists any job(s) already
  scheduled for it, and the job's own detail page links back to the
  request. **Needed one small schema migration**
  (`prisma/migrations/20260926210000_job_maintenance_request_link`,
  adds the nullable `Job.maintenanceRequestId` column) — same as every
  other migration in this project, Chris needs to run this SQL in
  Neon's console before or alongside deploying/merging.
- **Photo attachments on a maintenance request itself** (the customer
  attaching a photo of the problem when they submit it) — the schema
  already supports it (`Photo.maintenanceRequestId`), just not wired
  into the portal's submission form yet. Left out of this slice to keep
  it shippable; add if Chris finds himself needing photos from
  customers up front.
- **Email notification to Chris on a new maintenance request** — **done
  (2026-09-26)**, mirrors the lead-notification pattern from Phase 2:
  emails `MAINTENANCE_NOTIFICATION_EMAIL` (falling back to
  `/desk/settings`'s public email) with the customer, appliance,
  priority, and problem description whenever a customer submits one; a
  HIGH or URGENT request is flagged as such in the subject line. SMS is
  still a future option, same as it is for leads.
- **More appliance categories**: refrigerators, ranges, dishwashers,
  freezers, etc. Chris is launching with washers/dryers only on
  purpose; adding a category later is a data change in `/desk/settings`
  or a new `ApplianceType` row, never a code change.

## Explicitly out of scope for launch (by design, not an oversight)

- Customers reserving inventory, picking installation slots, or
  finalizing an order themselves — Chris approves every step by hand at
  launch (see `docs/BUSINESS-RULES.md`). The data model supports adding
  this later without a redesign.
- AI-based lead scoring — the brief calls for simple, explainable rules
  only.
- Multi-industry / generalized SaaS features — this is a purpose-built
  appliance-rental system.

## Flagged by the 2026-09-29 full-codebase audit (suggestions, not built)

An AI session went through the whole codebase at Chris's request looking
for bugs, broken links, dead code, and improvement opportunities. The
concrete bugs and quick fixes found were fixed the same session (see
`docs/HANDOFF.md`'s 2026-09-29 audit entry). These are the larger,
lower-urgency items that need a deliberate decision rather than an
obvious fix — flagged here per `AGENTS.md`'s "add it to the roadmap,
don't build it unasked" rule:

- **Pagination for four more list pages.** Leads, Agreements, Invoices
  (`/desk/billing`), and Maintenance requests currently load every row
  at once, unlike Customers and Inventory, which already page. Fine at
  today's size (a few hundred rows); worth doing before any of these
  lists reach the low thousands. The paginated pattern to copy already
  exists in `src/domains/customers/index.ts` (`getCustomersPage`).
- **A handful of missing database indexes** — fields used to filter or
  join (like `Job.customerId`, `Job.agreementId`, `Invoice.agreementId`,
  and several others) don't have an explicit index yet. Not a problem at
  today's data volume; cheap to add as a migration next time the schema
  is touched for something else. `Job.customerId`/`agreementId` and
  `Invoice.agreementId` would matter first, since they're hit on every
  customer/agreement page view.
- **No automated accessibility testing on signed-in pages.** The
  existing `e2e/accessibility.spec.ts` only checks the public website
  and login pages — none of `/desk/**` or `/account/**` (i.e., none of
  the pages Chris and his customers actually use day to day) run through
  an automated accessibility check. Worth extending that same test file
  to cover a representative signed-in page or two.
- **Four HIGH-severity `npm audit` findings**, all inside Prisma's own
  build/CLI tooling (not code the live site runs against customers —
  the app only talks to Postgres at runtime). The suggested automatic
  fix would downgrade Prisma to an older major version, which is a
  bigger change than it sounds — needs a deliberate look next time
  dependencies are updated, not a blind `npm audit fix --force`.
- **No Content-Security-Policy header.** The site already sends several
  other security headers (`docs/ARCHITECTURE.md`); CSP is the one that
  blocks an injected malicious script from running if the site were ever
  compromised some other way. Worth adding, not urgent.
- **No backup beyond Neon's own rolling 6-hour window.** Verified to
  actually work (`docs/DECISIONS.md`, 2026-09-28) but there's no separate
  scheduled export or off-Neon copy on top of it. Worth deciding whether
  that's enough for this business's risk tolerance as it grows.

## Estimates for property managers / bulk & multi-unit deals — being scoped (2026-09-29)

Chris's own framing: a client ordering units for an entire apartment
complex isn't something to run through standard free-delivery/standard-fee
self-checkout, nor is it a normal one-off inquiry — it needs a real,
custom-priced estimate, but this should only apply to the deals that
actually need it, "built into the system smartly," not bolted onto
every lead. Full design proposal — data model, trigger logic, workflow
— is being written up with Chris directly rather than guessed at here,
since it touches `docs/BUSINESS-RULES.md`-level decisions (how a
multi-property/multi-unit deal is priced and which agreements it
becomes). Tracked here so the intent isn't lost if the conversation
that scopes it isn't the one that builds it.

## Ideas surfaced researching Jobber + reviewing the brand kit (2026-09-29, not built)

Chris asked, alongside the estimates request above, for the brand kit
and comparable platforms (Jobber named specifically) to be mined for
other ideas — not to copy, but to see what's worth adapting. What
follows is genuinely new suggestions only; most of what a tool like
Jobber offers (scheduling, a customer portal, recurring billing, late
fees, condition photos, a referral program, branded invoices/emails)
is already built here.

- **The quote/estimate workflow pattern itself** (Draft → Awaiting
  Response → Approved/Changes Requested → Converted, viewed and
  approved online with no login) is the direct model for the estimates
  feature above — see that entry.
- **A deposit collected at the moment a quote/estimate is approved**,
  not left until the agreement is later signed — shortens the gap
  between "customer said yes" and money actually committed. Worth
  folding into the estimates design rather than building separately.
- **Automatic follow-up on a sent-but-unanswered estimate** (a
  reminder email after a few days of silence) — small, and reuses the
  same reminder-email machinery `src/domains/billing/reminders.ts`
  already has for billing.
- **The brand kit's small service-icon set** (appliance, calendar,
  delivery, home, property, support) — never used anywhere in the app
  yet; a real, separate design decision about where icons like these
  actually belong (see the phase-1/2/3 brand-kit `docs/DECISIONS.md`
  entries), not a quick add-on.
- **A job/work-order document**, matching the brand kit's
  `Work-order.pdf` template the same way the new invoice document
  matches its `Invoice.pdf` — the app's `Job` model (delivery,
  installation, swap, maintenance visit, removal) is the real
  equivalent of a "work order," so this has an actual live feature to
  attach to, unlike the kit's `Estimate.pdf` template before this
  section existed.
- **Not recommended to copy**: Jobber's supplier/materials
  price-catalog integration and consumer-financing (Wisetack)
  integration — both solve a materials-markup/big-ticket-financing
  problem Chris's flat-monthly-rental pricing model doesn't have.
