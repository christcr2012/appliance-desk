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
- `STRIPE_WEBHOOK_SECRET` — **set (2026-09-27)**, the test-mode webhook signing secret, registered in the Stripe dashboard and set in Vercel. See "Payments (Stripe)" below.
- `BLOB_READ_WRITE_TOKEN` — **set (2026-09-28)**, auto-injected by Vercel when the `appliance-desk-photos` Blob store was created and linked to this project. Used only server-side, by `src/app/api/uploads/photo/route.ts`, to mint short-lived upload tokens for every photo-upload button in the app — desk (Settings, jobs, appliance units) and the customer portal (maintenance requests) alike. See "Photo uploads (Vercel Blob)" below.
- `CRON_SECRET` — **set (2026-09-28)**, a random token set in Vercel and checked by `src/app/api/cron/billing-reminders/route.ts`. Vercel signs every Cron-triggered request with this same value as a bearer token (`Authorization: Bearer <CRON_SECRET>`), so a request without it is refused — otherwise the URL would be triggerable by anyone who found it. See "Automation rules" below.
- Everything else (Resend, SignWell/Documenso/DocuSign) is added in later phases, only when that phase needs it.

All of these are stored as **Vercel environment variables** (per environment: Production / Preview / Development). Nothing secret is ever committed. Local development uses `.env.local` (gitignored).

## Email addresses (Google Workspace)

**As of 2026-09-27**, `robinsonappliancerentals.com` has its own real,
separate Google Workspace mailbox — deliberately its own paid seat, not
an alias inside Chris's other company's (Robinson AI Systems) mailbox,
since these are separate business entities. Any future session doing
work that touches outgoing email, the "from"/"reply-to" address, or
where a notification should land should use this table rather than
guessing or inventing a new address:

| Address | Real inbox or alias? | What it's for in this app |
|---|---|---|
| `ops@robinsonappliancerentals.com` | **Primary mailbox** (the real inbox everything below lands in) | The account of record for this business's Workspace seat. Not meant to be shown to customers directly — use one of the role addresses below instead. |
| `chris@robinsonappliancerentals.com` | Alias → `ops@` | Chris's personal/direct address for this business, if a human needs to reach him by name specifically. |
| `leads@robinsonappliancerentals.com` | Alias → `ops@` | Intended for `LEAD_NOTIFICATION_EMAIL` (see `.env.example` / `src/domains/leads/index.ts`) — where a new website lead's notification email should be sent. **Not yet set as the live env var — still using the `publicEmail` fallback until Chris confirms he wants this wired in.** |
| `support@robinsonappliancerentals.com` | Alias → `ops@` | Intended for `MAINTENANCE_NOTIFICATION_EMAIL` (`src/domains/portal/index.ts`) and for `publicEmail` in `/desk/settings` — the address shown to customers on the public site (`/contact`, `/privacy`, `/terms`, `/accessibility`) and where they'd reply. **Not yet wired in — same reason as `leads@` above.** |
| `no-reply@robinsonappliancerentals.com` | Alias → `ops@` | Intended for `RESEND_FROM_EMAIL` (`src/lib/email.ts`) — the "from" address on automated transactional email (password resets, account activation). Currently still defaults to `onboarding@resend.dev`, Resend's own placeholder sender — this should move to a real `no-reply@` address once Chris confirms. |
| `billing@robinsonappliancerentals.com` | Alias → `ops@` | Reserved, not used by any code yet. For Phase 6B (Stripe billing) — invoices, payment-failure notices, and any billing-specific correspondence once that phase's actual Stripe integration is built. |

**Why aliases instead of separate mailboxes for each role:** Google
Workspace only bills per real mailbox (seat), not per alias, so one paid
seat (`ops@`) with role aliases on top gets every address above for the
cost of a single seat — the same pattern Chris already uses on
`robinsonaisystems.com`. Mail sent to any of these addresses lands in
the one `ops@robinsonappliancerentals.com` inbox; only the "To:" field
tells you which role it came in on.

