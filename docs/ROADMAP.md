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

- **Automated late fees / dunning** beyond what Stripe's own automatic
  payment retries already do. `invoice.payment_failed` is recorded
  (shows up as a DELINQUENT invoice at `/desk/billing`), but nothing
  automatically charges a late fee or escalates — that needs its own
  design (how many retries, what fee, when to involve Chris) rather
  than a bolt-on to this PR.

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
  - **Rebrand: approved (2026-09-27)** — Chris looked at a real preview
    deployment (PR #41) side by side with the old palette and said he
    likes it. The navy/teal color swap is done (see
    `docs/DESIGN-SYSTEM.md`'s "Brand palette: navy/teal"). **Still
    open**: a real logo (kept the existing typographic wordmark on
    purpose), and the brief's non-color IA/layout ideas, which haven't
    been evaluated against what the in-house review's PR #39 already
    changed.
  - **Property managers / portfolio accounts: in progress** — Chris
    said yes, build it. Turned out to need much less than a "new
    business line" — the data model already supported multiple
    properties per customer (`Customer.serviceAddresses`) and already
    ranked property managers as the highest-value lead type. First
    slice built (2026-09-27): `/desk/customers/new`, adding a customer
    directly with as many properties as needed at once. See
    `docs/BUSINESS-RULES.md`'s "Property managers / portfolio
    accounts" section for exactly what's built vs. still open (a
    portfolio rollup view, the customer portal's "All properties"
    selector, adding properties to an existing customer from the UI).
  - Not started: the 6/12-month-lease framing already exists as the
    prepaid-term discount (see "Pricing" in `docs/BUSINESS-RULES.md`)
    — the brief's owner-desk dashboard/nav rebuild and customer-portal
    rebuild haven't been evaluated against what the in-house review's
    PR #39 already changed yet.
- **Require customers to verify their email before logging in** —
  currently off (`requireEmailVerification: false` in
  `src/lib/auth.ts`), with a note to flip it on once email sending is
  confirmed working in production. That condition is now met (Resend
  confirms `robinsonappliancerentals.com` as fully verified,
  2026-09-27) — flipping it is a one-line change whenever Chris wants
  it. Left off for now since it changes real signup behavior (a new
  customer would have to click a link in an email before their first
  login), which is Chris's call, not an automatic one.
- **A real business email address on the domain** — **done (2026-09-27)**.
  Originally discussed 2026-09-26 as a deferred decision (options were
  Cloudflare Email Routing, Zoho Mail, or Google Workspace/Microsoft
  365). Chris ended up connecting a Google Workspace account for this
  project and had a real, separate mailbox set up:
  `ops@robinsonappliancerentals.com`, with role aliases `chris@`,
  `leads@`, `support@`, `no-reply@`, and `billing@`. Full detail and
  which address maps to which env var/code path is in
  `docs/ARCHITECTURE.md`'s "Email addresses (Google Workspace)" section.
  - **Still open, tracked here on purpose:** wiring the app itself to
    actually use these new addresses — `LEAD_NOTIFICATION_EMAIL`,
    `MAINTENANCE_NOTIFICATION_EMAIL`, and `RESEND_FROM_EMAIL` (Vercel
    environment variables) plus `publicEmail` (edited in
    `/desk/settings`) are all still on their old placeholder/fallback
    values. This is a quick change (a few Vercel env vars + one
    settings-form edit) but touches what customers see and where leads
    land, so it's deliberately left for Chris to say "go" on rather than
    switched over silently.
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
  fleet-wide utilization analytics (`/desk/fleet`). **Still open**:
  formal B2B invoicing for property managers (today's property-manager
  support is account/address structure, not consolidated multi-property
  billing) — not picked yet.
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
  give one/get one, see `docs/DECISIONS.md`. **Still open**: SMS
  notifications, a separate Contacts concept, and an accounting export
  — Chris has picked all three (Task #71/#73, plus real business email
  as Task #69) and they're queued up next.
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
- **A social-share image made specifically for link previews**, sized
  and cropped for how Facebook/text-message/Nextdoor previews actually
  render, instead of reusing the homepage hero photo as-is (done as a
  quick win in the 2026-09-27 pass, worth revisiting once a dedicated
  image exists).
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
