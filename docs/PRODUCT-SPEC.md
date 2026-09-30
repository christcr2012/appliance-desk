# Product spec — features & acceptance criteria

Organized by the phase plan in `docs/HANDOFF.md`. Each feature lists what
"working" means for it. Update this file as each phase is built —
acceptance criteria should be written (or at least sketched) *before* a
feature is built, not reverse-engineered after.

## Phase 1 — Foundation (this phase)

### Repo, Vercel, Neon, CI

- [x] Private GitHub repo `christcr2012/appliance-desk` exists, `main` is
      the default branch.
- [x] Vercel project `appliance-desk` exists in the Robinson AI Systems
      team, connected to the repo.
- [x] Neon project "Appliance Desk" exists with database `appliance_desk`.
- [x] CI (`.github/workflows/ci.yml`) runs migrate-deploy → typecheck →
      lint → unit tests → build → accessibility tests on every PR.
- **Acceptance:** a PR against `main` shows all CI checks and a Vercel
  preview deployment.

### Auth with roles

- [x] `OWNER` / `ADMIN` / `CUSTOMER` roles exist on the `User` model.
- [x] `/login` — accessible email/password form (labeled fields, errors
      tied to fields, keyboard-navigable).
- [x] `/desk/**` requires `OWNER` or `ADMIN`; anyone else is redirected.
- [x] `/account/**` requires any signed-in user.
- [x] Enforcement happens on the server (`requireRole`/`requireSession`),
      not just by hiding navigation.
- **Acceptance:** `tests/session.test.ts` proves a `CUSTOMER` is
  redirected away from an `OWNER`/`ADMIN`-only page and vice versa where
  applicable; `e2e/accessibility.spec.ts` proves the login page passes
  automated a11y checks.

### Docs skeleton & error monitoring

- [x] All files listed in `AGENTS.md` exist.
- [ ] Sentry is wired in code (`instrumentation.ts` /
      `instrumentation-client.ts`) but **inactive** until `SENTRY_DSN` /
      `NEXT_PUBLIC_SENTRY_DSN` are set as real values in Vercel — see
      `docs/HANDOFF.md`.

## Phase 2 — Public website, settings, lead capture

### Public website

- [x] Public marketing pages: home, `/pricing`, `/how-it-works`,
      `/service-area`, `/contact` (the lead form), `/privacy`, `/terms`,
      `/accessibility`, all sharing one header (with an accessible
      hamburger menu on mobile) and footer.
- [x] All business info, pricing, fees, and service area shown on these
      pages comes from `BusinessSettings`/`ApplianceType` — never
      hard-coded — per `docs/BUSINESS-RULES.md`.
- [x] Launch catalog: Washer, Dryer, and Washer + Dryer Set (bundle
      price), seeded as data (`prisma/seed.ts`) — more categories are a
      data change, not a code change, when Chris is ready to add them
      (fridges, ranges, etc. — see `docs/ROADMAP.md`).
- [x] No product photos yet (none exist to use honestly) — generic
      line-art illustrations stand in, with a visible disclaimer
      ("actual appliance may vary in brand, model, and color") wherever
      they appear. Replace with real photos once Chris supplies them.
- **Acceptance:** every public page passes the same automated
  accessibility checks as Phase 1 (`e2e/accessibility.spec.ts`, WCAG 2.1
  AA tags), and the mobile menu opens/closes correctly with mouse and
  keyboard (Escape).

### Lead capture

- [x] `/contact` captures every field `docs/BUSINESS-RULES.md` requires:
      individual vs. business, landlord/property-manager flag, appliances
      + quantity, desired term, address (+ service-area check), start
      date, name, phone (required), email (encouraged), best time to
      contact, how they heard about us, notes, and a required
      privacy/terms consent checkbox.
- [x] Submitting creates a `Lead` (+ `LeadApplianceRequest` rows + a
      `ConsentRecord`), scored by simple, explainable rules
      (`src/domains/leads/scoring.ts`) — every point has a
      plain-English reason attached, never a black box.
- [x] Chris is emailed immediately on every new lead (Resend); high-value
      leads say so in the subject line. A failed send never fails the
      lead submission itself.
- **Acceptance:** `tests/lead-scoring.test.ts` proves the ranking rule
  (month-to-month → 6-month → 12-month → bulk → property manager);
  `e2e/lead-form.spec.ts` proves a real submission succeeds against a
  real database and that missing required fields show accessible
  validation errors instead of crashing.

### Settings

