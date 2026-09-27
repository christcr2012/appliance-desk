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
- Stripe billing (test mode) — Phase 6.
- Full accessibility/security review, backup/restore test, launch
  checklist — Phase 7.

## Suggestions (not scoped into any phase — Chris should decide)

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
- **Google Search Console / Google Business Profile** connection —
  needs a real public business name and domain first (Phase 2/7).
- **A design system / component library beyond Tailwind utilities** if
  the desk UI grows complex enough (e.g. a real data table for
  inventory) — evaluate shadcn/ui components as each screen needs them,
  rather than importing the whole library up front.
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
- **Real file uploads for photos** (condition photos on jobs, appliance-
  type photos) instead of pasting a URL — needs a decision on file/blob
  storage (e.g. Vercel Blob) and likely a small recurring cost. Pasting
  a URL works fine for now since Chris already has photos hosted
  somewhere (or can use a free image host), so this isn't urgent.
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
