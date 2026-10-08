# Architecture

One Next.js 16 (App Router) application. No monorepo, no microservices.

## Infrastructure

| Piece | Where | Notes |
|---|---|---|
| Source code | GitHub — `christcr2012/appliance-desk` (private) | `main` is production. All work happens on branches, merged via PR. |
| Hosting | Vercel — team **Robinson AI Systems**, project **appliance-desk** | `main` → production; PRs/branches → preview deployments. Custom domain **robinsonappliancerentals.com** is live and verified (DNS hosted on Vercel's own nameservers). |
| Database | Neon — project **Appliance Desk** (`jolly-term-08991992`), database `appliance_desk`, branch `main` | Region: **AWS US East 1 (N. Virginia)** — see `docs/DECISIONS.md` for why. |

## Environment variables

See `.env.example` for the full list with comments. The short version:

- `DATABASE_URL` — Neon's **pooled** connection string. Used by the app for all normal queries (works well with serverless functions, which open lots of short-lived connections).
- `DIRECT_URL` — Neon's **direct** (unpooled) connection string. Used only by Prisma Migrate, which needs a session-level connection.
- `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL` — auth session signing + base URL.
- `SENTRY_*` — error monitoring (see below).
- `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — Stripe test-mode API keys, live as of 2026-09-27 (see docs/DECISIONS.md). See "Payments (Stripe)" below.
- `STRIPE_WEBHOOK_SECRET` — **set (2026-09-27)**���q�^