- [x] `/desk/settings` (OWNER/ADMIN only) edits public business info,
      service area, fees, deposit/damage-waiver toggles, late fee, and
      the sales-tax rate (defaults to 0% with a visible "not yet
      confirmed" state until checked off — never guessed).
- [x] `/desk/settings` also edits each appliance type's published price
      and whether it shows on the public site. Every change writes a
      `PricingRule` + `AuditLog` entry (who, when, old → new) — an
      already-signed `RentalAgreement` is unaffected by a later price
      change, per `docs/BUSINESS-RULES.md`.
- **Acceptance:** changing a price on `/desk/settings` updates
  `/pricing` immediately; the change is visible in the underlying
  `AuditLog`/`PricingRule` rows (a desk UI for browsing `/desk/activity`
  is Phase 3).

### SEO

- [x] Per-page titles/descriptions, `sitemap.xml`, `robots.txt`
      (disallowing `/desk` and `/account`), and `LocalBusiness`
      structured data (JSON-LD) sourced from `BusinessSettings`.

## Phase 3 — Lead management, dashboard, activity log (slice 1)

Started 2026-09-26. First slice: everything that doesn't need a
database migration (inventory management — tracking individual
physical `Appliance` units — needs real desk UI for something that
didn't exist before and is deliberately left for the next slice; see
`docs/ROADMAP.md`).

### Lead management (`/desk/leads`)

- [x] Browse all leads, filterable by status (New/Contacted/Converted/
      Lost) via tabs that also show each status's count, sorted
      highest-value first.
- [x] A lead's detail page shows every field captured on the public
      form, its score and the plain-English reasons behind it, and its
      appliance requests.
- [x] Chris can move a lead between New/Contacted/Lost.
- [x] Chris can convert a lead directly into a `Customer` (+ `User`
      account + `ServiceAddress`, when an address was given) in one
      action — per `docs/BUSINESS-RULES.md` step 3. Deliberately stops
      short of creating a `RentalAgreement` — that's Phase 4
      (e-signature, real terms) and shouldn't be guessed here.
      Requires the lead to have an email address (a customer account
      needs one to sign in); the UI explains why the button is
      disabled otherwise rather than failing silently.
  - A brand-new account gets a one-time random temporary password,
    shown once to Chris in the UI (never emailed automatically — there's
    no "set your own password" invite flow yet, tracked in
    `docs/ROADMAP.md`).
- [x] Every status change and conversion writes an `AuditLog` entry.
- **Acceptance:** `tests/leads.test.ts` proves the conversion guard
  (`canConvertLead`) correctly blocks a lead with no email and a lead
  that's already converted, and allows an otherwise-valid one.

### Dashboard (`/desk/dashboard`)

- [x] Replaces the Phase 1 placeholder with real counts: new leads
      needing attention, high-value new leads, contacted leads,
      converted leads, total customers, and appliance counts by status.
      No revenue/billing numbers yet — that needs Stripe (Phase 6).

### Activity (`/desk/activity`)

- [x] Lists the 50 most recent `AuditLog` entries (who, what, when) in
      plain English, for every action already writing one (settings,
      pricing, appliance types, leads).

## Phase 3 — Inventory management (slice 2)

Started 2026-09-26, right after slice 1 merged — Chris has no
inventory yet but needs the system ready to capture it as he obtains
appliances. Needed one schema migration (`Appliance.color`,
`Appliance.features`, and the new `PartRecord` table).

### Inventory (`/desk/inventory`)

- [x] Add one or more new physical appliance units of an existing
      `ApplianceType`, starting from zero — each gets an auto-generated
      human-readable asset number (e.g. `WASH-0001`).
- [x] Capture manufacturer, model, serial number (single-unit adds
      only — bulk adds get theirs added individually afterward), color,
      condition, purchase date, what Chris paid, current location, and
      notes.
- [x] Capture free-form **features** per unit (e.g. front-load,
      top-load, agitator for a washer) — a comma-separated tag list, not
      a fixed per-category field, so a new category or an unanticipated
      feature never needs a schema change.
- [x] Browse/filter units by status, with counts per tab.
- [x] A unit's detail page: change its status (server-enforced allowed
      transitions — `RETIRED` is terminal) and edit all its descriptive
      details, including color and features.
- [x] Every add, edit, and status change writes an `AuditLog` entry.
- **Acceptance:** `tests/inventory.test.ts` covers the status-transition
      rule, the asset-number prefix logic, and asset-number formatting.

### Parts catalog (`/desk/parts` + per-appliance "Parts for this model")

