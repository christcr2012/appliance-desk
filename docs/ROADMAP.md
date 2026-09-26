# Roadmap — deferred & suggested items

Things intentionally **not** built yet, either because they belong to a
later phase (see `docs/HANDOFF.md` for the phase plan) or because they're
a suggestion an AI had while working and is flagging for Chris to decide
on — never built unasked.

## Deferred to a later phase (already scoped, just not yet)

- Lead scoring UI (browsing/filtering leads in the desk, not just the
  score itself — that's done), lead → customer conversion, inventory
  management, owner dashboard numbers, `/desk/activity` (browsing the
  `AuditLog` — the log itself is already being written) — Phase 3.
- Rental agreements, e-signature, job scheduling, condition photos —
  Phase 4.
- Customer portal (rentals, billing, maintenance/removal requests) —
  Phase 5.
- Stripe billing (test mode) — Phase 6.
- Full accessibility/security review, backup/restore test, launch
  checklist — Phase 7.

## Suggestions (not scoped into any phase — Chris should decide)

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
- **Real appliance photos**: the public site currently uses generic
  line-art illustrations (with a disclaimer) instead of product photos,
  since there are no real photos to use honestly yet. Once Chris
  supplies real photos (per the launch checklist), swap them in — the
  `Photo` model already supports this, and any photo of a specific real
  unit should keep an "actual item may vary" disclaimer unless it's the
  exact unit being delivered.
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
