# Architecture

One Next.js 16 (App Router) application. No monorepo, no microservices.

## Infrastructure

| Piece | Where | Notes |
|---|---|---|
| Source code | GitHub — `christcr2012/appliance-desk` (private) | `main` is production. All work happens on branches, merged via PR. |
| Hosting | Vercel — team **Robinson AI Systems**, project **appliance-desk** | `main` → production; PRs/branches → preview deployments. No custom domain yet (using the generated `*.vercel.app` URL until Chris supplies one). |
| Database | Neon — project **Appliance Desk** (`jolly-term-08991992`), database `appliance_desk`, branch `main` | Region: **AWS US East 1 (N. Virginia)** — see `docs/DECISIONS.md` for why. |

## Environment variables

See `.env.example` for the full list with comments. The short version:

- `DATABASE_URL` — Neon's **pooled** connection string. Used by the app for all normal queries (works well with serverless functions, which open lots of short-lived connections).
- `DIRECT_URL` — Neon's **direct** (unpooled) connection string. Used only by Prisma Migrate, which needs a session-level connection.
- `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` — auth session signing + base URL.
- `SENTRY_*` — error monitoring (see below).
- Everything else (Resend, Stripe, SignWell/Documenso/DocuSign) is added in later phases, only when that phase needs it.

All of these are stored as **Vercel environment variables** (per environment: Production / Preview / Development). Nothing secret is ever committed. Local development uses `.env.local` (gitignored).

## Database access pattern (Prisma + Neon)

- `src/lib/prisma.ts` exports a single shared `PrismaClient`, reused across hot reloads/serverless invocations.
- Migrations live in `prisma/migrations/` and are the single source of truth for the schema — never hand-edit the database outside of a migration.
- `npm run db:migrate:deploy` (`prisma migrate deploy`) applies pending migrations. This runs in CI against a throwaway Postgres on every PR.

### Production migrations run automatically now (Phase 6A item 1)

**This changed as of 2026-09-27 — see `docs/DECISIONS.md`'s dated entry for the full design writeup.** Before this, the only way a migration reached the live Neon database was Chris manually pasting its SQL into Neon's console, and forgetting (or a race against Vercel's build) caused at least one real production failure. That manual step is gone for ordinary (additive) migrations.

`package.json`'s `vercel-build` script is a real, Vercel-documented override — when present, Vercel runs it instead of the plain `build` script, with no dashboard setting needed. It now does, in order:

1. **`npm run check:migrations`** — scans every migration for patterns that can destroy or corrupt real data (dropping a table/column, truncating, renaming, forcing an existing column to `NOT NULL`). A migration matching one of those patterns is blocked unless it's been explicitly recorded as reviewed in `prisma/migrations/DESTRUCTIVE-MIGRATIONS-REVIEWED.json` (a human sign-off, kept separate from the migration file itself so an already-applied migration.sql is never edited — editing one after the fact would break Prisma's own checksum check against what's already recorded as applied in production). This same check also runs as its own step in CI on every pull request, so a destructive migration gets flagged during review, not just at deploy time.
2. **`npm run db:migrate:deploy`** (`prisma migrate deploy`) — actually applies any pending migrations to the real Neon database, using `DIRECT_URL`.
3. **`npm run db:verify-schema-health`** — runs one real query against each major part of the schema and fails, with a plain-English message, if the database doesn't actually match what this version of the app expects (see the script's own comment for the exact prior incident this catches).
4. **`npm run build`** (`next build`) — only reached if all three steps above succeeded.

Because this is one script that stops at its first failure (`&&` between each step), **a failed migration or a failed health check makes the whole Vercel build fail** — and a failed build is never promoted to production, so the site keeps serving its last good deployment instead of going down. This directly satisfies "a deployment should never run application code against a schema it doesn't match" and "a failed migration must stop deployment safely rather than silently continuing" without adding any new hosting infrastructure.

**Auditability:** Prisma already records every applied migration's name and timestamp in the database's own `_prisma_migrations` table, and Vercel keeps the build log (showing exactly what `check:migrations`/`migrate deploy`/`verify-schema-health` printed) for every production deployment — both already exist, nothing new was added just to log this.

**Restore point:** the live Neon database already keeps a rolling 6-hour point-in-time-restore window as part of its current plan (confirmed directly against the Neon project, 2026-09-27) — Neon can restore to any moment in that window from its own dashboard/API without any extra setup. For anything riskier than a routine additive migration (i.e., whenever `check:migrations` flags something and Chris approves it), it's worth Chris or whoever's driving taking an explicit Neon branch snapshot right before merging, so the restore point isn't limited to that rolling 6 hours — see `docs/OWNER-GUIDE.md` if this needs a plain-English how-to.

**What Chris still needs to do by hand:** nothing, for a normal additive migration — merging the PR and Vercel's own deploy now does it all. He's only asked to do anything when a migration trips the destructive-change check, and even then the action is "confirm this is safe" and record it, not "figure out and paste raw SQL."

**Neon ↔ Vercel preview branching:** not yet enabled. It's the kind of thing worth turning on once the team is actively merging PRs that touch the schema, so preview deployments get their own isolated database branch instead of sharing production data. Tracked in `docs/ROADMAP.md`.

**Branch protection:** Neon's free plan caps the number of protected branches, and the account already has one from a prior project, so `main` is not marked "protected" in Neon yet. It's still safe: the database it backs isn't publicly reachable except through this app, and (once billing allows) protecting it is a one-click follow-up — see `docs/DECISIONS.md`.

## Auth

[Better Auth](https://better-auth.com) (see `docs/DECISIONS.md` for why, over Auth.js/NextAuth and Neon Auth). Email + password for now; magic links/password reset can be added without a schema change. Three roles: `OWNER`, `ADMIN`, `CUSTOMER` — enforced **on the server**, twice:

1. `src/proxy.ts` — fast, cookie-only check that *someone* is signed in, for `/desk/**` and `/account/**`.
2. `src/lib/session.ts` (`requireSession()` / `requireRole()`) — the real check, called at the top of every protected layout/page/server action. Confirms who is signed in and whether their role is allowed.

Never rely on hiding a nav link as the only protection for anything.

## Error monitoring

[Sentry](https://sentry.io) via `@sentry/nextjs`, wired in `instrumentation.ts` (server/edge) and `instrumentation-client.ts` (browser). Inactive until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set as Vercel environment variables — see `docs/HANDOFF.md` for the setup step.

## CI/CD

`.github/workflows/ci.yml` runs on every PR and on `main`: spins up a throwaway Postgres, applies migrations, type-checks, lints, runs unit tests, builds, then runs Playwright + axe accessibility tests against the built app. Vercel deploys previews for every PR and production on merge to `main` independently of this workflow.

## Folder layout

```
src/
  app/            — routes (App Router). (public) pages, /login, /account/**, /desk/**, /api/**
  domains/        — business logic by domain (pricing, leads, rentals, ...), not inside page components
  lib/            — cross-cutting: prisma client, auth config, session helpers
prisma/
  schema.prisma   — full data model (see docs/DATABASE.md)
  migrations/     — one folder per migration, applied in order
  seed.ts         — one-time OWNER account bootstrap (not sample data — see its header comment)
tests/            — unit tests (Vitest)
e2e/              — Playwright + axe accessibility tests
docs/             — this folder
```
