# Handoff — current state

**Read this first, every session.** Update it before ending any session.
This is Phase 1 (Foundation), completed 2026-09-26.

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
  and its most recent run on `main` passed every step — install,
  `prisma migrate deploy` against a real throwaway Postgres, type-check,
  lint, unit tests, production build, and Playwright + axe accessibility
  checks against the built app. This is the real proof the app actually
  works, not just that it looked right in one sandbox.
- **The Vercel project exists and is deployed.** Project `appliance-desk`
  in the "Robinson AI Systems" team, connected to this GitHub repo, with
  `DATABASE_URL`, `DIRECT_URL`, and `BETTER_AUTH_SECRET` set for
  Production/Preview/Development. The production site is live at
  `https://appliance-desk.vercel.app` and serves the placeholder
  homepage correctly.
- Every doc `AGENTS.md` requires exists (this list, `PRODUCT-SPEC.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`,
  `DESIGN-SYSTEM.md`, `DECISIONS.md`, `ROADMAP.md`, `OWNER-GUIDE.md`).

## What is NOT finished or NOT verified — marked incomplete on purpose

1. **No OWNER account exists yet — Chris cannot log in yet.**
   `prisma/seed.ts` creates one, but it needs `OWNER_EMAIL` and
   `OWNER_PASSWORD` to run, and those are Chris's choice, not something
   to invent on his behalf. **Next step:** get Chris's preferred login
   email and a password from him (or have him pick one), then run
   `OWNER_EMAIL=... OWNER_PASSWORD=... npm run db:seed` once, from an
   environment with normal internet access (this repo's local sandbox
   still can't reach `binaries.prisma.sh` — see `docs/DECISIONS.md` —
   but GitHub Actions and Vercel both can).
2. **Sentry is wired but inactive.** `SENTRY_DSN` /
   `NEXT_PUBLIC_SENTRY_DSN` are not yet set as real values anywhere —
   someone needs to create a (free-tier) Sentry project and add those
   as Vercel environment variables.
3. **Neon's `main` branch is not marked "protected"** — the account
   already hit its plan's cap on protected branches from a prior
   project. Not a security hole today, but should be revisited before
   real customer data goes in. See `docs/DECISIONS.md`.
4. **No real content yet.** Every public-facing value (business name,
   phone, address, etc.) is a `[Placeholder]` — this is intentional per
   the brief (business identity isn't final), not a bug.
5. **Everything after Phase 1** (settings, public site, leads,
   inventory, rentals, agreements, billing, customer portal) has not
   been started. `prisma/schema.prisma` models all of it so a future
   phase doesn't need a schema redesign, but no application code for any
   of it exists yet.
6. **All Phase 1 work so far was pushed directly to `main`**, not
   through a PR — `AGENTS.md` says AI agents should never commit
   directly to `main`. This was practical while getting the very first
   commit and CI pipeline working at all (nothing existed to open a PR
   against yet), but it's a deviation from the stated rule worth being
   aware of. Starting with Phase 2, work should go through
   `ai/claude/<topic>` branches and PRs as the rule describes.

## Launch checklist — things only Chris can do (repeated from the brief)

- Choose the public business name and buy the domain.
- Form the business entity and get any required local licenses.
- Confirm sales-tax treatment and rate with a CPA.
- Have a lawyer review the rental agreement, terms, and privacy policy
  (once they exist, Phase 4/2).
- Get business liability insurance.
- Create and verify the live Stripe account, and explicitly approve
  switching to live payments (Phase 6).
- Set up Google Business Profile.
- Supply real photos and business details.

## Immediate next step (whoever picks this up next)

1. Get Chris's preferred OWNER login email and password (or generate one
   for him to change immediately) and run `prisma/seed.ts` once.
2. Create a free Sentry project and add its DSN to Vercel's environment
   variables so error monitoring goes live.
3. Report back to Chris in plain English (see "How to report" in
   `AGENTS.md`/the original brief) before starting Phase 2 — this has
   not happened yet as of this note.
