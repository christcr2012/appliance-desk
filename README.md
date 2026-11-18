# Appliance Desk

The operating system for Robinson Appliance Rentals (Colorado): a public
website that brings in leads, an admin "desk" where the business runs,
and a customer portal. See `AGENTS.md` for the full ground rules and
`docs/STATUS.md` for exactly where the work stands, and `docs/START-HERE.md` for where everything lives.

## Stack

Next.js 16 (App Router, TypeScript, strict mode) · Tailwind CSS ·
Prisma + PostgreSQL (Neon) · Better Auth · Vitest (unit tests) ·
Playwright + axe (accessibility/e2e tests) · Sentry (error monitoring) ·
deployed on Vercel.

## Running locally

```bash
npm install                 # installs deps; postinstall runs `prisma generate`
cp .env.example .env.local  # then fill in real values — see comments in that file
npm run dev
```

Open http://localhost:3000.

## Useful commands

```bash
npm run typecheck        # generates Next.js route types, then tsc --noEmit
npm run lint              # eslint
npm test                   # unit tests (vitest)
# Real Postgres integration tests in Vercel Sandbox:
# bash scripts/local-postgres-test.sh tests/<spec>.test.ts
npm run test:e2e            # Playwright + axe accessibility tests (needs a running build)
npm run build                 # production build
npm run db:migrate:dev          # create + apply a migration locally
npm run db:migrate:deploy         # apply pending migrations (used by CI/production)
npm run db:seed                    # one-time: creates the OWNER account (see prisma/seed.ts)
```

## Deployment

Pushing to `main` does not deploy anything. Vercel deployments are
branch-gated (`vercel.json` → `git.deploymentEnabled`): only the `live`
and `testing` branches deploy, and the ignore step
(`scripts/vercel-ignore-build.mjs`) skips builds when nothing the site is
built from changed. CI (GitHub Actions) must pass before merging — see
`.github/workflows/ci.yml`. `ci` is the merge gate; pull requests do not
get Vercel preview deployments.

- **Testing:** the newest fully checked `main` is promoted to `testing`
  nightly (10 pm Denver) by `.github/workflows/testing-deploy.yml`, and
  the testing app deploys from that branch.
- **Production:** `live` is the production branch. Once a day (Denver
  midnight) `.github/workflows/daily-live.yml` fast-forwards `live` to
  `main` — only when `main`'s checks are green at that exact head — and
  Vercel deploys it. The owner can also run a checked release by hand.

Why: Vercel bills every build, so merges accumulate on `main` and ship in
one checked daily release instead of a build for every push (decided
2026-10-09 — see `docs/DECISIONS.md`, "Keep Vercel near $20/month").

## Documentation

Everything else — architecture, database design, business rules, design
system/accessibility rules, dated decisions, the roadmap, and current
project state — lives in `docs/`. Start with `AGENTS.md`.
