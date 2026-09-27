# Handoff — current state

**Read this first, every session.** Update it before ending any session.
Phase 1 (Foundation) completed 2026-09-26. Phase 2 (Public website,
settings, lead capture) built 2026-09-26. Phase 2.1 (appliance-type
management, dollar fees, split fees, real photos) built and verified
live 2026-09-26. Phase 3 (lead management, dashboard, activity log) —
first slice built 2026-09-26, see the "Phase 3" section below.

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
4. **Everything after Phase 3's first slice** (individual appliance-unit
   inventory management, rentals/agreements, billing, customer portal)
   has not been started. `prisma/schema.prisma` models all of it so a
   future phase doesn't need a schema redesign. Lead management, lead →
   customer conversion, and the dashboard/activity log are done — see
   "Phase 3" below.
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

## Correction to an earlier (wrong) assumption in this doc — since superseded

An earlier version of this doc assumed `prisma migrate deploy` runs
automatically against production as part of Vercel's build, then a
later update corrected that to say it does **not** (no `vercel-build`
script existed yet, so every migration needed Chris to run its SQL by
hand in Neon's console). **As of 2026-09-27, that manual step is gone
for ordinary migrations** — see the "Safe production database
migrations" section below (Phase 6A item 1) and `docs/ARCHITECTURE.md`
and `docs/DECISIONS.md` for the real, now-built pipeline. This section
is kept for history — every entry below it that mentions running
migration SQL by hand in Neon reflects how things worked *at the time*,
not how a future migration needs to be handled.

## Phase 3 — Lead management, dashboard, activity log (slice 1)

Chris asked to begin Phase 3 on 2026-09-26 (right after asking about
setting up a domain email address, which was deliberately deferred —
see `docs/ROADMAP.md`'s suggestions section — since nothing about it
blocks this phase). Full acceptance criteria in
`docs/PRODUCT-SPEC.md`'s new Phase 3 section. No schema migration
needed — `Lead`, `Customer`, `ServiceAddress`, and `AuditLog` already
existed in `prisma/schema.prisma`, so this is pure application code.

- [x] `/desk/leads` — browse/filter leads by status, see each one's
      full detail, score reasons, and appliance requests.
- [x] Move a lead between New/Contacted/Lost, or convert it straight
      into a `Customer` (+ `User` account) in one action.
- [x] `/desk/dashboard` — replaced the Phase 1 placeholder with real
      lead/customer/appliance counts.
- [x] `/desk/activity` — browse the last 50 `AuditLog` entries in
      plain English.
- [x] New tests (`tests/leads.test.ts`) for the lead-conversion guard;
      logic manually verified against a standalone script (same
      workaround as prior phases, since the sandbox still can't
      execute any test file that imports `@/lib/prisma` — real CI is
      the actual gate).
- [ ] **Not yet merged on purpose** — same rule as always.
- [ ] **Known limitation, real work for a future phase, not a bug**:
      converting a lead creates a real login-capable `User` account
      with a one-time random password shown once to Chris, but there's
      no self-serve "set your own password" invite/reset flow yet —
      Better Auth's `emailAndPassword` config has no
      `sendResetPassword` wired up. Fine for now since the customer
      portal itself doesn't exist yet (Phase 5), but this needs to be
      built before real customers are expected to log in themselves.
- [x] **Slice 2, done 2026-09-26**: full inventory management —
      `/desk/inventory` lets Chris add/edit individual physical
      `Appliance` units (asset numbers, serial numbers, condition,
      status transitions), plus what he asked for the same day:
      **color**, free-form **features** (front-load/top-load/agitator
      for a washer, or whatever applies to any other appliance type —
      a comma-separated tag list, not a fixed field per category), and
      a **parts catalog keyed by model number** (`/desk/parts` + a
      "Parts for this model" section on each unit's own page), so a
      part number logged once is reusable for every future unit of
      that same model. See `docs/PRODUCT-SPEC.md`'s new Phase 3 slice-2
      section for full detail, and `docs/BUSINESS-RULES.md`'s
      "Inventory & status rules".
      - **Needs a schema migration** —
        `prisma/migrations/20260926200000_appliance_features_color_parts`
        (adds `Appliance.color`, `Appliance.features`, and the new
        `PartRecord` table). **Chris needs to run this SQL in Neon's
        console before or immediately alongside deploying/merging** —
        see the "Correction to an earlier (wrong) assumption" section
        above: Vercel's build does **not** run `prisma migrate deploy`
        automatically, and skipping this step is exactly what broke
        PR #4's first production deploy.
      - New tests (`tests/inventory.test.ts`, already existed for the
        status/asset-number logic from slice 2's base) — manually
        verified against a standalone script, same workaround as every
        other phase (local test execution still can't import
        `@/lib/prisma`; real CI is the actual gate).
      - **Merged and confirmed live 2026-09-26** — Chris ran the
        migration SQL in Neon and merged; PR #9.
- [x] **Small follow-up, same day**: when logging a part, Chris can
      also list other model numbers the same part is known to fit
      (comma-separated) — each becomes its own row for that part, so it
      shows up for any of those models later too. No schema change
      needed (parts were already one row per model number). Also fixed
      a real mobile bug Chris reported: the homepage hero's two
      appliance photos had a fixed width that didn't shrink on narrow
      phone screens, so they got clipped off the right edge. A first
      attempt made the two photos responsive instead — **that didn't
      actually fix it** — so it was replaced (PR #11, merged) with the
      single washer/dryer/range/refrigerator photo Chris had made and
      supplied, which has no two-photo layout to clip in the first
      place.
- [x] **Phase 3 is complete** — merged and confirmed live 2026-09-26
      (PRs #9, #10, #11).

## Phase 4 — Rental agreements, e-signature, job scheduling

Started 2026-09-26 proactively, per Chris: "continue building... find
ways to optimize, improve, and even build upon the original plan as you
go." No schema migration needed — every model this uses
(`RentalAgreement`, `RentalLine`, `ApplianceAssignment`,
`SignatureRecord`, `Job`, `JobAppliance`, `Photo`) was already part of
the original Phase 1 schema/migration; this is pure application code.
Full detail in `docs/PRODUCT-SPEC.md`'s new Phase 4 section.

- [x] `/desk/customers` — browse converted customers, see their
      addresses/agreements/jobs.
- [x] `/desk/agreements` — draft an agreement, assign specific physical
      appliances to it (reserving them), send it for signature.
- [x] `/sign/[id]` — a public, unguessable, no-login signing page. The
      customer types their name, checks a box, and submits; recorded
      with a timestamp + IP address. **Deliberately an in-house
      typed-signature capture, not a paid e-signature provider** — see
      `docs/DECISIONS.md`'s new entry on why that's a cost decision left
      for Chris, not made unasked. Signing moves the agreement ACTIVE
      and its appliances RESERVED → RENTED.
- [x] Ending/cancelling an agreement frees its appliances back to
      AVAILABLE.
- [x] `/desk/jobs` — schedule delivery/install/swap/removal/maintenance
      visits, optionally tied to an agreement (pre-filling its
      appliances); move through scheduled → in progress → completed
      (with notes) or cancelled; attach condition photos by pasted URL
      (no file-upload/blob-storage decision made yet — see
      `docs/ROADMAP.md`).
- [x] Dashboard: added draft/awaiting-signature/active agreement counts
      and a scheduled-jobs count.
- [x] New tests (`tests/agreements.test.ts`, `tests/jobs.test.ts`) for
      both status-transition rules — manually verified against a
      standalone script, same workaround as every other phase (local
      test execution still can't import `@/lib/prisma`; real CI is the
      actual gate).
- [x] **Merged and confirmed live 2026-09-26** — PR #13, after fixing a
      real production-build bug it surfaced (see below).
- [x] **Real bug found via Chris's own build log, fixed same PR**: the
      agreement detail panel (a client component) imported `formatCents`
      from `@/domains/pricing`, whose module also does a top-level
      `import { prisma } from "@/lib/prisma"` — that pulled the whole
      Prisma/`pg` driver setup into the *browser* bundle and broke the
      Vercel build ("Module not found: Can't resolve 'util/types'").
      Fixed by splitting `dollarsToCents`/`formatCents` into a new
      `@/domains/pricing/money` module with zero database import
      (mirrors the existing `@/domains/leads/schema` split, which
      exists for exactly this reason) — **any future client component
      needing money formatting must import from `@/domains/pricing/money`,
      never `@/domains/pricing`.** This class of bug (a database-
      importing module quietly reachable from a "use client" file) is
      worth checking for early in any future phase that adds new client
      components: `grep -rl '"use client"' src/app src/components |
      xargs grep -n "^import.*@/domains\|^import.*@/lib/prisma"` should
      only ever match files importing a dedicated client-safe module.
- [x] Separately fixed (PR #12, merged): the mobile hamburger menu
      didn't close on an outside tap or on scroll — only Escape and
      route changes closed it.

## Phase 5 — Customer portal, slice 1 (rentals + maintenance requests)

Started 2026-09-26, continuing proactively right after Phase 4 merged
— Chris said to keep building/improving without checking in after every
slice. No schema migration needed — `MaintenanceRequest` was already
part of the Phase 1 schema. Full detail in `docs/PRODUCT-SPEC.md`'s new
Phase 5 section.

- [x] `/account` overview, `/account/rentals`, `/account/maintenance`
      (submit + track requests) — every query scoped strictly by the
      signed-in user's own id, never a client-supplied one (see
      `src/domains/portal/index.ts`'s doc comment and
      `docs/BUSINESS-RULES.md`'s customer-data-isolation rule).
- [x] `/desk/maintenance` — Chris's side: browse/filter, see the full
      request, move it through the documented status flow.
- [x] Dashboard: added an open-maintenance-requests count.
- [x] New tests (`tests/maintenance.test.ts`) for the status-transition
      rule — manually verified against a standalone script, same
      workaround as every other phase.
- [x] Opened as PR #14, `ai/claude/phase5-customer-portal` -> `main`.
      CI green (all checks: migrate-deploy, typecheck, lint, unit
      tests, build, Playwright/axe) and Vercel preview built
      successfully. Re-ran the client-bundle grep check before opening
      the PR — clean, only the two known-safe submodule imports.
- [x] **Merged and confirmed live** — PR #14 merged 2026-09-26.

## Phase 5 — slice 2 (maintenance-request email notification)

Built 2026-09-26, right after slice 1 merged — closes the "Chris has to
check the page himself" gap. `createMaintenanceRequestForUser` (in
`src/domains/portal/index.ts`) now emails
`MAINTENANCE_NOTIFICATION_EMAIL` (falling back to `/desk/settings`'s
public email, same pattern as new-lead emails from Phase 2) whenever a
customer submits a request — customer name/email, appliance, priority,
and the problem description, with HIGH/URGENT flagged in the subject
line. A failed send never blocks the submission — same guarded
`sendEmail()` wrapper used for leads, so it just logs instead of
sending when `RESEND_API_KEY` isn't set (true in CI/preview today).

- [x] **Merged and confirmed live** — PR #15 merged 2026-09-26.
- [ ] **Deliberately left for later** (see `docs/ROADMAP.md`): letting a
      customer attach a photo when they submit a request.

## Phase 5 — slice 3 (link a scheduled Job back to its MaintenanceRequest)

Built 2026-09-26, right after slice 2 merged. Closes the other gap
flagged when the customer portal shipped: "Schedule a job for this" on
a maintenance request used to open a blank `/desk/jobs/new` form.

- [x] `/desk/maintenance/[id]`'s "Schedule a job for this" now links to
      `/desk/jobs/new?maintenanceRequestId=...`, which pre-fills that
      customer, offers their service addresses to pick from, and
      pre-checks the specific appliance the request named (if any) —
      Chris can still add/remove appliances or change the address
      before saving.
- [x] The maintenance request's own page now lists any job(s) already
      scheduled for it; a job scheduled this way links back to the
      request it's for.
- [x] Deliberately does **not** auto-change the maintenance request's
      own status when a job is scheduled — see the note added to
      `docs/BUSINESS-RULES.md`'s maintenance status flow. The status
      machine doesn't allow jumping straight from `submitted` to
      `scheduled`, so auto-transitioning risked silently breaking that
      rule; Chris still moves the request through its own flow by hand.
- [x] Migration run by Chris in Neon; **merged and confirmed live** —
      PR #16 merged 2026-09-26.

**Phase 5 is now complete** (customer portal: rentals view, maintenance
requests with email notification and job-linking). Only intentionally
deferred item left: letting a customer attach a photo when they submit
a request (see `docs/ROADMAP.md`).

## 2026-09-26 (new session) — Chris's two explicit requests + two quick-win reliability fixes

Chris handed over a full work-order document taking over active
engineering responsibility, plus two things he asked for directly ahead
of everything else in it: (A) the post-login redirect was sending every
successful login to the public homepage instead of the right page for
that account type, and (B) prepaid-term rental discounts (his own words:
6 months paid in advance → $5/month off on a "set", 1 year paid in
advance → $10/month off on a set, half that for a single unit, and the
owner needs to be able to change those dollar amounts himself — the
numbers he gave aren't meant to be hard-coded). He also confirmed two
design questions when asked: the discount ties to the agreement's
**contract term** (not to how it's actually paid), and a "set" means
**2 or more appliances on the same rental line**; and he added a new
request in that same answer — a **free first month** as a separate,
also-owner-toggleable bonus when a 12-month term is paid in full,
in advance.

Alongside those two, this session also shipped two small, isolated
reliability fixes the work-order flagged as safe, high-value quick wins:
a data-leak in the customer portal, and a real double-booking race
condition in inventory reservations.

Shipped as three separate pull requests (kept small and independently
reviewable, per `AGENTS.md`), in dependency order:

- [x] **PR #18 — Fix post-login redirect** (`ai/claude/login-redirect`).
      **Merged to `main` 2026-09-26.** Owner/admin accounts now land on
      `/desk/dashboard`, customer accounts land on `/account`, and a
      safe `?next=` redirect (e.g. after being sent to log in from a
      specific page) is honored — but only if it points somewhere on
      this same site; anything else is ignored, so this can never be
      used to redirect someone to an outside/malicious site. 9 new
      automated tests.
- [x] **PR #19 — Two reliability fixes** (`ai/claude/phase6a-reliability-fixes`).
      **Merged to `main` 2026-09-26.**
      1. *Portal data leak*: a customer's "My Rentals" page and the
         appliance picker on maintenance requests were not filtering
         strictly to their **currently active** rental — appliances from
         an old, already-ended agreement could still show up. Fixed with
         one shared rule for "this customer's current rental equipment"
         used everywhere that matters, so the desk side and the customer
         side can never drift apart on this again.
      2. *Double-booking race condition*: when reserving a physical
         appliance for a new rental line, the code used to check "is
         this available?" and then separately mark it reserved — if two
         reservation requests happened at nearly the same instant, both
         could see it as available and both could "win," double-booking
         one physical washer/dryer to two different customers. Fixed so
         the reservation itself is the check — the database only lets
         one request win, and the other is safely rejected with a clear
         error instead of silently overbooking. New automated tests
         prove the guard logic; realistic concurrent-load testing needs
         a real database under load, which is future test
         infrastructure, not a gap in this fix (tracked in "not yet
         finished" below).
- [x] **PR #20 — Prepaid-term discount + free first month**
      (`ai/claude/prepay-term-discount`, branched on top of PR #19 since
      both touch the same file). **Open, CI green, ready for Chris to
      merge** — https://github.com/christcr2012/appliance-desk/pull/20.
      - New "Prepaid-term discounts" section on `/desk/settings` where
        Chris sets his own dollar amounts (not hard-coded): the 6-month
        discount for a set, the 6-month discount for a single unit, the
        12-month discount for a set, the 12-month discount for a single
        unit, and a checkbox for whether the 12-month free-first-month
        bonus is turned on. Every amount defaults to Chris's own
        stated numbers but can be changed any time.
      - The discount is decided once, when an appliance is added to a
        draft agreement (based on that agreement's contract length), and
        is then locked in for that agreement — exactly like every other
        price on a signed agreement, it never silently changes later if
        Chris later adjusts the discount settings.
      - The signing page and the customer's "My Rentals" page both show
        the math plainly: the regular price, the discount, and the
        final price — plus a clear "your first month is free" banner
        when that bonus applies.
      - 15 new tests for the discount math itself, plus tests confirming
        it's wired correctly into agreement/line creation.
      - **Needs a database migration before/alongside deploying** —
        `prisma/migrations/20260926230000_prepay_term_discount` (adds
        the 5 new settings fields and a few new fields on agreements/
        rental lines). **Chris needs to run this SQL in Neon's console**,
        same as every previous migration in this project (Vercel's build
        does not run migrations automatically — see the "Correction to
        an earlier assumption" section above). **Merge PR #20 only after
        (or together with) running that migration** — the code expects
        those columns to exist.

### Not yet finished / explicitly deferred (per the work-order's own "stop and report" rule)

Everything else in the work-order Chris handed over — the rest of
Phase 6A (a safe, automatic migration pipeline; letting a customer set
their own password via an email invite instead of a one-time password
shown to Chris; real concurrent-load test infrastructure; automatically
expiring an appliance reservation if an agreement is never signed; spam
protection on public forms), all of Phase 6B (real Stripe billing), and
Phase 7 (launch hardening) — is intentionally **not started**. The
work-order's own instructions say to stop and report after this slice,
not to keep building through the whole backlog unasked, so this session
stopped here.

PRs #18, #19, and #20 are all merged to `main` and confirmed live —
Chris ran the migration and merged #20 on 2026-09-26.

## 2026-09-26 (same session, continued) — Phase 6A item 2: customer account activation & password recovery

Per the work-order's suggested order, picked up the next item after
Chris's two explicit requests and the two quick-win fixes: replacing
the old "Chris sees a one-time password and has to relay it to the
customer" workflow, which was both a real risk (Chris ends up
knowing/handling customer passwords) and a real gap (no way for a
customer to recover their own account). No schema migration needed —
Better Auth's own `Verification` table (used for its token machinery)
has existed since Phase 1.

- [x] **Real "Forgot your password?" flow, working end to end.** New
      public pages `/forgot-password` and `/reset-password`, plus a
      "Forgot password?" link added to `/login`. `src/lib/auth.ts` now
      sends the reset email itself (via the existing Resend-backed
      `sendEmail` helper) whenever Better Auth generates a reset link —
      same guarded pattern as every other transactional email in this
      project (logs instead of sending when `RESEND_API_KEY` isn't set,
      never blocks or crashes).
- [x] **Customer accounts are activated the same way, not with a second
      system.** Converting a lead into a customer (`/desk/leads`) no
      longer generates or shows Chris a password at all — a brand-new
      account gets an unusable random password that's thrown away
      immediately, and the customer is emailed the exact same "set your
      password" link the forgot-password flow uses. See
      `docs/DECISIONS.md`'s new dated entry for why reusing Better
      Auth's built-in reset-password primitive was chosen over building
      a separate invite-token system.
- [x] **"Resend activation email"** button added to each customer's own
      page in the desk (`/desk/customers/[id]`), for when the first
      email didn't arrive or its one-hour link expired.
- [x] Fixed the specific stale/inaccurate claim Verified Finding #7
      flagged in `docs/OWNER-GUIDE.md` (it used to say a forgot-password
      link existed when it didn't) — and since that guide was otherwise
      still literally Phase-1 content despite everything since built
      and live, rewrote it as a real, current, plain-English walkthrough
      of how Chris actually runs the business today (leads → convert →
      agreement → signature → jobs → maintenance → settings/pricing),
      with an honest "what's not built yet" section (Stripe billing,
      photo uploads). `docs/BUSINESS-RULES.md`'s customer-conversion
      step was also corrected to match.
- [x] 6 new tests (`tests/leads-conversion.test.ts`) proving: a new
      account's password is random/discarded and never returned to the
      caller; the activation email call goes through Better Auth's real
      `requestPasswordReset` endpoint with the right arguments;
      reusing an existing account sends no email; a failed send never
      blocks the conversion itself; converting onto an existing
      staff (OWNER/ADMIN) email is still refused. 53/53 unit tests
      passing (up from 47 — the usual 7 pre-existing, documented
      Prisma-sandbox-limitation test-file failures are unchanged).
      Client-bundle-leak grep re-run — clean, only the two known-safe
      submodule imports.
- [x] **Merged and confirmed live 2026-09-26** — PR #21 (CI green,
      merged by Chris). No database migration needed for this one.
- [ ] **Deliberately not done in this slice** (real, separate pieces of
      work, not gaps in what shipped): a forgot-password-specific rate
      limit beyond the app-wide one already in place; turning on
      required email verification (still gated on confirming a verified
      sending domain in Resend, same open item as every other
      transactional email in this project); Phase 6A item 3 (real
      customer-isolation integration tests) and item 6 (reservation-
      expiration handling) and item 7 (public-form spam protection) —
      still next in the suggested order, not started.

## 2026-09-26 (same session, continued) — Phase 6A item 7: public form spam/abuse protection

- [x] Honeypot field on the public lead form (`/contact`) — invisible
      to real visitors, silently drops any automated submission with no
      Lead saved and no email sent.
- [x] Per-IP rate limit on lead submissions (5 per 10 minutes),
      `src/lib/rate-limit.ts` — zero new infrastructure/cost. Honestly
      documented as "best effort" (in-memory, per serverless instance,
      not a shared store) rather than oversold — see `docs/DECISIONS.md`
      for why that's the right call for now, and what the real next
      upgrade would be (Cloudflare Turnstile or a persistent store) if
      actual abuse is ever observed.
- [x] 8 new tests (`tests/rate-limit.test.ts`,
      `tests/contact-spam-protection.test.ts`): the limiter's own
      window/counting logic in isolation, plus submitLead's wiring
      (honeypot drops silently and never touches the limiter; a blocked
      IP never saves a Lead; a normal submission passes through both
      checks). 61/61 unit tests passing (up from 53 — the usual 7
      pre-existing, documented Prisma-sandbox-limitation test-file
      failures unchanged). Lint and client-bundle-leak grep clean.
- [x] **Merged and confirmed live 2026-09-26** — PR #23 (CI green,
      merged by Chris). No database migration needed for this one.

## 2026-09-27 (same session, continued) — Phase 6A item 6: reservation aging / abandoned draft agreements

Assigning a physical appliance to a DRAFT agreement reserves it
immediately (`AVAILABLE` → `RESERVED`) — before the customer has
actually signed anything. If that agreement is then abandoned, the
appliance stayed reserved and unavailable to any other customer
indefinitely, with nothing surfacing it to Chris. See
`docs/DECISIONS.md`'s new dated entry for the full design writeup,
including the explicit constraint this had to satisfy: never silently
cancel a legitimate in-progress agreement.

- [x] **Needs a schema migration** —
      `prisma/migrations/20260927010000_reservation_expiration` (adds
      `BusinessSettings.draftReservationHoldDays` — owner-adjustable,
      defaults to 7 — and `RentalAgreement.reservationExpiresAt`, with
      a backfill for existing draft/awaiting-signature agreements).
      **Chris needs to run this SQL in Neon's console before or
      alongside deploying/merging**, same as every previous migration.
- [x] New "Reserved-appliance holds" section in `/desk/settings` —
      Chris sets his own number of hold-days, plain business language.
- [x] A DRAFT/AWAITING_SIGNATURE agreement past its hold shows a
      "Stale hold" badge on `/desk/agreements`'s list, and a fuller
      warning banner with an "Extend reservation" button on the
      agreement's own page — alongside the existing Cancel button
      (which already frees the appliance back to `AVAILABLE`). Nothing
      is ever changed automatically; Chris always chooses.
- [x] Dashboard: added a "Stale reservation holds" count.
- [x] 18 new tests across 3 files (`tests/agreements.test.ts`'s new
      `isReservationStale` cases, `tests/agreements-extend-reservation
      .test.ts`, and a new case in `tests/agreements-prepay-discount
      .test.ts` proving `createDraftAgreement` sets the hold correctly).
      66/66 unit tests passing (up from 61 — the usual 7 pre-existing,
      documented Prisma-sandbox-limitation test-file failures
      unchanged). Lint and client-bundle-leak grep clean (the staleness
      check lives in its own zero-database-import submodule,
      `src/domains/agreements/reservation-status.ts`, for exactly the
      reason `docs/DECISIONS.md`'s entry explains).
- [x] **Merged and confirmed live 2026-09-27** — PR #24 (CI green,
      merged by Chris, migration run in Neon).

## 2026-09-27 (same session, continued) — Phase 6A item 3: real customer-data-isolation integration test

Every test in this project up to this point faked ("mocked") the
database, which works well for pure business-logic checks but can't
actually prove `docs/BUSINESS-RULES.md`'s "Customer data isolation
(security-critical)" rule — a faked database only ever returns what a
test tells it to, so it can't catch a real, unscoped query that would
leak one customer's data to another in production. See
`docs/DECISIONS.md`'s new dated entry for the full writeup.

- [x] New file `tests/customer-isolation.test.ts` — the first test in
      this project that runs against a **real** database instead of a
      fake one. It creates two complete, independent test customers
      (each with their own login, service address, active rental
      agreement, and appliance) and proves the customer portal
      (`src/domains/portal`) never lets one customer's login see or
      touch the other's rentals, service addresses, appliances, or
      maintenance requests — then deletes everything it created.
      No new CI setup was needed: `.github/workflows/ci.yml` already
      runs a real, disposable Postgres, applies migrations, and seeds
      it before the automated-tests step runs.
- [ ] **Important honesty note:** this specific file could not be run
      or double-checked in this working session — the sandbox it was
      written in has no way to talk to a real database at all (a known,
      already-documented limitation — see "A real constraint you should
      know about" in `AGENTS.md`). Everything that *could* be checked
      locally (the file's own correctness apart from the database
      itself, and the project's style rules) was checked and passed.
      The real proof is whether it passes on GitHub's automated checks
      (CI) once opened as a PR — that's the first real run of it.
- [x] **Merged and confirmed live 2026-09-27** — PR #25 (CI green,
      merged by Chris). No database migration needed for that one.

## 2026-09-27 (same session, continued) — Phase 6A item 1: safe production database migrations

This was the last item in Phase 6A, and closes the real gap this whole
phase was named after — see `docs/DECISIONS.md`'s new dated entry for
the full design writeup and `docs/ARCHITECTURE.md`'s "Production
migrations run automatically now" section for how it actually works
going forward.

- [x] `package.json`'s `vercel-build` script (a real Vercel feature —
      confirmed against Vercel's own documentation, not assumed) now
      runs a migration check, then applies pending migrations to the
      real database, then verifies the schema actually matches what the
      app expects, and only then builds the app. If any of that fails,
      the whole build fails — and Vercel never puts a failed build live,
      so the site keeps serving its last working version instead of
      breaking for real customers.
- [x] New files: `scripts/check-migrations.mjs` (blocks a migration that
      could destroy or corrupt real data — dropping something, wiping a
      table, forcing an existing column to required — unless it's
      explicitly recorded as reviewed) and
      `scripts/verify-schema-health.ts` (a plain-English check that the
      database actually matches the app's expectations, catching the
      exact kind of failure that broke a build earlier this session).
      Both also run in CI on every pull request, not just at deploy
      time.
- [x] Confirmed directly against the live Neon project: it already
      keeps 6 hours of point-in-time restore built in at no extra cost,
      which covers the "have a way back out" half of this — no new
      snapshot system was built on top of that.
- [x] **Already proven against the real, live database, before this
      even merged.** The first real attempt hit exactly the kind of
      thing this whole item exists to catch: 5 past migrations had
      already been applied by hand (Chris pasting SQL into Neon, the
      old process) but were never recorded in Prisma's own bookkeeping,
      so the very first automatic run correctly stopped itself rather
      than silently colliding with columns that already existed. Every
      column those 5 migrations were supposed to add was confirmed
      already present in the real database before touching anything —
      this was a one-time paperwork gap from the old process, never a
      data problem. Chris ran one short, one-time SQL statement to
      close that gap (see `docs/DECISIONS.md`'s dated entry for exactly
      what it did and why it's safe), and the database now correctly
      shows all 8 migrations as applied. This can't recur going
      forward, because the entire point of this change is that no one
      pastes migration SQL into Neon by hand anymore.
- [x] **Merged and confirmed live 2026-09-27** — PR #26.

**Phase 6A is now fully complete.**

## 2026-09-27 (same session, continued) — Phase 6B, step 1: billing policy decisions + billing data model redesign

Phase 6B (Stripe test-mode billing) is a real boundary — it needed
Chris's own decisions before any of it could be designed, not an AI's
guess. Four open questions were reviewed with him and confirmed (see
`docs/BUSINESS-RULES.md`'s "Billing rules" section for the plain-English
policy and `docs/DECISIONS.md`'s two new dated entries for the full
reasoning behind each):

- [x] **Anniversary billing** (each customer billed on the same day of
      the month they signed, not one fixed date for everyone).
- [x] **Deposits charged as real money up front**, not just
      authorized/held (a hold expires too soon for a multi-month
      rental).
- [x] **Both cards and ACH bank-transfer payments offered** from day
      one.
- [x] **Billing in advance** (charged at the start of the month being
      rented, not after).

With those confirmed, the billing data model itself was redesigned
before writing any actual Stripe code, per the work-order's own
suggested order (item 11 before item 12) — see
`docs/DECISIONS.md`'s "Phase 6B billing data model redesign" entry.

- [x] **Needs a schema migration** —
      `prisma/migrations/20260927020000_billing_data_model_redesign`.
      Confirmed first that nothing in the app reads or writes
      `Invoice`/`Payment`/`Deposit` yet, so every change is additive —
      new columns, new tables, three new `InvoiceStatus` values — with
      nothing renamed, nothing removed, and no backfill needed.
      **Chris needs to run this migration's SQL in Neon before or
      alongside merging**, same as always, OR — since production
      migrations now apply themselves automatically (Phase 6A item 1)
      — simply merging the PR is enough; no manual SQL step required
      unless he specifically wants to pre-apply it.
- [x] New models: `InvoiceLineItem` (immutable snapshot invoice lines),
      `Refund` (money refunded from an already-paid invoice),
      `CustomerCredit` (an account-level credit toward a future
      invoice), `WebhookEvent` (Stripe webhook idempotency). Extended
      `Invoice` (invoice numbers, billing-period dates, a real
      subtotal/discount/tax/late-fee breakdown, cancellation/write-off
      tracking), `Payment` (attempt tracking, ACH charge id), `Deposit`
      (who authorized a refund and why it was partial), `Customer`
      (Stripe customer id), and `RentalAgreement` (Stripe subscription
      id and the date that drives anniversary billing).
- [x] Ran `scripts/check-migrations.mjs` locally against this new
      migration — passes clean (every change is additive, nothing
      matches a destructive pattern).
- [ ] **Deliberately not built yet:** any actual Stripe SDK code,
      webhook handling, or billing UI — this is schema only, reviewable
      and mergeable with zero Stripe account needed. That's the next,
      separate piece of work.

## Immediate next step (whoever picks this up next)

Open the billing data model redesign above as its own PR, get CI green,
and report to Chris. Once merged, the real next step needs something
only Chris can provide: **a Stripe account with test-mode API keys**
(`STRIPE_SECRET_KEY` / a webhook signing secret, both already reserved
in `.env.example` but commented out and unset). Once those exist (added
as Vercel environment variables, never committed to the repo), the
actual Stripe integration — customer/subscription creation, invoice
generation on each `nextBillingDate`, webhook handling, and the
delinquency/collections view — can be built and genuinely tested
against Stripe's real test-mode sandbox, per the work-order's Phase 6B
section.

## 2026-09-27 (same session, continued) — small fix: browser tab title never updated with the real business name

Chris entered the real business name in `/desk/settings`, and the
website's visible content updated correctly, but the browser tab
title (and what shows up in a Google search result) kept showing the
placeholder text `[Company Name]`. Found while checking on an
unrelated DNS question.

- [x] **Root cause:** `src/app/layout.tsx` (the one shared layout every
      page renders through) had its title as a plain, static
      `export const metadata` object with the placeholder hard-coded in,
      never actually reading `BusinessSettings` — unlike the homepage's
      own visible text, which already pulls the real name correctly.
- [x] **Fix:** converted it to a `generateMetadata()` function that
      reads the real business name from the database, same as every
      other page's visible content already does. Every other page's own
      title (e.g. "Dashboard", "Agreements") still combines with this
      automatically through Next.js's own title template — nothing else
      needed to change.
- [x] No database change, no new tests needed (this is metadata
      composition, already covered by the existing accessibility/e2e
      suite which loads real pages). Lint and the client-bundle-leak
      check both clean.
- [x] Opened as PR #28 (`ai/claude/fix-page-title-metadata`). Waiting on
      CI + Chris's review/merge as of this writing.

## 2026-09-27 (same session, continued) — Google Workspace DNS change broke outgoing email (Resend)

Chris connected his domain to Google Workspace, and Workspace's own
setup wizard told him to remove all MX records and add its one MX
record. That's normal, expected Workspace instructions — it doesn't
know this domain also has a separate MX record (for the `send`
subdomain, not the main domain) that Resend needs to actually send
emails from the app. MX records only apply to the exact
subdomain/hostname they're added on, so Google Workspace's root MX
record and Resend's `send` subdomain MX record don't conflict with
each other and can both exist at the same time.

- [x] Checked directly with Resend (not guessing from old notes): the
      `send` subdomain's MX record, its SPF TXT record, and its CNAME
      record are all present and **verified** again. Whatever Chris
      re-added after the Workspace change, it was enough to fix those
      three.
- [x] **DKIM TXT record fixed.** Chris re-entered the full 218-character
      value in Vercel's DNS editor (selecting the whole field with
      Ctrl+A before pasting, instead of drag-selecting, which had been
      cutting it short). Confirmed directly via a live DNS lookup that
      the full, correct value is now published. Resend's own status
      moved from `failed` to `pending` right after — Resend re-checks on
      its own schedule, so it may take a little while longer to show
      fully `verified`, but nothing further needs to be done here; it
      should clear on its own.
- [x] No code or database change here — this was a DNS configuration
      issue in Vercel's dashboard, not a bug in the app.

## 2026-09-27 (same session, continued) — robinsonappliancerentals.com now has its own real email mailbox

Chris connected a Google Workspace account to this session (his
existing Workspace, also used for Robinson AI Systems). Since Robinson
Appliance Rentals is a separate business entity, we deliberately did
**not** alias its email into Robinson AI Systems' existing `ops@`
mailbox — instead this business got its own real, separate mailbox
(a new paid Workspace seat, which Chris explicitly approved knowing it
adds a recurring cost — he'll confirm the exact amount on his own
Workspace billing page, since this session can't see Workspace pricing).

- [x] Created `ops@robinsonappliancerentals.com` as a real mailbox
      (primary email), with `chris@robinsonappliancerentals.com` as an
      alias into it.
- [x] Added three more role aliases, chosen for what this specific app
      actually needs (not copied blindly from the Robinson AI Systems
      pattern) — see `docs/ARCHITECTURE.md`'s new "Email addresses
      (Google Workspace)" section for the full table and exactly which
      env var / code path each one maps to: `leads@`, `support@`,
      `no-reply@`, plus `billing@` reserved for the future Stripe work.
- [ ] **Not yet wired into the live app.** The addresses exist and can
      receive mail right now, but `LEAD_NOTIFICATION_EMAIL`,
      `MAINTENANCE_NOTIFICATION_EMAIL`, `RESEND_FROM_EMAIL`, and
      `/desk/settings`'s `publicEmail` are all still on their old
      values/placeholders. Deliberately left as a decision for Chris,
      not changed unasked — see `docs/ARCHITECTURE.md` for exactly what
      each one should become.

## 2026-09-27 (same session, continued) — Phase 6B: Stripe billing built end-to-end

With real Stripe test-mode keys in place (previous entry), built the
full billing engine: Checkout, webhooks, Billing Portal, and both the
desk-wide and customer-facing invoice views. Full detail in
`docs/ARCHITECTURE.md`'s "Payments (Stripe)" section and
`docs/DECISIONS.md`'s dated writeup (includes a note on a real Stripe
API shape change this had to account for).

- [x] Signing an agreement (`/sign/[id]`) now redirects to a real
      Stripe-hosted Checkout page, which sets up the monthly rent as a
      Stripe Subscription plus the security deposit / damage waiver as
      one-time charges on that same first invoice.
- [x] Webhook endpoint (`/api/webhooks/stripe`) verifies Stripe's
      signature and is the *only* place that writes `Invoice`/`Payment`/
      `Deposit` rows — never speculatively, only once Stripe confirms
      money actually moved. Deduplicated by Stripe's own event id.
- [x] `/account/billing` (customer) and `/desk/billing` (Chris) — both
      added, with nav links in both layouts.
- [x] "Manage billing" button opens Stripe's own hosted Billing Portal
      so a customer can update their card/ACH details themselves.
- [x] Real tests: `tests/billing.test.ts` (pure line-item math, no
      database or network) and `tests/billing-webhooks.test.ts` (real
      database-backed — same pattern as `tests/customer-isolation.test.ts`
      — covering the checkout-completed happy path, idempotent replay,
      an unrelated event, and a failed payment). Neither can run/verify
      *locally* in this sandbox — same documented Prisma-generation
      limitation as every other test in this project — only in CI's
      real Postgres.
- [x] Fixed a misleading inline comment on `RentalAgreement.taxRatePermille`
      in `prisma/schema.prisma` (it's tenths of a percent — 73 means
      7.3%, not 73% — the old comment implied ÷100, which would have
      been a 10x tax bug for a future session that trusted it. No
      migration needed, comment-only.)
- [ ] **One thing only Chris can do, once this PR is deployed:**
      register the webhook endpoint in Stripe's dashboard and copy its
      signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`. Exact steps
      are in `docs/ARCHITECTURE.md`. Until that's done, the webhook
      route intentionally returns an error rather than trusting an
      unverified request — so no payment will actually get recorded as
      paid until Chris does this one step.
- [ ] **Deliberately not built:** automated late fees / dunning beyond
      Stripe's own retry logic — tracked in `docs/ROADMAP.md`, needs its
      own design.