**Receiving vs. sending are two different things.** Workspace (the
table above) handles *receiving* — a customer emailing `support@` or
replying to a notification actually reaches a real inbox now. The app's
own *outgoing* transactional email (lead notifications, password
resets, etc.) still goes through **Resend** (see `docs/DECISIONS.md`
and `.env.example`), which is a separate, already-verified sender for
this same domain. Wiring the env vars above to these new addresses only
changes what Resend puts in the "from"/"to" fields — it doesn't require
any Workspace-side sending setup.

## Photo uploads (Vercel Blob)

Added 2026-09-28, replacing "paste an image URL" fields with a real
"take a photo or choose one from your device" button, per Chris's
explicit request. Storage is a Vercel Blob store (`appliance-desk-photos`,
public access — a photo's URL is only guessable, never listed anywhere
public) created and linked to this project; Chris had already
pre-authorized Vercel Blob for future file uploads (see docs/DECISIONS.md,
2026-09-28 rental-lifecycle entry).

- `src/components/photo-upload-field.tsx` — the reusable
  `<input type="file" accept="image/*">` button (deliberately no
  `capture` attribute, so phones offer both "Take Photo" and "Choose
  from Library" from one native picker). Uploads go straight from the
  browser to Blob storage using `@vercel/blob/client`'s `upload()` —
  the file itself never passes through our own server. Moved out of
  `src/components/desk/` on 2026-09-28 once a customer-portal screen
  started using it too — it isn't desk-only anymore.
- `src/app/api/uploads/photo/route.ts` — the only server-side piece:
  mints a short-lived, one-time upload token for any signed-in user
  (broadened from OWNER/ADMIN-only on 2026-09-28 so customers can
  attach photos to a maintenance request). It still refuses anyone who
  isn't signed in at all — otherwise a stranger who found the upload
  URL could fill the Blob store with junk.
- Used in `/desk/settings` (each appliance type's stock photo), a
  job's page (condition photos), an individual appliance unit's page
  (`/desk/inventory/[id]`, added 2026-09-28), and the customer's "new
  maintenance request" form (`/account/maintenance/new`, added
  2026-09-28). All save the resulting URL through their own server
  actions — only *how* the URL is produced changed, not where it's
  stored in the database.

## Payments (Stripe)

Built in Phase 6B (docs/DECISIONS.md). Card/bank details never touch
our own servers — everything goes through Stripe's own hosted pages,
per docs/BUSINESS-RULES.md's billing rules.

- **Billing starts at delivery, not at signing** (Chris's explicit
  decision, 2026-09-28 — see docs/BUSINESS-RULES.md's Billing rules).
  Signing only collects the one-time deposit/damage waiver (if either
  applies) and saves a payment method for later; the real recurring
  Subscription is created once a delivery/installation job for the
  agreement is actually marked completed.
  - **Checkout** (`src/domains/billing/checkout.ts`,
    `createCheckoutSessionForAgreement`) — right after signing
    (`src/app/sign/[id]/actions.ts`), the customer is redirected to a
    Stripe-hosted Checkout page in **"payment" mode** (if there's a
    deposit/damage waiver to collect) or **"setup" mode** (if not) —
    never "subscription" mode anymore. Either way it saves a payment
    method on the Stripe Customer (`setup_future_usage`) for later
    off-session billing.
  - **Starting the subscription** (`startRecurringBillingForAgreement`)
    — called when a delivery/installation `Job` for the agreement is
    marked `COMPLETED` (`src/domains/jobs/index.ts`). Creates the real
    Stripe Subscription using the saved payment method; Stripe then
    handles anniversary billing from there (same day-of-month every
    month, no extra configuration). If there's no saved payment method
    yet, nothing is charged and `RentalAgreement.billingBlockedReason`
    is set instead of failing the delivery — surfaced to Chris (the
    exception inbox) rather than silently never getting billed.
- **Webhooks** (`src/domains/billing/webhooks.ts`, exposed at
  `src/app/api/webhooks/stripe/route.ts`) — the *only* place that marks
  anything paid in our own database. Nothing in `checkout.ts` writes an
  `Invoice`/`Payment` row; that only happens once Stripe itself confirms
  the money moved, via `checkout.session.completed`,
  `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `invoice.paid`,
  `invoice.payment_failed`, `charge.refunded`, and
  `customer.subscription.deleted`. Every event is deduplicated by
  Stripe's own event id (the `WebhookEvent` table) so a retried
  delivery is never double-counted.
  - **Action needed from Chris, next time he's in the Stripe
    dashboard**: two new event types were added to this list on
    2026-09-28 (`checkout.session.async_payment_succeeded` and
    `checkout.session.async_payment_failed` — they cover an ACH bank
    payment made at signing that takes a few days to clear or fails).
    The webhook endpoint registered in the dashboard needs those two
    events added to what it sends, the same way the original five were
    added when the endpoint was first set up (see "Done (2026-09-27)"
    below). Until that's done, everything still works correctly for
    card payments (which settle immediately); an ACH deposit/damage-
    waiver payment made at signing just won't be recorded as paid until
    this is updated — nothing is lost or double-charged in the
    meantime, it's simply not confirmed yet.
- **Billing Portal** (`src/domains/billing/index.ts`'s
  `createBillingPortalSession`) — lets a signed-in customer
  (`/account/billing`) manage their own card/ACH details and see past
  invoices, all on Stripe's own hosted page. Chris sees every
  customer's invoices desk-wide at `/desk/billing`.

**Done (2026-09-27):** Chris registered
`https://robinsonappliancerentals.com/api/webhooks/stripe` as a
webhook endpoint in the Stripe dashboard (test/sandbox mode, "Your
account" scope, the five events named above), and sent Claude the
signing secret Stripe gave back; it's now set in Vercel as
`STRIPE_WEBHOOK_SECRET` (all three environments), and a fresh
production deployment was triggered so the live site picks it up.
Before this, the webhook route deliberately returned HTTP 503
(refusing to accept unverified requests) rather than trusting an
unsigned request claiming to be Stripe — that's now resolved.

**Deliberately not built in this pass** (tracked in `docs/ROADMAP.md`):
automated late fees / dunning beyond what Stripe's own retry logic
already does — that needs its own design, not a bolt-on here.

## Automation rules (scheduled jobs)

**As of 2026-09-28.** Three checks that used to depend on Chris
noticing something on his own now run automatically — see
`docs/DECISIONS.md`'s 2026-09-28 "Automation rules" entry for the
full reasoning.

- **Billing reminders** — a Vercel Cron job (`vercel.json`, once a
  day at 14:00 UTC) hits `src/app/api/cron/billing-reminders/route.ts`,
  which calls `sendUpcomingBillingReminders()`
  (`src/domains/billing/reminders.ts`). It emails any customer whose
  next automatic charge (`RentalAgreement.nextBillingDate`, already
  kept current by the Stripe webhook — no separate Stripe API call
  needed) is 1–2 days out, and records
  `RentalAgreement.billingReminderSentForDate` so the same billing
  cycle is never reminded twice. Protected by `CRON_SECRET` (see
  "Environment variables" above).
- **Overdue rentals** and **appliances needing maintenance** — both
  surfaced as new categories in the existing "Needs your attention"
  exception inbox (`src/domains/exceptions/`, `/desk/today`) rather
  than a separate cron job, since that page is already checked by
  Chris and already re-queries fresh on every visit: a fixed-term
  agreement past its term end but still marked ACTIVE
  (`AGREEMENT_TERM_EXPIRED`), and a currently-rented appliance with
  no logged maintenance visit in 180+ days
  (`APPLIANCE_MAINTENANCE_DUE`).

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
