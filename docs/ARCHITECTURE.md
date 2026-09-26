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
- `npm run db:migrate:deploy` (`prisma migrate deploy`) applies pending migrations. This runs in CI against a throwaway Postgres, and should be run against production Neon as part of each deploy.

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
