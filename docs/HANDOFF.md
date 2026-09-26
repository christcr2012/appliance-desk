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
  5/5 passing locally).
- CI is configured (`.github/workflows/ci.yml`): on every PR and on
  `main`, it spins up a real throwaway Postgres, runs
  `prisma migrate deploy`, type-checks, lints, runs the unit tests,
  builds the app, then runs Playwright + axe accessibility checks
  against the built app.
- Every doc `AGENTS.md` requires exists (this list, `PRODUCT-SPEC.md`,
  `ARCHITECTURE.md`, `DATABASE.md`, `BUSINESS-RULES.md`,
  `DESIGN-SYSTEM.md`, `DECISIONS.md`, `ROADMAP.md`, `OWNER-GUIDE.md`).

## What is NOT finished or NOT verified — marked incomplete on purpose

1. **`npm run build` / `npm run typecheck` have not been fully verified
   in this repo yet.** The sandbox this was built in could not reach
   `binaries.prisma.sh` (Prisma's engine-binary host — confirmed genuine
   policy block, not a config problem), so `prisma generate` could never
   run there, which means `@prisma/client`'s generated types didn't
   exist locally. The *only* two `tsc` errors before that was fixed were
   (a) exactly that missing generated export, and (b) one wrong Sentry
   import path (already fixed). **First thing to do in a normal
   environment (or once GitHub Actions runs)**: confirm CI's build step
   goes green. If it doesn't, that's real work still to do — don't
   assume it's fine just because it looked fine here.
2. **No OWNER account exists yet.** `prisma/seed.ts` creates one but
   needs to actually run somewhere with working Prisma (see #1) — it
   could not be run in the build sandbox. **Next step:** with
   `OWNER_EMAIL` and `OWNER_PASSWORD` set as environment variables, run
   `npm run db:seed` once, from any environment with normal internet
   access (a real dev machine, GitHub Actions via a manual workflow
   dispatch, or a future AI session that isn't sandboxed the same way).
   Until this runs, **Chris cannot log in.**
3. **Sentry is wired but inactive.** `SENTRY_DSN` /
   `NEXT_PUBLIC_SENTRY_DSN` are not yet set as real values anywhere —
   someone needs to create a (free-tier) Sentry project and add those
   as Vercel environment variables.
4. **Vercel project has not been created yet.** GitHub repo and Neon
   database exist; connecting Vercel is the very next step (blocked only
   by needing to hand this off, not by any technical issue).
5. **Neon's `main` branch is not marked "protected"** — the account
   already hit its plan's cap on protected branches from a prior
   project. Not a security hole today, but should be revisited before
   real customer data goes in. See `docs/DECISIONS.md`.
6. **No real content yet.** Every public-facing value (business name,
   phone, address, etc.) is a `[Placeholder]` — this is intentional per
   the brief (business identity isn't final), not a bug.
7. **Everything after Phase 1** (settings, public site, leads,
   inventory, rentals, agreements, billing, customer portal) has not
   been started. `prisma/schema.prisma` models all of it so a future
   phase doesn't need a schema redesign, but no application code for any
   of it exists yet.

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

1. Get GitHub Actions CI to actually run and go green on this repo —
   this is the first real confirmation that `prisma generate`, the
   build, and the tests all work end-to-end.
2. Create the Vercel project (`appliance-desk`, team **Robinson AI
   Systems**), connect it to this repo, add the environment variables
   from `.env.example` (using the real `DATABASE_URL`/`DIRECT_URL` from
   the Neon project already created), and deploy.
3. Run `prisma/seed.ts` once to create Chris's OWNER account, then tell
   him his login email so he can set his own password.
4. Report back to Chris in plain English (see "How to report" in
   `AGENTS.md`/the original brief) before starting Phase 2.