- [x] Log a part number (+ optional part name/notes) against a
      **model number** — not against one physical unit — so it's
      reusable for every future unit of that same model.
- [x] An appliance's own detail page shows/adds parts for its model
      directly; `/desk/parts` lists everything logged, across all
      models, for browsing independent of any one unit.
- [x] Every part logged or removed writes an `AuditLog` entry.

## Phase 4 — Rental agreements, e-signature, job scheduling

Started 2026-09-26, proactively (Chris asked to keep building and
improving without checking in on every slice). No schema migration
needed — `RentalAgreement`, `RentalLine`, `ApplianceAssignment`,
`SignatureRecord`, `Job`, `JobAppliance`, and `Photo` were all already
part of the original Phase 1 schema/migration.

### Customers (`/desk/customers`)

- [x] Browse every converted customer, and a detail page showing their
      service addresses, agreements, and jobs.

### Rental agreements (`/desk/agreements`)

- [x] Start a draft agreement for a customer: service address, term,
      deposit, damage waiver, late fee (flat and/or percent + grace
      days), tax rate.
- [x] Add appliance line items to a draft — pick specific `AVAILABLE`
      physical units (a set = two units on one line); this reserves
      them so they can't be double-booked onto another agreement.
- [x] Send a draft for signature — generates a private, unguessable
      link for the customer, no login required.
- [x] The public `/sign/[id]` page: customer reviews the terms and
      signs by typing their full name + checking a box + submitting.
      Recorded with a timestamp and IP address. This is a lightweight,
      in-house signature capture, not a paid e-signature service — see
      `docs/BUSINESS-RULES.md` and `docs/ROADMAP.md` for why that's a
      deliberate, cost-driven choice left to Chris.
- [x] Signing moves the agreement to `ACTIVE` and its appliances from
      `RESERVED` to `RENTED`.
- [x] Chris can end or cancel an agreement at any stage, freeing its
      appliances back to `AVAILABLE`.
- **Acceptance:** `tests/agreements.test.ts` proves the status-transition
      rule (draft → awaiting signature → active → ended, cancellable
      from any non-terminal state, no skipping straight to active
      without a signature).

### Jobs (`/desk/jobs`)

- [x] Schedule a delivery/installation/swap/removal/maintenance visit,
      optionally tied to a customer, address, and agreement (with its
      assigned appliances pre-selectable).
- [x] Move a job through scheduled → in progress → completed (with
      completion notes) or cancelled, enforced server-side.
- [x] Attach condition photos by URL (no file-upload/blob storage
      decision made yet — pasted URLs, same pattern as appliance-type
      photos in `/desk/settings`).
- **Acceptance:** `tests/jobs.test.ts` proves the status-transition rule.

### Dashboard

- [x] Added draft/awaiting-signature/active agreement counts and a
      scheduled-jobs count alongside the existing lead/customer/
      appliance numbers.

## Phase 5 — Customer portal, slice 1 (rentals + maintenance requests)

Started 2026-09-26, proactively continuing right after Phase 4 merged.
Billing/payment history isn't here yet — that needs Stripe (Phase 6) —
so this slice is everything else the brief calls for: a customer
signing into `/account` can see their own rentals and file a
maintenance request. No schema migration needed — `MaintenanceRequest`
was already part of the Phase 1 schema.

### `/account` (overview, rentals, maintenance)

- [x] Overview: active-rental count, upcoming-visit count, open-
      maintenance-request count, and a summary of active rentals.
- [x] `/account/rentals`: every rental agreement (address, term, line
      items, monthly total, deposit) and delivery/visit history.
- [x] `/account/maintenance`: submit a new request (which appliance,
      problem description, urgency) and see the status of past ones.
- **Security-critical, per `docs/BUSINESS-RULES.md`**: every portal
      query is scoped by the signed-in user's own id, never by anything
      the client supplies — including which appliance a maintenance
      request can be filed against (`getPortalApplianceOptions`
      verifies the appliance is actually assigned to this customer's
      own active agreement before accepting a request naming it).

### `/desk/maintenance` (Chris's side)

- [x] Browse/filter requests by status, see the full problem
      description, which appliance and customer, and priority.
- [x] Move a request through submitted → reviewing → scheduled → in
      progress → resolved, or close it out from any non-terminal
      status — enforced server-side.
- [x] A link to schedule a `Job` for the visit this implies — now
      pre-fills the customer/address/appliance and links the resulting
      `Job` back to the `MaintenanceRequest` (slice 3, below).
