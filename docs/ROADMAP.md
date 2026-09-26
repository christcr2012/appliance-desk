# Roadmap — deferred & suggested items

Things intentionally **not** built yet, either because they belong to a
later phase (see `docs/HANDOFF.md` for the phase plan) or because they're
a suggestion an AI had while working and is flagging for Chris to decide
on — never built unasked.

## Explicitly queued by Chris (do in a separate PR, not bundled)

- **Mobile nav → hamburger menu**: Chris doesn't like how the public
  site's header nav looks/behaves on mobile (2026-09-26, right after the
  hero photo fix) and wants it turned into a proper collapsible
  hamburger menu on small screens. Deliberately not bundled into the
  Phase 4 (rental agreements/jobs) PR since he asked for it to be its
  own change — do this next as its own small PR.

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

- **A real business email address on the domain**
  (`chris@robinsonappliancerentals.com` instead of a personal Gmail).
  Discussed 2026-09-26 — Chris asked whether this needs a paid third
  party or can be self-hosted. Short answer: running your own mail
  server isn't recommended (deliverability/spam-filter problems,
  ongoing upkeep), so it'll always involve some outside provider, but
  cost varies a lot:
  - **Free, forwarding only**: Cloudflare Email Routing — forwards
    mail sent to the domain straight to Chris's existing Gmail. Can't
    send *from* the domain address without extra Gmail setup.
    Fastest to set up.
  - **Free, real inbox (up to 5 addresses)**: Zoho Mail — genuine
    send + receive at the domain, works like a normal email account
    (webmail + phone app). Best free option if he wants to actually
    send as `chris@robinsonappliancerentals.com`.
  - **Paid (~$6–7/user/month)**: Google Workspace or Microsoft 365 —
    most polished, easiest if he wants it to feel exactly like the
    Gmail/Outlook he already uses.
  **Deliberately deferred, not forgotten** — Chris asked to revisit
  this either once everything else is done, or right before there's a
  real need for it (e.g. right before launch/marketing push, when a
  `chris@` address starts mattering for how the business looks to
  customers). Nothing about this blocks any other phase — the site's
  `publicEmail` in `/desk/settings` and the Resend lead-notification
  address can keep using whatever inbox he already checks until then.
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
