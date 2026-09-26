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

## Later phases

Feature lists for Phases 4–7 will be filled in here as each phase
starts, following the phase plan and scope in `AGENTS.md`/
`docs/HANDOFF.md` — kept short until then rather than speculatively
detailed now.