- [x] Dashboard: added an open-maintenance-requests count.
- [x] Chris is emailed when a customer submits a new request (slice 2,
      below) — same pattern as new-lead notifications.
- **Acceptance:** `tests/maintenance.test.ts` proves the status-
      transition rule (linear happy path, closable from any non-
      terminal status, no skipping steps, closed is terminal).

### Slice 2 — maintenance-request email notification

- [x] `createMaintenanceRequestForUser` emails
      `MAINTENANCE_NOTIFICATION_EMAIL` (falling back to `/desk/settings`'s
      public email) whenever a customer submits a request. HIGH/URGENT
      requests are flagged in the subject line.

### Slice 3 — link a scheduled Job back to its MaintenanceRequest

- [x] "Schedule a job for this" now carries the request's id through to
      `/desk/jobs/new`, pre-filling the customer, offering their service
      addresses, and pre-checking the named appliance (if any).
- [x] The request's own page lists any job(s) scheduled for it; the
      job's own page links back to the request.
- [x] Deliberately does not auto-change the request's status when a job
      is scheduled — Chris still moves it through the flow by hand (see
      `docs/BUSINESS-RULES.md`).
- **Needs a schema migration** — see `docs/HANDOFF.md`.

## Phase 6A — Production hardening & safety

Closed the real gaps left open after Phase 5: no automatic migration
pipeline, customer passwords Chris had to relay by hand, no spam
protection on public forms, appliances reserved forever if a draft
agreement was abandoned, and no test that actually proved customer
data isolation against a real database.

### Safe, automatic production database migrations

- [x] `package.json`'s `vercel-build` script runs, in order:
      `check:migrations` → `db:migrate:deploy` →
      `db:verify-schema-health` → `build`. A failed step fails the
      whole build, and Vercel never promotes a failed build, so the
      last good deploy keeps serving.
- [x] `scripts/check-migrations.mjs` blocks a migration containing a
      destructive pattern (drop, table wipe, forcing an existing
      column to required) unless explicitly marked reviewed; runs in
      CI on every PR too, not just at deploy.
- [x] `scripts/verify-schema-health.ts` confirms the live schema
      actually matches what the app expects after migrations apply.
- [x] Chris no longer pastes migration SQL into Neon by hand — merging
      a PR is enough. Neon's own 6-hour point-in-time restore is the
      rollback path.
- **Acceptance:** a PR containing a schema migration deploys,
  migrates, and verifies itself automatically on merge to `main`;
  `scripts/check-migrations.mjs` rejects a destructive migration
  that isn't marked reviewed.

### Customer account activation & password recovery

- [x] Public `/forgot-password` and `/reset-password` pages;
      `/login` links to them; reset emails sent via Better Auth's own
      reset-link flow through the existing Resend helper.
- [x] Converting a lead into a customer no longer generates a
      password Chris has to relay — the account gets a random,
      discarded password and is emailed the same "set your password"
      link.
- [x] "Resend activation email" button on each customer's desk page
      for expired/missed links.
- **Acceptance:** `tests/leads-conversion.test.ts` proves a new
  customer's password is random/discarded and never returned to the
  caller, and that the activation email uses Better Auth's real
  `requestPasswordReset` call.

### Public form spam/abuse protection

- [x] Honeypot field on `/contact` — silently drops bot submissions
      (no `Lead` row, no email).
- [x] Per-IP rate limit, `src/lib/rate-limit.ts` — in-memory sliding
      window, explicitly documented as best-effort (per serverless
      instance, not a shared store); 5 lead submissions / 10 minutes /
      IP.
- [x] Same rate-limit pattern later extended to `/sign/[id]`'s
      signing action (10 / 10 minutes / IP) during the Phase 7
      security review.
- **Acceptance:** `tests/rate-limit.test.ts` and
  `tests/contact-spam-protection.test.ts` prove the honeypot drops
  silently without touching the limiter, a rate-limited IP never
  creates a `Lead`, and a normal submission passes both checks.

### Reservation aging / abandoned draft agreements

- [x] `BusinessSettings.draftReservationHoldDays` (owner-adjustable,
      default 7) and `RentalAgreement.reservationExpiresAt` track how
      long a DRAFT/AWAITING_SIGNATURE agreement may hold its reserved
      appliances.
- [x] "Stale hold" badge on `/desk/agreements`'s list; a warning
      banner + "Extend reservation" button on the agreement's own
      page. Nothing expires automatically — Chris always chooses to
      extend or cancel.
