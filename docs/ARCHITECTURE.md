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
- `CRON_SECRET` — **set (2026-09-28)**, a random token set in Vercel and checked by every `/api/cron/*` route (billing reminders, job reminders, late fees, and the daily backup added 2026-09-29). Vercel signs every Cron-triggered request with this same value as a bearer token (`Authorization: Bearer <CRON_SECRET>`), so a request without it is refused — otherwise the URL would be triggerable by anyone who found it. See "Automation rules" below.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — **set (2026-09-28)**, Chris's real Twilio account credentials, used by `src/lib/sms.ts`. `TWILIO_PHONE_NUMBER` is **deliberately not set yet** — Chris can't buy a real Twilio number until his LLC's A2P 10DLC business-texting registration is done (a carrier requirement, not a bug here). Every SMS-sending code path is fully built and wired up regardless; `sendSms` no-ops safely without a phone number configured, so sending turns on with no code change the moment that one env var is added. See "SMS notifications" below.
- `RESEND_API_KEY` — **set**, a sending-only key created via the Resend MCP connector for the now-verified `robinsonappliancerentals.com` domain.
- `RESEND_FROM_EMAIL` / `LEAD_NOTIFICATION_EMAIL` / `MAINTENANCE_NOTIFICATION_EMAIL` — **set (2026-09-28, Task #69)**, real `robinsonappliancerentals.com` addresses. See "Email addresses (Google Workspace)" below.
- `BILLING_NOTIFICATION_EMAIL` — **set (2026-09-28, Task #72)**, `billing@robinsonappliancerentals.com` (an alias reserved since Task #69 but unused until now). Where the automated-late-fee digest email goes — see docs/BUSINESS-RULES.md's "Consolidated statements, manual payments, and automated late fees."
- Everything else (SignWell/Documenso/DocuSign) is added in later phases, only when that phase needs it.

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
| `leads@robinsonappliancerentals.com` | Alias → `ops@` | `LEAD_NOTIFICATION_EMAIL` (see `.env.example` / `src/domains/leads/index.ts`) — where a new website lead's notification email is sent. **Wired in as the live env var, 2026-09-28 (Task #69).** |
| `support@robinsonappliancerentals.com` | Alias → `ops@` | `MAINTENANCE_NOTIFICATION_EMAIL` (`src/domains/portal/index.ts`) — where a new maintenance-request notification is sent. **Wired in, 2026-09-28 (Task #69).** Not the same as `publicEmail` in `/desk/settings` (the address shown to customers on the public site) — Chris has that set to his own address today; he can switch it to `support@` from Settings any time he wants. |
| `no-reply@robinsonappliancerentals.com` | Alias → `ops@` | `RESEND_FROM_EMAIL` (`src/lib/email.ts`) — the "from" address on automated transactional email (password resets, account activation). **Wired in, 2026-09-28 (Task #69)** — replaces Resend's own `onboarding@resend.dev` placeholder sender now that this domain is verified in Resend. |
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
- **Rendering** (changed 2026-09-29, part of the mobile-performance
  pass): every place a saved photo URL is displayed now goes through
  `next/image`, not a plain `<img>` — see `next.config.ts`'s
  `images.remotePatterns` (allow-lists this store's own domain,
  `*.public.blob.vercel-storage.com`, since that's the only place a
  photoUrl in this app can ever come from). This is what actually
  resizes and compresses a multi-megabyte phone photo down to what the
  page needs and serves it as WebP/AVIF, instead of shipping the
  original file to every visitor — the direct cause of the poor mobile
  Speed Insights score investigated that date (docs/DECISIONS.md).

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
- **Estimate deposit at approval** (added 2026-09-29, see
  docs/BUSINESS-RULES.md) — a second, separate Checkout path from the
  one above: when a customer approves an estimate that has a deposit,
  `createDepositCheckoutSessionForEstimate` sends them to a Stripe
  Checkout page ("payment" mode) from their estimate link
  (`src/app/estimate/[id]/pay-deposit-button.tsx`). The webhook records
  it via `recordEstimateDepositPayment` — an `Invoice`/`Payment` with
  no `agreementId` (the agreement doesn't exist yet) and
  `Estimate.depositPaidAt` set. If that estimate is later converted to
  an agreement, the already-collected deposit carries over as a
  `Deposit` record instead of being charged a second time at signing
  (`createCheckoutSessionForAgreement` checks for one first).
- **All Checkout is server-side redirect** — every flow above uses
  Stripe's own hosted Checkout page (`checkout.sessions.create` →
  redirect to `session.url`), never Stripe.js/Elements embedded in our
  own pages. `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` is provisioned (see
  "Environment variables" above) but currently unused in `src/` for
  exactly that reason — nothing is broken by it being unused, it's
  just not needed unless a future embedded-payment-form flow is built.

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

**Since built (2026-09-28):** automated late fees are no longer
deferred — see "Automation rules" below. Dunning beyond Stripe's own
built-in retry logic is still not built.

## Automation rules (scheduled jobs)

**As of 2026-09-28**, later extended 2026-09-29. Checks that used to
depend on Chris noticing something on his own now run automatically —
see `docs/DECISIONS.md`'s 2026-09-28 "Automation rules" entry for the
full reasoning behind the pattern.

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
- **Automated late fees** (added 2026-09-28, Task #72) — a Vercel Cron
  job (`vercel.json`, once a day at 15:00 UTC, after billing reminders)
  hits `src/app/api/cron/late-fees/route.ts`, which calls
  `applyLateFees()` (`src/domains/billing/late-fees.ts`). Finds every
  invoice past its agreement's own grace period with no fee applied
  yet, adds the fee, and emails Chris a digest if anything was applied.
  Same `CRON_SECRET` protection as the other two cron routes. See
  docs/BUSINESS-RULES.md's "Consolidated statements, manual payments,
  and automated late fees" for what fee is used and why this never
  attempts a new charge itself.
- **Daily database backup** (added 2026-09-29, part of a proactive
  scaling/hardening pass) — a Vercel Cron job (`vercel.json`, once a
  day at 09:00 UTC) hits `src/app/api/cron/backup/route.ts`, which calls
  `exportDatabaseBackup()` (`src/domains/backup/index.ts`). Exports
  every business-critical table (customers, leads, agreements, billing,
  appliances, notes, audit history — everything except the
  authentication session tables and the Stripe webhook log, which are
  ephemeral/regenerable, not business records) to one JSON file and
  uploads it to the same Vercel Blob store the photos use, under a
  `backups/` prefix, with **private** access (unlike photos, this file
  is full customer PII/billing data and must never be publicly
  reachable by URL). Backups older than 30 days are deleted
  automatically on every run so storage cost doesn't grow forever. This
  exists on top of — not instead of — Neon's own built-in point-in-time
  recovery; Neon's free-tier plan only keeps a 6-hour recovery window,
  so this is the second, independent copy that reaches further back and
  isn't tied to Neon's own infrastructure. It's a data export, not a
  one-click restore: getting data back out means downloading the JSON
  from Vercel Blob and re-inserting it with a script, which is an
  acceptable trade for a small business's first line of defense (see
  docs/ROADMAP.md for a fuller disaster-recovery pass as a possible
  future project). A healthy day sends no email; if the export itself
  fails, Chris gets a plain-English alert explaining that today's extra
  safety copy didn't get made but his actual data is untouched. Same
  `CRON_SECRET` protection as the other cron routes.
- **Estimate follow-ups** (added 2026-09-29) — a Vercel Cron job
  (`vercel.json`, once a day at 16:00 UTC, after the other four) hits
  `src/app/api/cron/estimate-follow-ups/route.ts`, which calls
  `sendEstimateFollowUpReminders()` (`src/domains/estimates`). Emails
  a single "still interested?" nudge to any customer whose estimate
  was sent but has gone unanswered for a few days — see
  `docs/BUSINESS-RULES.md` for the exact quiet period. Same
  `CRON_SECRET` protection as the other cron routes.

## SMS notifications

**As of 2026-09-28** (Task #71). `src/lib/sms.ts` wraps Twilio, guarded
exactly like `src/lib/email.ts` wraps Resend: missing configuration
logs and returns `{ sent: false }` instead of crashing. Real, recorded
opt-in is required before texting anyone — `Customer.smsOptInAt`, set
from `/account/settings`, never assumed just because a phone number is
on file (docs/BUSINESS-RULES.md's privacy baseline). A `ConsentRecord`
(kind `sms_opt_in`) is written every time the preference changes,
opt-in or opt-out, as the audit trail.

The one thing this currently sends: a same-day "your visit is today"
text for a scheduled job (`sendJobDayOfReminders`,
`src/domains/jobs/day-of-reminders.ts`), driven by a second daily
Vercel Cron job (`/api/cron/job-reminders`, `vercel.json`, `CRON_SECRET`-
protected same as the billing-reminders cron). `Job.dayOfReminderSentAt`
stops a job from being texted twice in one day.

**Dormant until `TWILIO_PHONE_NUMBER` is set** — see "Environment
variables" above for why. Nothing else needs to change when it is;
sending just turns on.

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

[Better Auth](https://better-auth.com) (see `docs/DECISIONS.md` for why, over Auth.js/NextAuth and Neon Auth). Email + password for now; magic links/password reset can be added without a schema change. Four roles: `OWNER`, `ADMIN`, `STAFF`, `CUSTOMER` — enforced **on the server**, twice:

`STAFF` (added 2026-09-28) is a day-to-day operational login for a new hire — jobs, dispatch, customers, inventory, maintenance — with no access to revenue, billing, reports, or `/desk/settings`; those pages call `requireRole` for `OWNER`/`ADMIN` only. Chris creates and removes staff logins himself, from `/desk/settings`.

1. `src/proxy.ts` — fast, cookie-only check that *someone* is signed in, for `/desk/**` and `/account/**`.
2. `src/lib/session.ts` (`requireSession()` / `requireRole()`) — the real check, called at the top of every protected layout/page/server action. Confirms who is signed in and whether their role is allowed.

Never rely on hiding a nav link as the only protection for anything.

## Error monitoring

[Sentry](https://sentry.io) via `@sentry/nextjs`, wired in `instrumentation.ts` (server/edge) and `instrumentation-client.ts` (browser). Inactive until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set as Vercel environment variables — see `docs/HANDOFF.md` for the setup step.

## CI/CD

`.github/workflows/ci.yml` runs on every PR and on `main`, in order: install dependencies → check for un-reviewed destructive migrations → apply database migrations (against a throwaway Postgres) → verify schema health (the same check production runs before building) → seed business content and test-only OWNER/CUSTOMER accounts → type-check → lint → unit tests → build → install Playwright browsers → accessibility & e2e tests → upload the Playwright report. Vercel deploys previews for every PR and production on merge to `main` independently of this workflow.

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


## Prelaunch capture and automation (2026-09-29)

`/launch` → validated server action → `src/domains/launch` → dedicated
subscriber records. `/desk/launch` is OWNER/ADMIN-only for reads and actions.
`/api/cron/launch-emails` runs daily at 16:00 UTC, guarded by CRON_SECRET,
and uses the existing branded Resend helper. No new service or paid plan.
Both VERCEL_ENV=production and the exact canonical NEXT_PUBLIC_APP_URL
https://robinsonappliancerentals.com are required for this marketing sender.
RESEND_API_KEY and RESEND_FROM_EMAIL must exist. Activation/contact-footer
settings are editable in the desk, not extra environment variables.

`/launch/unsubscribe` is a standalone no-script/no-store/no-referrer route:
GET displays a confirmation without changing anything (link scanners); POST
suppresses, including RFC 8058 List-Unsubscribe one-click POSTs. No login or
additional personal information is required. Links do not expire.

At-most-once attempt policy: claim a subscriber atomically, create a unique
subscriber/step attempt, recheck pause/suppression, send, then advance the
cursor transactionally with the acceptance record. A crash or failure keeps
the claim blocked and visible for review. This intentionally favors avoiding
duplicate mail over automatic retries. Resend idempotency is an extra guard,
not the durable dedupe mechanism (its retention is 24h). The shared sendEmail
helper now checks returned provider errors/missing IDs, not only exceptions.

The standing shared-preview-database constraint above still applies. The
new additive migration must be verified on an isolated branch/CI before the
preview is created. Enabling general Neon/Vercel preview isolation is a
separate infrastructure task, not silently included in this feature.
