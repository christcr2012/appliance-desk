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
- `BLOB_READ_WRITE_TOKEN` — **set (2026-09-28)** for the original Blob store. It mints public catalog-photo upload tokens and stores the private database-backup/media-manifest objects under `backups/`. Operational/customer photo bytes and their F1 recovery copies use the separate private store below.
- `CRON_SECRET` — **set (2026-09-28)**, a random token set in Vercel and checked by every `/api/cron/*` route (billing reminders, job reminders, late fees, and the daily backup added 2026-09-29). Vercel signs every Cron-triggered request with this same value as a bearer token (`Authorization: Bearer <CRON_SECRET>`), so a request without it is refused — otherwise the URL would be triggerable by anyone who found it. See "Automation rules" below.
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` — **set (2026-09-28)**, Chris's real Twilio account credentials, used by `src/lib/sms.ts`. `TWILIO_PHONE_NUMBER` is **deliberately not set yet** — Chris can't buy a real Twilio number until his LLC's A2P 10DLC business-texting registration is done (a carrier requirement, not a bug here). Every SMS-sending code path is fully built and wired up regardless; `sendSms` no-ops safely without a phone number configured, so sending turns on with no code change the moment that one env var is added. See "SMS notifications" below.
- `RESEND_API_KEY` — **set**, a sending-only key created via the Resend MCP connector for the now-verified `robinsonappliancerentals.com` domain.
- `RESEND_FROM_EMAIL` / `LEAD_NOTIFICATION_EMAIL` / `MAINTENANCE_NOTIFICATION_EMAIL` — **set (2026-09-28, Task #69)**, real `robinsonappliancerentals.com` addresses. See "Email addresses (Google Workspace)" below.
- `BILLING_NOTIFICATION_EMAIL` — **set (2026-09-28, Task #72)**, `billing@robinsonappliancerentals.com` (an alias reserved since Task #69 but unused until now). Where the automated-late-fee digest email goes — see docs/BUSINESS-RULES.md's "Consolidated statements, manual payments, and automated late fees."
- `PRIVATE_PHOTO_BLOB_READ_WRITE_TOKEN` / `PRIVATE_PHOTO_BLOB_STORE_ID` — the **private** production store for operational/customer photo evidence. F1 also keeps content-addressed recovery copies and privacy-deletion tombstones there. `src/lib/photo-storage.ts` refuses a token whose embedded store id does not match the configured id, so a wrong pairing fails closed.
- `PREVIEW_PRIVATE_BLOB_READ_WRITE_TOKEN` / `PREVIEW_PRIVATE_BLOB_STORE_ID` — Preview-only private store (owner-approved 2026-10-01). Used only when `VERCEL_ENV=preview` and the id equals the reviewed constant in `src/domains/preview-storage/index.ts`; never falls back to production.
- `SENTRY_ORG` / `SENTRY_PROJECT` / `SENTRY_AUTH_TOKEN` — build-time only (source-map upload in `next.config.ts`); not needed at runtime.
- Set by Vercel automatically, never by hand: `VERCEL`, `VERCEL_ENV`, `NEXT_PUBLIC_VERCEL_ENV`, `VERCEL_URL` (fallback base URL for auth and privacy links when `BETTER_AUTH_URL` is unset). `NODE_ENV` and `NEXT_RUNTIME` are set by Next.js.
- Planned, not yet used by code: `COLORADO_GIS_API_KEY` (Batch T, `docs/designs/BATCH-T.md`).
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
  - **No Stripe call under a database lock (R08, 2026-10-04).** For each
    event, `processStripeWebhookEvent` first gathers every Stripe fact the
    handler needs (`src/domains/billing/webhook-evidence.ts`: invoice,
    payment intent, charge, setup intent, paid-invoice cash events) with no
    transaction open. Only then does a short local transaction take the one
    advisory lock, re-check the local rows, apply the event and insert the
    `WebhookEvent` marker together. Handlers read Stripe facts from the
    evidence object and never call Stripe themselves. The early checks that
    decide what to fetch only avoid pointless calls (for example a replayed
    event fetches nothing); they decide nothing. If the locked transaction
    needs a fact that was not fetched, it rolls back, the missing item is
    fetched outside any lock, and the transaction is replayed. Evidence is a
    snapshot, never authority. Test:
    `tests/remediation-r2-webhook-evidence-integration.test.ts` tries to take
    the same advisory lock from a second connection while each fake Stripe
    call is in flight.
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

### Pickup and delivery billing (owner decisions IN-24 / IN-26 / IN-27, 2026-10-03)

Three owner-changeable rules decide what a customer is charged when an
appliance comes back late, credited when an appliance is delivered late, and
whether the pickup day itself counts. Nothing is hard-coded: the settings live
in `BusinessSettings` (`lateReturnRateMode`, `lateReturnFixedDailyCents`,
`lateDeliveryProrationBasis`, `pickupDayNotBilled`; the column
`earlyReturnProrationBasis` is a deprecated leftover of a misread rule, copied
into `lateDeliveryProrationBasis` by migration `20261003280000` and never read),
are edited on `/desk/settings?section=pickups` ("Pickups and deliveries", owner
and admin, with every choice explained on the screen and a "Restore recommended
values" button), and are read by exactly one module.

| Piece | Where |
|---|---|
| The rules themselves (pure, no database): day counting, daily rates, labels | `src/domains/billing/pickup-billing.ts` |
| What a completed job does to billing (invoice, credit, waiting items, audit) | `src/domains/billing/pickup-billing-events.ts` |
| Where it is triggered | `updateJobStatus` in `src/domains/jobs/index.ts`, when a job is marked Completed |
| Items waiting for delivery | `PendingDelivery` table; shown on the original delivery job's page and on Today ("Item not delivered yet") |
| Settings parsing and form defaults | `src/domains/settings/pickup-billing.ts`, `src/app/desk/settings/pickup-billing-form.tsx` |
| Credit shown on the next bill | `src/domains/billing/applied-credit-lines.ts`, used by `recordPaidInvoice` in `webhooks.ts` |
| Tests | `tests/billing-pickup-billing.test.ts`, `tests/billing-pickup-billing-events.test.ts`, `tests/billing-late-delivery-credit-integration.test.ts` (real Postgres), `tests/settings-pickup-billing.test.ts` |

**Which day counts.** Every rule reads the job's *service date*
(`jobServiceDate`): the "date the work was done" staff enter when they mark
the job completed (defaults to that day; stored as `Job.performedOn`), else
the job's scheduled date, else the completion time. Never the moment the
status button was pressed. Dates are Colorado calendar dates
(`businessDateKey`), so a pickup at 11:30 pm is on that day, and
daylight-saving changes count as whole days.

How each rule works:

1. **Late return.** The agreement's `endDate` is its last paid-for day (fixed
   terms store it as the last second of that Colorado date; Stripe's
   `cancel_at` uses the same instant). When a REMOVAL job completes, each
   appliance it took away whose pickup date is after that end date is charged
   for every day from the day after the end date through the last chargeable
   day (rule 3) — **whatever the agreement's status says at that moment**: an
   agreement still marked ACTIVE with a pickup after its end date is a late
   return, not anything else. Daily rate: the item's monthly price ÷ 30
   (default) or the owner's fixed amount per day. The total is rounded once
   (`round(price × days ÷ 30)`), never per day. The charges become one
   ordinary `OPEN` invoice with one `LATE_RETURN` line per appliance, labeled
   `Late return – [item] – [N] days`, plus the agreement's own sales tax
   (`taxRateMilliPercent`, the same rate its rent carries) — the same way the
   early-ending fee is billed. Nothing is charged to a card automatically: the
   customer pays it like any other invoice, and the owner can see, adjust or
   write it off. For a company-caused late pickup, Batch B2's owner/admin waiver
   records the reason and matching negative rent adjustment without erasing the
   original late-return line. Audit: `billing.late_return_invoiced`.
2. **Late delivery.** When a DELIVERY/INSTALLATION job for an agreement is
   completed, staff can tick any agreement item that was **not** on the truck.
   Those appliances stay reserved for the customer and each gets a
   `PendingDelivery` row (`originalDeliveryDate` = that job's service date).
   Billing for the **whole agreement** starts from that visit exactly as
   before (`startRecurringBillingForAgreement` runs on every completed
   delivery and covers every rental line, so a partial delivery and a full
   one bill the same). Each waiting item is listed on Today ("Item not
   delivered yet", every role) and on the original job's page, so it is never
   forgotten. When a later delivery job that includes the item is completed,
   the row is closed (`deliveredOn`, `deliveredJobId`) and the customer gets a
   `CustomerCredit` (`sourceType = LATE_DELIVERY`, `sourceId` = the
   PendingDelivery id) for every day from the original delivery date through
   the day **before** it arrived: `round(itemMonthly × days ÷ basis)`, basis
   = 30 (default) or the real length of the anniversary billing period that
   contains the original date (28–31 days), rounded once, and never more than
   was billed for the item so far (its monthly share × the number of billing
   periods that have started). A "set" (two appliances on one rental line)
   splits its line price evenly per item. If the item never arrives, the
   owner or an admin presses "Never delivered — take it off the agreement and
   credit it" on the job page: the appliance is released (`unassignReason =
   "Never delivered"`, status back to AVAILABLE), `removedAt` is set, and the
   credit is one month's share for every billing period that has started
   since the original date (`Credit – [item] never delivered – [N] months
   billed`). After the transaction commits the credit is sent to Stripe as
   customer-balance credit (`BALANCE_CREDIT` provider operation, idempotency
   key `late-delivery-credit-<creditId>`, retried by the reconciliation pass
   like referral credits), so it comes off the customer's **next** monthly
   charge. When that next Stripe invoice is mirrored, the applied balance is
   shown as its own `CREDIT` line per credit — `Credit – [item] delivered late
   – [N] days` — oldest first, **only credits of this source type** (an old
   referral credit is never relabeled; migration `20261003280000` marks every
   pre-existing credit as fully shown), each credit's unshown part only
   (`CustomerCredit.shownCents` tracks what has been shown, so a credit Stripe
   used across two bills appears in two parts), with `shownOnInvoiceId` set
   once the whole amount has been shown and any unmatched remainder shown as
   "Account credit applied". Rentals paid in full in advance, and agreements
   whose billing never started, get no automatic credit (noted in the audit
   entry for the owner). Audits: `billing.item_not_delivered`,
   `billing.late_delivery_credit`, `billing.item_never_delivered`.
   - **Known gap, by design for now:** an item taken off the agreement as
     never delivered is still a line on the Stripe subscription. The audit
     entry says so; the owner adjusts the subscription in Stripe by hand.
     Chris's rule (2026-10-03): delivered-late and swapped-same-type items
     stay on the subscription; a permanently cancelled item must come off it
     from the next period. That is a Batch C work unit
     (`docs/prompts/DESIGN-BATCH-C-LITERAL-SPECS.md`, Part 2) and a
     `docs/ROADMAP.md` item.
3. **Pickup day not billed** (default on). The last chargeable day of any
   rental is the day before the pickup/return date, for normal end-of-
   agreement pickups and late returns alike. With the switch off, the pickup
   day is charged like any other day.

Every rule's outcome is written to the job's audit trail
(`job.pickup_billing`) in plain words, including why an appliance got no
charge or credit.

## Automation rules (scheduled jobs)

**At a glance (source of truth: `vercel.json`; all times UTC — Denver is UTC−6 in summer, UTC−7 in winter):**

| Time (UTC) | Route | What it does |
|---|---|---|
| 07:10 | `/api/cron/start-renewals` | Nightly rental pass, seven `runAutomation` rules in this order: automatic renewals, annual reminders, sending pending notices, billing extensions for delivered auto-renewals, due early terminations, closing fully returned agreements, starting due signed renewals (`start-renewals:*`; details in "Nightly rental pass" below) |
| 09:00 | `/api/cron/backup` | Daily consistent database backup plus paired private-media inventory/recovery copy |
| 13:00 | `/api/cron/job-reminders` | Next-day job reminders |
| 14:00 | `/api/cron/billing-reminders` | Billing reminder notices |
| 15:00 | `/api/cron/late-fees` | Automatic late fees after the grace period |
| 15:30 | `/api/cron/billing-reconcile` | Recovery sweep: finishes pending Stripe operations (`finishPendingProviderOperations`), runs job billing hand-offs (`runPendingHandoffs`), freezes final invoice documents (`freezeFinalInvoiceArtifacts`, 200 per run), reconciles unknown email/SMS outcomes (`reconcileUnknownDeliveries`, 50 per run). Each part is its own `runAutomation` rule key (`billing-reconcile:*`). |
| 16:00 | `/api/cron/estimate-follow-ups` | Estimate follow-up claims/sends |
| 16:00 | `/api/cron/launch-emails` | Prelaunch launch-list sequence (sending stays behind the owner's switches) |

Every route refuses to run without `CRON_SECRET` and records its outcome through `runAutomation` (Desk → Automations).

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
- **Starting signed renewals** (added 2026-10-03, IN-22) — a Vercel Cron job
  (`vercel.json`, once a day at 07:10 UTC, always after midnight in Denver) hits
  `src/app/api/cron/start-renewals/route.ts`, which runs the whole nightly rental pass in order:
  `runAutoRenewals()` (`auto-renew.ts`: queue month-to-month renewals for customers who agreed, cancel withdrawn ones), `sendPendingNotices()` (`src/domains/notices`: emails waiting reminders when live email is on), `runDueTerminations()` (`termination-execution.ts`: carry out agreed early endings, invoice the fee) and `startDueRenewals()`
  (`src/domains/agreements/renewal-start.ts`). Same `CRON_SECRET` protection.
  Safe to run twice; a renewal that cannot start is reported in the Today list.
- **Daily database + private-media recovery** — the 09:00 UTC cron first writes a format-2 database snapshot from one PostgreSQL `REPEATABLE READ` transaction. It records the migration/app commit, includes provider replay evidence such as `WebhookEvent`, and intentionally excludes reusable auth credentials. F1's restore command targets only an empty local database or API-verified Neon `restore-*` branch, restores in schema-derived dependency order, resets number sequences and runs schema health.

  After a successful database export, a separate durable `media-copy` automation inventories every private `Photo`. New/changed bytes are SHA-256 hashed and copied inside the dedicated private media store to content-addressed recovery paths; a paired `<database-backup>.media.json` manifest records exact source/recovery evidence. Unreferenced primary objects are reported but never automatically deleted. Privacy fulfillment writes deterministic tombstones before deleting bytes; verification and restore consult those live tombstones, including after a restore copy, so an older backup cannot resurrect intentionally deleted media. The cron also re-hashes a recovery sample on each successful run. No second storage provider is created by F1.
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

**Neon ↔ Vercel preview isolation:** previews already use the verified shared `vercel-preview-2` Neon branch rather than production, enforced by `src/lib/preview-database-safety.ts`. What is **not** enabled is one fresh Neon branch per individual preview deployment. That optional stronger isolation remains in `docs/ROADMAP.md`.

**Branch protection:** completed and verified on 2026-09-29 after the Neon plan upgrade; the production `main` branch is protected. See `docs/DECISIONS.md` / `docs/ROADMAP.md`. Per-preview-deployment branching is a separate optional hardening item.

## Auth

[Better Auth](https://better-auth.com) (see `docs/DECISIONS.md` for why, over Auth.js/NextAuth and Neon Auth). Email + password for now; magic links/password reset can be added without a schema change. Four roles: `OWNER`, `ADMIN`, `STAFF`, `CUSTOMER` — enforced **on the server**, twice:

`STAFF` (added 2026-09-28) is a day-to-day operational login for a new hire — jobs, dispatch, customers, inventory, maintenance — with no access to revenue, billing, reports, or `/desk/settings`; those pages call `requireRole` for `OWNER`/`ADMIN` only. Chris creates and removes staff logins himself, from `/desk/settings`.

1. `src/proxy.ts` — fast, cookie-only check that *someone* is signed in, for `/desk/**` and `/account/**`.
2. `src/lib/session.ts` (`requireSession()` / `requireRole()`) — the real check, called at the top of every protected layout/page/server action. Confirms who is signed in and whether their role is allowed.

Never rely on hiding a nav link as the only protection for anything.

## Error monitoring

[Sentry](https://sentry.io) via `@sentry/nextjs`, wired in `instrumentation.ts` (server/edge) and `instrumentation-client.ts` (browser). Inactive until `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` are set as Vercel environment variables — see `docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md` for the setup step.

## CI/CD

`.github/workflows/ci.yml` runs on every PR and on `main`. A tiny `classify` job first decides whether the change touches the application (anything outside `docs/` and `*.md`); documentation-only PRs skip the heavy suites. Application changes then run three independent jobs **in parallel**, each on its own runner:

- **static checks** — install → type-check → lint (no database).
- **migrations and unit/integration tests** — throwaway Postgres → check for un-reviewed destructive migrations → apply migrations → verify schema health (the same check production runs before building) → prove schema health rejects a missing column → prove a populated historical database upgrades → seed business content and test-only OWNER/CUSTOMER/STAFF accounts → unit and real-Postgres integration tests.
- **production build and browser acceptance** — sharded across 3 runners. Each shard gets its own throwaway Postgres, applies migrations, verifies schema health, seeds, runs the production build, installs the Playwright browser, then runs the Playwright/axe accessibility, security and end-to-end spec files assigned to it. The assignment lives in `e2e/shards.json` (named groups → spec files) and is run by `scripts/e2e-shard.mjs <group>`. Playwright's own `--shard` was tried first and rejected: it balances by test *count*, and this suite's test durations are so uneven that one runner got ~4x the runtime of the others. The groups are balanced by measured duration instead; after each shard runs, the script prints a per-file duration notice (from Playwright's JSON reporter, CI-only) that is readable from the Checks API — use those numbers to rebalance. The script refuses to run, and the static-checks job fails (`--check`), if any `e2e/*.spec.ts` is unassigned, double-assigned, or missing, so a new spec file can never silently stop running. Every spec still runs exactly once per CI run. Each shard uploads its own Playwright report (`playwright-report-<group>`).

A final `ci` job (the historical required-check name) succeeds only if every job above succeeded — for the browser shards, GitHub reports the matrix as a whole, so one failing shard fails the gate. Vercel deploys previews for every PR and production on merge to `main` independently of this workflow.

## CI layout and speed

**Priority (owner, 2026-10-03): fastest possible CI at equal or better quality.** The repository is public, so standard-runner Actions minutes are free; this replaces the same-day cost-saving design (one browser runner, CI only when a PR opens). The short version is in `AGENTS.md` ("CI"). Nothing was dropped: the same checks and tests run, spread over more machines, plus a new secret scan.

### What a run is made of (all jobs run side by side)

| Job | What it does | Expected |
|---|---|---|
| classify | decides docs-only vs code (checkout only, no install) | ~6s |
| secret scan | `scripts/check-secrets.mjs` + gitleaks (pinned, checksum-verified) over the full git history; always runs | ~10s |
| type-check, lint and repo checks | dependencies (cached), then typecheck and lint at the same time, browser-group check, migration check | ~1–1.3 min |
| unit tests ×3 | each shard: own Postgres, migrate, seed, `vitest --shard=N/3`; shard 1 also runs schema-health and migration-upgrade drills | ~1.3–1.8 min |
| browser tests ×4 | each shard: own Postgres, migrate, seed, production build (cached), its spec group from `e2e/shards.json` | ~2–2.5 min |
| ci (gate) | passes only if everything required passed | ~3s |

Wall-clock for a full run is the slowest browser shard: about a minute of fixed setup (container, dependencies, build,
browser) plus 1–1.5 minutes of tests. Measured 2026-10-06 on PR #266: **2 min 31 s** with warm caches (the same kind of run took
4 min 4 s before) and 3 min 10 s on a cold dependency cache; the four browser shards finished within 2 s of each other
(123–125 s). Before the change, runs took 3.5–6.3 min (the 6.3 min run was one 3.5-minute apt download).

**How the speed is kept (PR #266, 2026-10-06):**

- **Pinned runner image `ubuntu-24.04`.** `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19; moving is a deliberate
  PR (check Playwright's library check and Postgres service), never a surprise.
- **Cached `node_modules`** through `.github/actions/setup-deps` (used by every job that needs dependencies). The key
  is the exact `package-lock.json` + `prisma/schema.prisma` + `prisma.config.ts`; a hit skips `npm ci` (the folder
  already holds the generated Prisma client), a miss does a clean `npm ci`. There is no partial restore, so a changed
  lockfile or schema can never reuse stale packages.
- **No apt on a normal run.** The browser is restored from cache first; `ldd` lists any shared library the browser
  binaries cannot find. None → apt is skipped. Anything missing → `npx playwright install-deps chromium` runs
  detached in the background during migrations, seed and build; a later step waits for it and fails the job if it
  failed. (apt used to cost 11–26 s per shard and once 3 min 27 s.)
- **Read-only scans use both Playwright workers.** The generated accessibility route specs and the owner/portal
  read-only section scans declare `test.describe.configure({ mode: "parallel" })`. Only tests that never change data may
  be in a parallel group; tests that save and restore settings stay in normal file order.
- **Groups balanced by measured test-seconds** printed by `scripts/e2e-shard.mjs` (notice per shard).
- **Runs on `main` are never cancelled** (`cancel-in-progress` only for pull requests), so every merged commit has a
  complete result; a newer push to a PR still cancels that PR's stale run.
- **Action versions on Node 24:** checkout v5, setup-node v6, cache v5, upload-artifact v6.
- **CI runs the same Node as production (24).** Vercel's project setting is Node 24.x, so `setup-deps` and the
  `perf` workflow use Node 24 too (until 2026-10-06 CI tested on 22 while production ran 24). If Vercel's Node version
  changes, change `.github/actions/setup-deps/action.yml` (version and cache key) in the same PR.
- **No silent skips.** Real-database tests skip themselves outside a throwaway CI database, and several browser specs
  skip when a CI fixture is missing. In CI both would be green no-ops, so `scripts/check-no-skipped-tests.mjs` (unit
  shards, from vitest's JSON report) and `scripts/e2e-shard.mjs` (browser shards, from Playwright's JSON report) fail
  the run if any test was skipped. The only allowed skip is `tests/perf/batch-e-large-lists.test.ts`, which runs in
  `perf.yml`.

### When CI runs

- **Pull request:** on every push (new pushes cancel the older run). Pull requests from forks need approval for workflows (see below).
- **Push to `main`:** everything.
- **Nightly (03:17 Denver in summer):** everything on `main`.
- **By hand:** Actions → CI → Run workflow, or `gh workflow run ci.yml --ref <branch> -f base=<base branch>`.
- **Docs-only changes** (every file under `docs/` or `*.md`) skip type-check, unit and browser jobs; the secret scan and the gate still run.

### Secret and private-identifier scanning

- `scripts/check-secrets.mjs` (tests: `tests/check-secrets.test.ts`) flags live/real-length Stripe keys, webhook secrets, GitHub/AWS/Google/Slack/Resend/Twilio/Anthropic/OpenAI/Vercel tokens, private keys, database URLs with embedded passwords to non-local hosts, Neon/Vercel production identifiers, and committed `.env` files. It prints only a label, file, line, and the first 6 characters.
- Intentional exceptions (the verified preview endpoint in `src/lib/preview-database-safety.ts`, obviously fake test values) are listed inside the script; fake-looking test strings reviewed once are in `.gitleaksignore`. Adding to either needs a stated reason in the PR.
- gitleaks (`.gitleaks.toml`, default rules) scans every commit, because a secret removed in a later commit is still public.
- **Owner-only settings GitHub requires a person to set** (agents cannot): Settings → Code security → enable *Secret scanning* and *Push protection* (free for public repos); Settings → Actions → General → *Fork pull request workflows* → require approval for all outside contributors.

### Keeping CI fast — checklist (target: a full run in about 3 minutes; investigate at 5)

1. **Measure before changing anything.** `gh api repos/<owner>/<repo>/actions/runs?per_page=10` gives start and finish times; per-job times are in the run's jobs list; browser shards print per-spec durations.
2. **Never make jobs wait for each other.** The wall-clock of a run is its slowest job. New checks join the `static` or `secrets` job, or become a new parallel job; they never chain after the browser shards.
3. **Keep the slowest job the browser shard, and keep shards even.** Rebalance `e2e/shards.json` from the printed durations whenever one group is clearly longest; add a group (one entry in `shards.json` plus one in the workflow matrix) rather than letting a shard pass about 2 minutes of test time.
4. **Tests go to the cheapest layer.** Business rules, money, permissions and concurrency belong in vitest against real Postgres; a browser spec is for axe, real sessions, headers and one click-through per major flow.
5. **Protect the caches.** Do not change `package-lock.json`, `prisma/schema.prisma` or the node_modules/Next/Playwright cache keys casually; a cold dependency cache adds about 15 s to every job and a cold Next cache about a minute to every shard.
6. **Add vitest shards before it hurts.** When a unit shard nears 2 minutes, raise the matrix size and the `--shard=N/M` denominator together.
7. **Parallel groups are for read-only tests only.** Before adding `mode: "parallel"` to a describe, check that no test in it saves, deletes or changes data another test reads.
8. **No sleeps, no per-test logins, no network calls to real providers** in tests; they are the usual cause of slow or flaky suites.
9. **Keep the gate honest.** Any new required job is added to the `ci` job's check list, and a job that is skipped for docs-only changes must still be reported as skipped, never missing.
10. **Update this file** when the layout changes (job list, shard count, expected times).

### Rules when adding tests

1. **Default to unit tests.** `tests/` (vitest, real Postgres) is split over three runners; browser tests carry the heavy fixed cost.
2. **Assign every new spec file** in `e2e/shards.json` (the `static` job runs `scripts/e2e-shard.mjs --check`). Rebalance groups from real durations (printed as notices after each browser run) when one shard becomes the slowest.
3. **Reuse saved sessions.** `e2e/global-setup.ts` logs in once per role; tests use `test.use({ storageState })`.
4. **Build cache and Playwright cache** are restored per run; keep `package-lock.json` changes deliberate because they invalidate both.
5. **Artifacts** (the Playwright report) are uploaded only when a shard fails, kept 3 days.
6. **Tests that write the one business-settings row** (policy, tax rate) go in `SHARED_SETTINGS_TESTS` in `vitest.config.mts`, which runs them one at a time. They share a single database row, and which runner a file lands on changes whenever tests are added, so without this they randomly overwrite each other (seen on #153, 2026-10-03).

### Vercel builds (previews and production)

Measured 2026-10-06 (production build of PR #266's merge): about **48 s from clone to live** — install 5 s (Vercel's
own cache), migration check + `prisma migrate deploy` + schema health 4 s, `next build` 19 s (compile 4 s, TypeScript
8 s, 88 static pages 1 s), upload 8 s. After the site is live Vercel spends another ~40 s saving its ~1 GB build cache;
that does not delay the deployment. The build machine is Vercel's standard 4-core one; there is nothing paid to turn on.

- **Docs-only pushes are not built.** `vercel.json` → `ignoreCommand` runs `scripts/vercel-ignore-build.sh`, which
  skips the build only when every file changed since the branch's last successful deployment
  (`VERCEL_GIT_PREVIOUS_SHA`) is Markdown or under `docs/` — the same rule as CI's `classify` job. No earlier
  deployment, a base commit outside Vercel's shallow clone, an empty diff or any git error → it builds.
- **TypeScript runs inside `next build` as well as in CI.** Kept on purpose: Vercel can finish a deployment before CI,
  and the 8 s check stops a broken build from ever being promoted.
- **Known build-log messages:** "Update available 7.10.0 -> 8.0.0-rc" is Prisma advertising a pre-release (ignore
  until 8 is stable and Batch G or later plans the upgrade); "Experiments: clientTraceMetadata" is Sentry's tracing
  option (expected). The npm "install-scripts not yet covered by allowScripts" warning is fixed by `allowScripts` in
  `package.json` (below).

**Install scripts (`allowScripts`, npm 11+).** npm 12 (already npm's `latest`) blocks dependency install scripts that
are not listed in `package.json` → `allowScripts`. Four are approved by name: `@prisma/engines` (downloads the
migration engine `prisma migrate deploy` needs during every Vercel build), `prisma` (Node version check), `esbuild`
and `unrs-resolver` (fetch their platform binary if the optional package is missing). Name-only entries keep routine
upgrades working; a new dependency with an install script shows up as an npm warning and must be reviewed with
`npm install-scripts ls` before approving. The project's own `postinstall` (`prisma generate`) is not affected.

### If a job gets slow

- A browser shard is the slowest job: move a spec to the lightest group (`e2e/shards.json`) or add a fifth group; each new shard repeats about two minutes of setup in parallel, which costs nothing in a public repo.
- A single spec over ~60s: split it or move assertions into unit tests.
- Unit tests: raise the shard count in the `unit` matrix and the `--shard=N/M` denominator together.

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


## O02A — Non-production provider safety (2026-09-30; review branch)

src/lib/deployment-safety.ts treats VERCEL_ENV=production as production, other
VERCEL_ENV values as non-production, and VERCEL=1 without VERCEL_ENV as
non-production. Without Vercel markers, local/CI behavior stays unchanged.
This is a server deployment setting, never a client-supplied switch.

sendEmail/sendSms suppress all deliveries in those non-production deployments
even with provider credentials; sent:false is returned. getStripeClient requires
sk_test_ or rk_test_ keys before cache access; webhook processing also refuses
signed live events. Photo token minting and backup export/pruning are disabled
there because independent Blob storage has not been verified. Production
provider behavior is preserved and covered by mocked-provider regressions.

No credentials, tables, paid services or activation added. This does not verify
DATABASE_URL/DIRECT_URL target identities. The separate Neon preview branch is
recorded in `docs/archive/HANDOFF-2026-09-26-to-2026-10-02.md`; the O02 isolation proof later landed in `docs/plans/overhaul/PREVIEW-ISOLATION-PROOF.md` (#134).
Historical shared-preview-DB statements above refer to earlier sessions.

### Nightly rental pass, order (Batch B2, 2026-10-05)

`src/app/api/cron/start-renewals/route.ts` runs, in this order: auto-renewals, `queueAnnualReminders`, `sendPendingNotices`,
`runDueTerminations` (agreed endings: fee invoice, then close), `closeFullyReturnedAgreements` (fully returned rentals whose
agreed end arrived; it must run after the terminations so the fee invoice is made first), then `startDueRenewals`.
Early returns are decided at pickup completion (`closeIfFullyReturnedInTx` in `src/domains/agreements/returns.ts` →
`early-return.ts`), not by the nightly pass. Stripe work from any of these always runs after the database commit.

## Batch E messaging webhooks

Business-message delivery is recorded in `MessageDelivery` before provider calls. Provider callbacks are verified before storage and update that durable ledger; provider acceptance is not represented as delivery.

- Resend callback: `POST /api/webhooks/resend`; verify with `RESEND_WEBHOOK_SECRET`.
- Twilio callback: `POST /api/webhooks/twilio`; verify `X-Twilio-Signature` with `TWILIO_AUTH_TOKEN` against the exact public request URL and form parameters.
- Missing webhook verification configuration fails closed. Payload bodies are not logged.
- `RESEND_API_KEY`, Twilio credentials and the customer-message owner switches remain separate from webhook verification. Adding a secret does not authorize live customer messaging.