- [x] Dashboard shows a stale-reservation-holds count.
- **Acceptance:** `tests/agreements.test.ts`'s `isReservationStale`
  cases and `tests/agreements-extend-reservation.test.ts` prove the
  staleness rule and the extend action.

### Real customer-data-isolation integration test

- [x] `tests/customer-isolation.test.ts` runs against a real database
      (not mocked). Creates two independent customer fixtures and
      proves the portal (`src/domains/portal`) never leaks one
      customer's rentals, addresses, appliances, or maintenance
      requests to the other; cleans up everything it creates.
- **Acceptance:** `tests/customer-isolation.test.ts` passes in CI
  against a real, migrated, disposable Postgres instance — the
  actual proof point, since it cannot run in the local sandbox (see
  `AGENTS.md`).

## Phase 6B — Stripe billing

Real Stripe test-mode billing, card and ACH. **Current behavior**
(revised 2026-09-28 from the phase's original design): billing starts
at delivery, not at signing — see `docs/ARCHITECTURE.md`'s "Payments
(Stripe)" section for the full technical picture.

### Billing model

- [x] Anniversary billing — each customer's subscription bills on the
      day-of-month they were actually delivered, not one fixed date
      for everyone.
- [x] Deposits and damage waivers are charged as real money up front
      at signing (never just authorized/held), via a Stripe Checkout
      Session in "payment" mode (or "setup" mode if there's nothing to
      charge) that also saves a payment method for later off-session
      billing.
- [x] The recurring Subscription is created separately, only once a
      delivery/installation `Job` for the agreement is marked
      `COMPLETED` (`startRecurringBillingForAgreement`) — not at
      signing.
- [x] If recurring billing can't start (no saved payment method, a
      declined card, any Stripe error), the delivery still completes;
      the reason is recorded on `RentalAgreement.billingBlockedReason`
      rather than thrown, and surfaced to Chris via the exception
      inbox.
- [x] Both card and ACH bank-transfer payments are offered from
      signing onward.
- **Acceptance:** `tests/billing-checkout-mode.test.ts` and
  `tests/billing-start-recurring.test.ts` prove signing never creates
  a Subscription and delivery-completion does (using the saved
  payment method), and that a missing/failed payment method sets
  `billingBlockedReason` instead of failing the delivery.

### Webhook-driven Invoice/Payment/Deposit records

- [x] `/api/webhooks/stripe` (`src/domains/billing/webhooks.ts`) is
      the *only* code path that writes `Invoice`/`Payment`/`Deposit`
      rows — never speculatively, only once Stripe confirms money
      moved. Handles `checkout.session.completed`,
      `checkout.session.async_payment_succeeded`/`failed` (covers
      ACH), `invoice.paid`, `invoice.payment_failed`,
      `charge.refunded`, and `customer.subscription.deleted`.
- [x] Every event is deduplicated by Stripe's own event id
      (`WebhookEvent` table), so a retried delivery is never
      double-counted.
- [x] Signature verification happens before any other processing;
      malformed/unsigned requests are rejected.
- **Acceptance:** `tests/billing-webhooks.test.ts` (real database)
  covers the checkout-completed happy path, idempotent replay of the
  same event, an unrelated event type, and a failed payment — verified
  in CI against real Postgres.

### Late fees & billing reminders

