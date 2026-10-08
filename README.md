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
npm run db:seed                    # one-time: creates the OWNER account (see prisma/see���q�^