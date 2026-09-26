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

## Later phases

Feature lists for Phases 3–7 will be filled in here as each phase
starts, following the phase plan and scope in `AGENTS.md`/
`docs/HANDOFF.md` — kept short until then rather than speculatively
detailed now.