- [x] Automated late fees (`src/domains/billing/late-fees.ts`):
      applies the larger of the agreement's own flat `lateFeeCents` or
      `lateFeePercent`, frozen at signing (never `BusinessSettings`'
      current defaults). `Invoice.lateFeeCents` doubles as the
      idempotency guard — never stacked on repeated cron runs. No new
      charge attempts (Stripe's own retries handle that); a same-day
      digest email goes to Chris.
- [x] Billing reminders (`src/domains/billing/reminders.ts`): a daily
      cron emails a customer 1–2 days before their next
      `nextBillingDate`, guarded by `billingReminderSentForDate` so
      the same cycle never reminds twice.
- **Acceptance:** `tests/billing-late-fees.test.ts` and
  `tests/billing-reminders.test.ts` prove the fee-amount rule, the
  once-per-invoice guard, and the reminder window/dedup logic.

### Billing Portal & desk/portal views

- [x] "Manage billing" opens Stripe's own hosted Billing Portal so a
      customer can update card/ACH details and see past invoices
      themselves (`createBillingPortalSession`).
- [x] `/account/billing` (customer) and `/desk/billing` (Chris, all
      customers, paginated) both show real Invoice/Payment/Deposit
      data sourced only from webhook-written rows.
- **Acceptance:** `tests/billing-manual-payments.test.ts` and
  `tests/billing-statements.test.ts` cover manual payment recording
  and statement generation against the same webhook-sourced ledger.

## Phase 7 — Launch hardening

### Security review

- [x] Full review of authorization, secrets, input validation, rate
      limiting, webhook hardening, error disclosure, and
      session/cookie config — no critical issues found.
- [x] Fixed gap: `/sign/[id]`'s signing action got the same per-IP
      rate limit already used on the contact form (10 attempts/10
      min).
- [x] Confirmed clean: every `/desk/**` action calls `requireRole`;
      every `/account/**` action derives the customer from the
      server-side session (no IDOR); no hardcoded secrets; every
      server action validates with zod; the Stripe webhook verifies
      its signature before any processing.
- [x] `requireEmailVerification` is `true` in `src/lib/auth.ts`.
- **Acceptance:** no automated test file for this (it's a manual
  review), documented in `docs/DECISIONS.md`'s 2026-09-27 "Security
  review (Phase 7)" entry; the one code change (`/sign/[id]` rate
  limiting) is covered by the same pattern `tests/rate-limit.test.ts`
  and `tests/contact-spam-protection.test.ts` already prove for the
  contact form.

### Accessibility test coverage (authenticated pages)

- [x] `e2e/accessibility.spec.ts` covers every public page plus
      `/login`, `/forgot-password`, `/reset-password`.
- [x] `e2e/accessibility-authenticated.spec.ts` extends the same
      automated axe checks to every page in both the `/desk/**` nav
      (OWNER) and `/account/**` nav (CUSTOMER), using real seeded
      test accounts gated behind CI-only env vars.
- [x] Zero real accessibility violations found across all
      authenticated pages.
- **Acceptance:** `e2e/accessibility-authenticated.spec.ts` (and
  `e2e/accessibility.spec.ts`, `e2e/accessibility-dark-mode.spec.ts`)
  run in CI on every PR and must pass with zero axe violations before
  merge.

### Independent daily backup

- [x] `/api/cron/backup` (daily, 09:00 UTC) exports every
      business-critical table (excluding auth/session bookkeeping and
      the Stripe webhook log) to a JSON file in Vercel Blob, kept 30
      days with older copies pruned — a second copy on a different
      provider than Neon.
- [x] Explicitly scoped as a data export, not a one-click restore:
      getting data back out means re-inserting the JSON via a script.
- [x] Sits alongside, not instead of, Neon's own 6-hour point-in-time
      recovery, which was separately drilled and verified (restore-
      to-branch, confirmed working) on 2026-09-28.
- **Acceptance:** `tests/backup.test.ts`; `src/domains/backup/index.ts`'s
  `BACKUP_TABLES` list is the source of truth for what's included.

## Post-launch feature work

Everything below was built ad-hoc after Phase 7 as numbered "Task #NN"
work items and dated feature drops — never a further numbered phase
plan, so it isn't organized as "Phase N" here. See "Keeping this file
current" below for how new work should be added going forward.

### Estimates / quotes

- [x] Staff (OWNER/ADMIN only) create a draft estimate for a customer
      (or start one for a brand-new lead not yet a customer) with
      free-form line items — description, quantity, a monthly amount
      and/or a one-time fee, optionally tied to one of the customer's
      service addresses.
- [x] Sending an estimate generates a private, unguessable link
      (`/estimate/[id]`, same "the id is the link" pattern as
      `/sign/[id]`) — no customer login required.
- [x] The customer approves or requests changes online; approval is a
      real, timestamped record (who/when).
- [x] If the estimate carries a deposit, approving it immediately
      opens a real Stripe Checkout session for that deposit
      (`createDepositCheckoutSessionForEstimate`) — nothing is marked
      paid until Stripe's webhook confirms it; a customer who backs
      out of checkout stays APPROVED and can pick payment back up from
      the same link ("Pay deposit" button).
- [x] A daily cron (`src/app/api/cron/estimate-follow-ups`) sends one
      automatic follow-up email if a sent estimate sits SENT/VIEWED
      for 3+ days with no response; re-sending a revised estimate
      resets the cycle.
- [x] An approved estimate converts to one or more DRAFT rental
      agreements (`convertEstimateToAgreements`) — Chris picks, per
      conversion, either "single" (one agreement on one chosen
      property) or "per property" (one agreement per distinct property
      referenced by the line items); conversion never touches real
      inventory or reserves appliances, only creates the agreement
      shell(s) with the agreed terms. When the estimate's deposit was
      already collected and conversion is "single" mode, that deposit
      carries onto the new agreement automatically (no double charge
      at signing); "per property" conversions flag Chris to reconcile
      the already-collected deposit by hand.
