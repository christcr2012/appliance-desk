# Handoff — current state

**Read this first, every session.** Update it before ending any session.
Phase 1 (Foundation) completed 2026-09-26. Phase 2 (Public website,
settings, lead capture) built 2026-09-26 — see the "Phase 2" section
below for what's pending before it can be marked fully verified.

## What actually works right now

- The database is real and live: Neon project "Appliance Desk"
  (`jolly-term-08991992`), database `appliance_desk`, region AWS US East
  1. The **full** schema from `prisma/schema.prisma` has been applied
  (not just an auth subset) — see `docs/DECISIONS.md` for how, since the
  normal `prisma migrate` command couldn't reach the internet from the
  sandbox this was built in.
- Login works end-to-end in code: `/login` (email + password, via
  Better Auth), server-side role enforcement for `/desk/**` (OWNER/ADMIN
  only) and `/account/**` (any signed-in user), and automated tests
  proving the redirect behavior for the wrong role (`tests/session.test.ts`,
  5/5 passing).
- **CI is green, end to end, confirmed on GitHub Actions** (not just
  locally): `.github/workflows/ci.yml` runs on every PR and on `main`,
  and its most recent run on `main` (before Phase 2) passed every step —
  install, `prisma migrate deploy` against a real throwaway Postgres,
  type-check, lint, unit tests, production build, and Playwright + axe
  accessibility checks against the built app. Phase 2's CI run is
  tracked in the PR — see "Phase 2" below.
- **The Vercel project exists and is deployed.** Project `appliance-desk`
  in the "Robinson AI Systems" team, connected to this GitHub repo, with
  `DATABASE_URL`, `DIRECT_URL`, and `BETTER_AUTH_SECRET` set for
  Production/Preview/Development. The production site is live at
  `https://appliance-desk.vercel.app`.
- Every doc `AGENTS.md` requires exists (this list, `PRODUCT-SPEC.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`,
  `DESIGN-SYSTEM.md`, `DECISIONS.md`, `ROADMAP.md`, `OWNER-GUIDE.md`).
- **Chris's OWNER account exists and works.** Created via
  `prisma/seed.ts`'s logic, run once against the live database with
  Chris's chosen email and password. He can log in at
  `https://appliance-desk.vercel.app/login`.

## Phase 2 — Public website, settings, lead capture

Built this session (see `docs/PRODUCT-SPEC.md`'s Phase 2 section for the
full acceptance criteria, and `docs/DECISIONS.md` for the design/tech
choices). Branch `ai/claude/phase-2-public-site`, via PR (not pushed
directly to `main` — this is the first phase following the branch/PR
rule properly, see the Phase 1 deviation note below).

- [x] Public site: home, `/pricing`, `/how-it-works`, `/service-area`,
      `/contact` (lead form), `/privacy`, `/terms`, `/accessibility`.
- [x] `/desk/settings` (OWNER/ADMIN) — edit business info, service area,
      fees, tax rate, and per-appliance pricing/visibility.
- [x] Lead capture end to end: form → scored `Lead` → email notification
      to Chris (via Resend, guarded — see below).
- [x] SEO: sitemap, robots.txt, per-page metadata, LocalBusiness JSON-LD.
- [x] Starter appliance catalog seeded as data: Washer, Dryer, Washer +
      Dryer Set (per Chris's plan to launch with washers/dryers and add
      more categories later — see `docs/ROADMAP.md`).