- **Acceptance:** `tests/estimates.test.ts`, `tests/estimate-deposit.test.ts`,
  `tests/estimate-follow-ups.test.ts`.

### CRM: contact history, lost reasons, follow-up tasks

- [x] Leads get a timestamped note log (`LeadNote`) alongside
      customers' existing `CustomerNote` history — "called Tuesday, no
      answer," who logged it, when.
- [x] Marking a lead Lost requires picking a reason first (too
      expensive, went with a competitor, outside service area, never
      heard back, changed their mind, or Other) — shown back on the
      lead's own page afterward.
- [x] `/desk/reports` breaks down leads and conversion rate by how
      they heard about the business.
- [x] `/desk/tasks` is a personal due-date-plus-note follow-up list,
      optionally tied to a lead/customer/job from that record's own
      page; open to STAFF logins too since it's personal organization,
      not financial data.
- [x] `/desk/activity` gained Today/This week/All time tabs and a
      category breakdown (leads, estimates, jobs, billing, ...), built
      entirely from the existing audit log.
- **Acceptance:** `tests/leads.test.ts`, `tests/leads-conversion.test.ts`.

### Staff accounts & roles

- [x] A `STAFF` role (`prisma/schema.prisma`'s `Role` enum) for a
      day-to-day operational login that isn't OWNER/ADMIN.
- [x] STAFF can reach the desk layout and its operational pages —
      dispatch, driver view, jobs (view/update status/complete), and
      tasks.
- [x] STAFF is blocked from business financials and settings:
      billing, revenue, reports, settings, estimates,
      purchasing/suppliers, leads, customers, and inventory all still
      require `requireRole("OWNER", "ADMIN")` specifically.
- [x] `/desk/settings`'s staff-accounts panel lets OWNER/ADMIN create a
      staff login (emails them a set-your-password link, same
      activation flow as a converted customer account), deactivate,
      and reactivate an account.
- **Acceptance:** `tests/staff-accounts.test.ts`.

### Purchasing & supplies

- [x] `Supplier` records: contact info (name, contact person, phone,
      email, notes) plus a read-only count of its purchase orders — no
      approval workflow, no supplier-specific pricing.
- [x] `PurchaseOrder` moves DRAFT → ORDERED → RECEIVED, or CANCELLED
      at any point before RECEIVED.
- [x] Each `PurchaseOrderLineItem` optionally links to an existing
      `PartRecord`, or is a free-text description for a one-off buy
      not tracked as inventory.
- [x] Receiving a purchase order (`receivePurchaseOrder`) is the one
      action that changes stock — every line's quantity is added onto
      its linked `PartRecord.quantityOnHand` in one shot (no partial
      receiving); lines with no linked part don't affect stock.
- [x] Desk pages: `/desk/suppliers` (list/detail/new) and
      `/desk/purchase-orders` (list/detail/new); `/desk/parts` gained
      a part-stock panel showing current quantity on hand. All
      OWNER/ADMIN only.
- **Acceptance:** `tests/purchasing.test.ts`.

### Dispatch board & driver view

- [x] `/desk/dispatch` — day/week/agenda views of scheduled jobs, an
      unscheduled-jobs queue, and conflict detection for jobs
      double-booked onto overlapping times.
- [x] Per-job checklists with progress tracking.
- [x] `/desk/driver` — a driver's own today's-stops view (name,
      address, appliances, notes) with no pricing or financial data
      shown; reachable by STAFF as well as OWNER/ADMIN.
- **Acceptance:** `tests/dispatch-board.test.ts`, `tests/jobs.test.ts`.

### Growth, Revenue, Reports, Today, Tasks, Activity, Fleet, Search

- [x] `/desk/growth` — five read-only, explainable (no AI/ML) signals:
      churn risk, lead win-back candidates, price-review reminders
      (agreements priced a year+ ago), fleet flags (near-fully-rented
      or mostly-idle appliance types), and review/referral candidates
      (customers billing cleanly 90+ days).
- [x] `/desk/revenue` — MRR/ARR from active agreements' agreed
      pricing; collected/past-due/failed-payment figures come directly
      from Stripe, never estimated.
- [x] `/desk/reports` — estimated vs. actual earnings per agreement
      (flags any agreement >$10 behind its estimate), missing
      repair-cost warnings on completed maintenance jobs, lead-source
      breakdown, and a CSV transactions export.
- [x] `/desk/today` — the exception inbox: billing blocked, expired
      reservations, past-due invoices, overdue jobs, stale unreviewed
      maintenance requests, and appliances awaiting inspection too
      long — sorted by severity then age.
- [x] `/desk/tasks`, `/desk/activity` — see CRM section above.
- [x] `/desk/fleet` — per-appliance utilization percentage and
      profitability/ROI (revenue estimated from assignment days ×
      agreed price, minus repair cost and purchase cost).
- [x] `/desk/search` — a plain-GET, JS-free global search across
      customers, appliances, and leads from the desk header.
- **Acceptance:** `tests/growth.test.ts`, `tests/growth-churn.test.ts`,
  `tests/growth-signals.test.ts`, `tests/reports.test.ts`,
  `tests/reports-earnings.test.ts`, `tests/revenue-trend.test.ts`.

### Referral program

- [x] Every customer automatically gets a shareable
      `Customer.referralCode`.
- [x] A new lead who enters someone's code on the public form is
      linked to that customer (`Referral`, PENDING) once the lead
      converts to a customer.
- [x] The reward — one owner-adjustable dollar amount
      (`BusinessSettings.referralRewardCents`, $25 default) — fires
      for both sides only once the *referred* customer's billing
      actually starts, never on signup alone.
- [x] Applied as a real Stripe account-balance credit where a Stripe
      customer exists, plus a `CustomerCredit` record on both sides
      either way, visible on each customer's own page.
- **Acceptance:** `tests/referrals.test.ts`.

### Shared status-badge/icon system

- [x] `<StatusBadge>` (`src/components/status-badge.tsx`) maps every
      status across the app (leads, estimates, purchase orders,
      invoices, inventory, jobs) to one of five tones (success,
      pending, attention, stopped, progress), each with a small icon
      plus color — never color alone — replacing per-page
      copy-pasted color maps. See `docs/DESIGN-SYSTEM.md`'s "Status
      badges" section for the pattern going forward.

### Prelaunch interest list & automated welcome emails

Built by a different AI tool (branch `ai/codex/prelaunch-interest-list`,
PR #86), reviewed and merged 2026-09-30. Chris approved this as a
separate, authorized extension before work started.

- [x] The homepage/header/banner correctly identify the business as
      still preparing to launch — no opening date, reservation,
      inventory, or universal free-delivery promise stated.
- [x] Public `/launch` saves explicitly opted-in local interest, with
      real validation, per-IP rate limiting, and a silently-dropped
      honeypot; a repeated or concurrent signup from the same
      (normalized) email creates exactly one subscriber row and can
      never quietly undo a prior unsubscribe.
- [x] Three emails run on a fixed daily-cron schedule through the
      existing Resend sender, each with a postal address, a monitored
      reply inbox, and a working one-click unsubscribe
      (RFC 8058-compliant headers; the unsubscribe page's GET never
      mutates state, only POST does). Sending defaults OFF
      (`LaunchSettings`) until Chris turns it on; leaving it off never
      blocks signup itself.
- [x] A provider error is never recorded as a successful send — a
      failed or uncertain attempt permanently blocks that
      subscriber's sequence for Chris to review by hand
      (`/desk/launch`), rather than silently retrying or skipping a
      step. Concurrent cron runs can't double-send the same step
      (a guarded `updateMany` claims the send).
- [x] Settings, copy, delivery status, source counts, and the
      paginated subscriber list are all OWNER/ADMIN only, checked
      inside every server action, not just hidden from the nav.
- **Acceptance:** `tests/launch.test.ts`, `tests/launch-actions.test.ts`,
  and `tests/launch-integration.test.ts` (the last runs against a real
  database and exercises dedupe, concurrent-signup, concurrent-cron,
  provider-failure, and unsubscribe-then-resignup cases); `e2e/launch.spec.ts`
  covers the signup + unsubscribe flow end to end.

## Keeping this file current

Backfilled 2026-09-29 (see `docs/DECISIONS.md`). Chris's call: keep
this file as the single, current feature spec going forward, rather
than letting `docs/DECISIONS.md`/`docs/ROADMAP.md` be the only record.
**From here on, add a new `###` entry under the relevant `##` section
(or a new `## Post-launch feature work` subsection) in the same PR
that ships a feature** — the same discipline this file already asks
for at the top ("update this file as each phase is built"), now
actually being followed for real.