- [x] Local verification: lint (0 errors), unit tests (12/12 passing,
      including new `tests/lead-scoring.test.ts` and
      `tests/pricing.test.ts`), and `next typegen && tsc --noEmit` clean
      of everything **except** the same pre-existing, documented sandbox
      limitation from Phase 1 (`@prisma/client` can't be generated
      locally — see `docs/DECISIONS.md`, "Local sandbox could not run
      `prisma generate`/`migrate`"). That limitation now shows up in a
      few more files that touch Prisma-derived types than in Phase 1,
      for the same one reason, not new bugs.
- [x] **Verified on the actual PR** (https://github.com/christcr2012/appliance-desk/pull/1):
      GitHub Actions CI is fully green (migrate, seed, typecheck, lint,
      unit tests, build, accessibility/e2e — including a real lead-form
      submission against a real throwaway database), and the Vercel
      preview build completed cleanly (all 17 routes generated, no
      errors). Two real bugs were caught and fixed along the way — see
      docs/DECISIONS.md: (1) the Neon driver adapter doesn't work
      against a plain, non-Neon Postgres like CI's; (2) two color
      choices fell just under WCAG AA's 4.5:1 contrast ratio.
- [ ] **Not yet merged to `main` on purpose.** Merging is a decision for
      Chris, not something this session does unilaterally — the PR is
      open and ready for him to review (or just say the word) and merge
      whenever he's ready.
- [ ] **Production data:** the live Neon database does not yet have the
      `BusinessSettings` singleton or the starter `ApplianceType` rows
      that CI's throwaway database gets from `npm run db:seed`. Once the
      PR is merged, run `db:seed` against production (or apply the
      equivalent rows directly) so the live public site shows real
      pricing instead of its empty-state fallback text.
- [ ] **No real photos yet** — generic illustrations stand in, with a
      disclaimer. Swap in real photos once Chris supplies them (tracked
      in `docs/ROADMAP.md`).
- [ ] **Sales tax rate** still defaults to 0%, unconfirmed — shown
      honestly as "not yet finalized" on `/pricing`, per
      `docs/BUSINESS-RULES.md` ("never guess a tax rate").
- [ ] **Service area and business contact info** are still
      `[Placeholder]` values until Chris fills them in at
      `/desk/settings` — the public site handles this gracefully (shows
      "being finalized" copy) rather than showing broken placeholders.

## What is NOT finished or NOT verified — marked incomplete on purpose

1. ~~Sentry is wired but inactive.~~ **Done (2026-09-26).** Created a
   free Sentry project (`robinson-ai-systems/appliance-desk`), set
   `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` as real values in Vercel
   (Production/Preview/Development), and triggered a fresh production
   deploy so the running site actually picked them up (confirmed
   `READY`, aliased to `robinsonappliancerentals.com` and
   `appliance-desk.vercel.app`). Not yet linked to the GitHub repo
   (optional — Sentry couldn't auto-detect the repo via VCS
   integration; can be added later from Sentry's dashboard under
   Settings → Integrations if wanted, purely a nice-to-have for
   jumping from an error straight to the commit that caused it). No
   real errors have occurred yet to confirm one actually shows up in
   the Sentry dashboard — that's expected (nothing's broken), not a
   gap.
2. **Neon's `main` branch is not marked "protected"** — the account
   already hit its plan's cap on protected branches from a prior
   project. Not a security hole today, but should be revisited before
   real customer data goes in. See `docs/DECISIONS.md`.
3. **Real business content** (business name, phone, address, service
   area, hours) is still `[Placeholder]`/empty until Chris fills it in
   at `/desk/settings` — intentional, not a bug (see Phase 2 above).
4. **Everything after Phase 2** (lead management UI, lead → customer
   conversion, inventory, rentals, agreements, billing, customer portal)
   has not been started. `prisma/schema.prisma` models all of it so a
   future phase doesn't need a schema redesign, but no application code
   for any of it exists yet beyond what Phase 1/2 built.
5. **All Phase 1 work was pushed directly to `main`**, not through a PR
   — `AGENTS.md` says AI agents should never commit directly to `main`.
   This was practical while getting the very first commit and CI
   pipeline working at all (nothing existed to open a PR against yet).
   Phase 2 is the first phase to follow the branch/PR rule as written.
6. **Email notifications: wired up, but not yet confirmed arriving in
   a real inbox.** Chris connected his Resend account. A sending-only
   API key was created (`appliance-desk-production`) and set as a
   production environment variable in Vercel, along with
   `LEAD_NOTIFICATION_EMAIL=ops@robinsonaisystems.com` (a stand-in
   address — swap for Chris's real preferred inbox in Vercel's project
   settings whenever he wants). A fresh production deployment was
   triggered so the site actually picked up these values, and it's
   confirmed live: `appliance-desk.vercel.app` is aliased to deployment
   `dpl_GTzH8bd6SM2qUcRm1hqr3VUNZKnL`, which is `READY`. **What's still
   unverified:** no account on the Resend side has a verified sending
   domain yet, so mail currently goes out from the shared
   `onboarding@resend.dev` address — Resend's sandbox rules may restrict
   that address to only delivering to the Resend account's own login
   email until a custom domain (e.g. `robinsonaisystems.com`) is added
   and verified in Resend. **Next step: have Chris submit a real quote
   request on the live `/contact` page and confirm the notification
   email actually arrives.** If it doesn't, the fix is adding/verifying
   a domain in Resend, not more code changes.

## Launch checklist — things only Chris can do (repeated from the brief)

- Choose the public business name and buy the domain.
- Form the business entity and get any required local licenses.
- Confirm sales-tax treatment and rate with a CPA.
- Have a lawyer review the rental agreement, terms, and privacy policy
  (drafts of terms/privacy now exist from Phase 2 — see
  `docs/PRODUCT-SPEC.md` — but they still need real legal review before
  launch, not just before Phase 4's rental agreement).
- Get business liability insurance.
- Create and verify the live Stripe account, and explicitly approve
  switching to live payments (Phase 6).
- Set up Google Business Profile.
- Supply real business details (name, phone, address, service area,
  hours) in `/desk/settings` — done, per Chris's earlier update.
  Real appliance photos — done (see PR #4/immediate next step below).
- ~~Create a Resend account and add `RESEND_API_KEY`~~ — done. If lead
  emails don't show up when tested, verify a real sending domain
  (e.g. `robinsonaisystems.com`) in the Resend dashboard — the shared
  sandbox address Resend gives new accounts is limited in who it can
  send to.

## Phase 2.1 — appliance-type management, dollar fees, split delivery/install fee, real photos

Built after Chris tried `/desk/settings` for real and hit three gaps —
see `docs/DECISIONS.md`'s "Appliance-type management..." entry for the
full writeup. PR: https://github.com/christcr2012/appliance-desk/pull/4
(CI green — migration + new tests confirmed against a real throwaway
Postgres, not just locally, per the Prisma sandbox limitation above).

- [x] Owner/admin can add and retire appliance types from
      `/desk/settings` — no developer needed for a new category.
- [x] Fee inputs are dollars-and-cents, not raw cents.
- [x] Delivery and installation are separate one-time fees.
- [x] Real appliance photos (Chris-generated, basic/generic models) are
      wired in via a new `ApplianceType.photoUrl` field — also fixes a
      real bug where the icon shown was guessed from the type's slug.
- [x] **Merged to `main`** (commit `1bb84a6`) — CI green on `main`.
- [x] **Production database migration + photoUrl backfill applied**
      (2026-09-26, run by Chris directly in Neon's SQL editor — this
      tool's own attempt to run it was blocked by a production-write
      safety restriction, same as the DNS edit earlier in the project).
      Confirmed: `ApplianceType.isActive`/`photoUrl` and
      `BusinessSettings.oneTimeInstallationFeeCents` now exist in
      production, and the 3 starter rows have their `photoUrl` set.
- [x] **Live and verified (2026-09-26).** PR #4's first production
      deploy attempt failed (Vercel build tried to statically generate
      `/pricing` against the live database before the migration had
      been applied — `prisma:error ... column ... does not exist` for
      `BusinessSettings.oneTimeInstallationFeeCents`). Fixed by Chris
      running the migration SQL directly in Neon's console, then
      redeploying — build succeeded and the site is confirmed showing
      separate delivery/installation fee lines and real photos.
- [x] **Follow-up bug found and fixed same day, PR #6
      (`ai/claude/fix-pricing-photo-sizing2`).** The real photos are
      wide (1408x768), but the pricing-page and homepage card grids
      sized the `<img>` with `h-16 w-auto object-cover` — with no fixed
      width, `object-cover` had nothing to crop into, so each photo
      rendered as a thin, squished strip. Fixed by giving each photo a
      real fixed-size box (see `src/components/site/appliance-icon.tsx`'s
      `<ApplianceMedia>` — the `className`/`iconClassName` split lets
      each page size the real photo and the generic-icon fallback
      independently). Verified live on `robinsonappliancerentals.com`.

## Correction to an earlier (wrong) assumption in this doc

An earlier version of this doc assumed `prisma migrate deploy` runs
automatically against production as part of Vercel's build. **It does
not** — `package.json` has no `vercel-build` script, and `postinstall`
only runs `prisma generate` (client codegen), never `migrate deploy`.
Every schema migration in this project requires a manual, out-of-band
step (so far: Chris running the SQL directly in Neon's console). If a
truly automatic pipeline is wanted later, that's a real piece of work
(e.g. a GitHub Actions step that runs `migrate deploy` against
production on merge to `main`, with real safeguards) — not yet built,
tracked in `docs/ROADMAP.md`.

## Immediate next step (whoever picks this up next)

Phase 2.1 is fully done and verified live: migration applied, photos
backfilled, deployment confirmed `READY`, the photo-sizing bug found
and fixed, and Sentry error monitoring is live (see above). Nothing is
blocking here — the next step is whatever Chris wants to build next
(Phase 3). No instruction to start Phase 3 has been given yet; report
to him in plain English and wait for the go-ahead per `AGENTS.md`'s
phase-gate rule.
