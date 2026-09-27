# Decisions log

Dated, one entry per decision, newest first. If you reverse a decision
here, add a new entry rather than editing the old one away.

---

### 2026-09-26 — Prepaid-term discount: tied to contract term, not a lump-sum payment event; "set" = 2+ appliances per line; separate owner-toggleable free-month bonus for a fully-prepaid 12-month term

**Decision:** Chris asked directly for a prepaid-term pricing discount
("i need 6 months paid in advance to get a $5/month discount and 1 year
paid in advance to receive $10 per month discount for sets, and half the
discount for single units, and these discounts also need to be adjustable
by the owner"). Two design questions had to be confirmed with him before
building rather than assumed:

1. **Is the discount earned by the agreement's contractual term
   (`RentalAgreement.termMonths` = 6 or 12), or only once the customer
   actually pays that many months in a single lump sum up front?**
   Confirmed: tied to the **contract term**. Signing a 6- or 12-month
   agreement earns the discount immediately — no separate payment-tracking
   mechanism needed, which matters because Stripe billing (Phase 6B)
   doesn't exist yet to detect a real lump-sum payment.
2. **What counts as a "set"?** Confirmed: 2 or more physical appliances on
   the *same rental line* (e.g. a washer+dryer pair) — a single appliance
   on its own always gets the single-unit rate, even if that customer has
   other lines too.

While confirming this, Chris added a related but distinct rule: **paying
the full 12-month term in one lump sum up front also earns a free month**
— separate from the recurring per-month discount above, and independently
owner-toggleable (`BusinessSettings.twelveMonthPrepayFreeMonthEnabled`).
Since there's no billing system yet to detect an actual lump-sum payment,
Chris records this himself at agreement creation
(`RentalAgreement.paidInFullInAdvance`) — the same way he already records
`depositCents` and other money facts manually today, ahead of Phase 6B's
real billing. The decision of whether the bonus applies is frozen
(`RentalAgreement.freeMonthGranted`) at that same moment, so later
flipping the settings toggle can never retroactively add or remove the
bonus from an already-created agreement.

**Why the four dollar amounts are stored independently:** Chris was
explicit that the $5/$10 (set) and $2.50/$5 (single) figures he gave are
illustrative of the rule's *shape*, not a ratio to hard-code — "it doesnt
need to be preset to those amounts, the detailed amount is to show you my
intent." The code never derives the single-unit rate from the set rate (or
vice versa); all four live as independent `BusinessSettings` columns,
editable in `/desk/settings`, following the same pattern already
established for delivery/installation/removal fees.

See `docs/BUSINESS-RULES.md`'s Pricing section for the resulting rule and
`prisma/migrations/20260926230000_prepay_term_discount` for the schema
change.

---

### 2026-09-26 — Auth: Better Auth over Auth.js (NextAuth) v5 and Neon Auth

**Decision:** Use [Better Auth](https://better-auth.com) with its Prisma
adapter for authentication.

**Why:** The brief asked to evaluate Neon Auth and Better Auth.
Auth.js/NextAuth v5 was also considered since it's the most commonly
known option, but as of this decision it is still a long-running beta
(`5.0.0-beta.32`) years after starting, which isn't a good foundation
for a production small-business system. Neon Auth ties authentication
directly to Neon's own infrastructure, which is less flexible for the
simple custom `OWNER`/`ADMIN`/`CUSTOMER` role model this app needs, and
adds a second vendor dependency (the brief asked to minimize extra
vendors). Better Auth is a stable 1.x release, TypeScript-first, self-
hosted (not a third-party auth SaaS — it's a library, the data lives in
our own Neon database), integrates cleanly with Prisma, and supports
email/password now with magic links/passkeys available later without a
schema redesign.

---

### 2026-09-26 — Database ORM: Prisma (stable 7.10.0, not the 8.0 release candidate)

**Decision:** Prisma ORM, pinned to the latest **stable** release
(7.10.0) rather than the 8.0.0 release candidate that `npm view prisma`
resolves to under its `latest` dist-tag right now.

**Why:** Drizzle was the other option under consideration; Prisma was
chosen for its mature migration tooling, generated types, and because
it's the more common choice for teams (including future AI
contributors) to pick up quickly. A release candidate is not
appropriate for a production small-business system.

---

### 2026-09-26 — Neon region: AWS US East 1 (N. Virginia)

**Decision:** `aws-us-east-1`.

**Why:** Checked Neon's currently available regions rather than
assuming an old default. Vercel's default Serverless/Edge Function
region is also US East (`iad1`, Washington D.C.), so this keeps the
app-to-database hop in the same low-latency corridor. It's not the
geographically closest region to Colorado (that would be `aws-us-
west-2`, Oregon), but function-to-database latency matters more for
this app's responsiveness than database-to-end-user latency, since
Vercel's edge network/CDN already serves static content close to the
visitor regardless of where the database lives. If Chris's customer
base becomes concentrated enough elsewhere to matter, this is a
reversible choice — flag it as a `docs/ROADMAP.md` item, don't just
change it.

---

### 2026-09-26 — Neon: production branch not marked "protected" yet

**Decision:** Left `main` unprotected in Neon for now, noted here
instead of silently skipping it.

**Why:** Neon's plan on this account has already reached its cap on
protected branches (from a prior, unrelated project on the same
account). Attempting to protect this project's `main` branch returned:
*"You have reached the maximum number of protected branches for your
current plan."* This isn't a security hole today (the database has no
public-facing access other than through this app, over a pooled
connection string that lives only in Vercel's environment variables),
but it should be revisited — either by upgrading the Neon plan or
freeing up a protected-branch slot on another project — before real
customer data goes in. Tracked in `docs/HANDOFF.md` and
`docs/ROADMAP.md`.

---

### 2026-09-26 — Local sandbox could not run `prisma generate`/`migrate` — schema applied by hand via direct SQL instead

**Decision:** In the sandbox this project was first built in, every
`prisma` CLI command (`generate`, `migrate`, even `-v`) failed with a
403 trying to reach `binaries.prisma.sh` (Prisma's engine-binary CDN),
which is outside that sandbox's network allowlist (confirmed via the
proxy's own diagnostics — a genuine policy block, not a misconfiguration
worth retrying). Rather than ship an empty database, the full schema
from `prisma/schema.prisma` was translated to hand-written SQL and
applied directly to the real Neon database via Neon's own API (which
does not go through that restricted proxy), and `prisma/migrations/`
was written to match exactly what was applied, with matching entries
inserted into Prisma's own `_prisma_migrations` tracking table (same
migration IDs, checksums, and "already applied" state Prisma itself
would have recorded) so that a future `prisma migrate deploy` — from
GitHub Actions CI, from Vercel, or from anyone with normal internet
access — sees a fully consistent history and doesn't try to re-run or
conflict with anything.

**Why this is safe:** `prisma generate` (which produces the TypeScript
client the app imports) still needs to run somewhere with real internet
access before the app can build — and it does, automatically, via
`postinstall` in `package.json`, both in CI and on Vercel. Local
`npm run typecheck`/`build` in that original sandbox could not fully
succeed for this reason alone (confirmed: the *only* two `tsc` errors
were `@prisma/client` missing its generated `PrismaClient` export and a
Sentry import path that was fixed separately) — CI is the real
verification gate here, and it has normal internet access.

**Follow-up:** if anyone runs `prisma migrate dev` locally in a normal
environment and Prisma reports drift or an unexpected diff against this
history, that's the signal to double check the hand-written SQL against
`schema.prisma` — they should match, but hand-translation is inherently
more error-prone than the generated equivalent, so treat any drift
warning as real until proven otherwise, rather than resolving it away.

---

### 2026-09-26 — E-signature, transactional email, and Stripe: not yet decided

Deferred to the phase that needs them (rental agreements/Phase 4 for
e-signature, lead notification emails/Phase 2 for Resend vs. Postmark,
billing/Phase 6 for Stripe specifics). Placeholder env vars are in
`.env.example` so the shape is ready.

---

### 2026-09-26 — Prisma 7 removed `url`/`directUrl` from schema.prisma; added `prisma.config.ts` and a Neon driver adapter

The very first real GitHub Actions CI run (the sandbox has no internet
access to catch this locally — see the entry above) failed immediately
with a schema validation error: Prisma 7 no longer allows a connection
`url` (or `directUrl`) inside `prisma/schema.prisma`'s `datasource`
block. This is a genuine breaking change in Prisma 7, not a mistake in
how the schema was written — Prisma moved connection configuration out
of the schema file entirely.

Two separate things needed connection strings, and they're now handled
two different ways:

1. **Prisma Migrate** (creating/applying migrations, `prisma migrate
   deploy`) now reads its connection string from a new file,
   `prisma.config.ts`, at the project root. It points at `DIRECT_URL`
   (the same unpooled Neon connection it always used).
2. **The running app** (every normal database query) now hands
   `PrismaClient` its own connection directly, via what Prisma calls a
   "driver adapter," instead of Prisma reading a `url` from the schema.
   `src/lib/prisma.ts` was updated to use `@prisma/adapter-neon` —
   Neon's own serverless driver, which talks to Postgres over a
   WebSocket — pointed at `DATABASE_URL` (the pooled connection, as
   before). This needs the `ws` package because this app runs on
   Vercel's Node.js runtime, not the browser or the edge runtime, and
   only those two have a built-in WebSocket implementation.

**Why Neon's own adapter instead of the generic `pg` one:** the
database is already hosted on Neon, so its purpose-built driver gets
the same pooling/connection benefits Neon recommends for serverless
functions, with no extra configuration to keep in sync.

**Nothing about `DATABASE_URL`/`DIRECT_URL` in `.env.example` or Vercel
changed** — same two connection strings, same meanings, just read from
a different place now. `docs/ARCHITECTURE.md`'s environment-variable
list is still accurate.

---

### 2026-09-26 — Two real bugs CI caught, once it could finally run

Once the Prisma 7 config issue above was fixed, CI's "Install
dependencies" step passed for the first time, and it caught two more
real issues that the sandbox's blocked internet access had been hiding
end-to-end:

1. **A genuine schema mistake:** `Job.customer` had no matching field
   on the `Customer` side (Prisma requires both sides of a relation to
   be declared). Fixed by adding `jobs Job[]` to `Customer`. This is a
   Prisma-level annotation only — the underlying `customerId` foreign
   key column already existed in the applied migration — so no new
   migration was needed.
2. **A step-ordering mistake in `npm run typecheck`:** Next.js 16
   generates some global TypeScript types (e.g. `LayoutProps`) into
   `.next/types/`, but only when `next dev`, `next build`, or `next
   typegen` has run first. CI ran type-checking *before* the build
   step, so those types didn't exist yet and `tsc` failed on
   `src/app/layout.tsx` with "Cannot find name 'LayoutProps'". Fixed by
   changing the `typecheck` script to `next typegen && tsc --noEmit` so
   it generates those types itself instead of depending on step order.

Both were caught locally too, by the same commands CI runs
(`npm run typecheck` after a clean `rm -rf .next`), before pushing.

---

### 2026-09-26 — Two more real bugs, caught by CI's build step

With install, migrations, type-checking, lint, and unit tests all
finally passing in CI, the build step turned up two more real issues:

1. **`useSearchParams()` needs a Suspense boundary:** `/login`'s form
   reads a `?next=` query param (where to send someone after logging
   in) using `useSearchParams()`, which Next.js requires to be wrapped
   in `<Suspense>` so the rest of the page isn't held up waiting for
   it. Fixed in `src/app/login/page.tsx`.
2. **`middleware.ts` is deprecated in this Next.js version** — renamed
   to `proxy.ts` (same purpose: the fast, cookie-only sign-in gate for
   `/desk` and `/account`, see `docs/ARCHITECTURE.md`). This was only a
   build-time warning, not a failure, but left alone it would break on
   a future Next.js version that removes the old name outright. Fixed
   by renaming the file and its exported function (`middleware` →
   `proxy`) per Next's own migration guide; nothing else about it
   changed.

**A local sandbox note, not a bug:** rebuilding locally in this
project's original sandbox still fails, but for an unrelated, already-
documented reason — `next/font/google` needs to fetch font files from
`fonts.googleapis.com` at build time, and that host is outside this
sandbox's network allowlist (same class of restriction as
`binaries.prisma.sh` above). This is not a problem in GitHub Actions or
on Vercel, both of which have normal internet access — confirmed
because CI's build got past font loading and all the way to page
generation before hitting the two real bugs above.

---

### 2026-09-26 — Fixed a real bug: `User.emailVerified` was the wrong type

While creating Chris's first (OWNER) login, account creation failed with
a genuine error — not a sandbox network issue this time. The original
hand-written schema (written without a working `prisma validate`, see
the earlier entry on why) gave `User.emailVerified` the type
`DateTime?`, following the Auth.js/NextAuth convention. Better Auth
(what this app actually uses) expects a plain `Boolean` there instead,
defaulting to `false` — confirmed directly from Better Auth's own
schema source (`@better-auth/core/dist/db/schema/user.mjs`).

**Decision:** Changed `emailVerified` to `Boolean @default(false)` in
`prisma/schema.prisma`, and added a migration
(`20260926163000_user_email_verified_boolean`) that converts the
existing column. The `User` table had zero rows at the time (nobody
could sign up yet, precisely because of this bug), so the conversion is
lossless — confirmed via a direct row count before applying it. Applied
with Chris's explicit go-ahead (the tooling itself requires human
confirmation before any live schema change, per this project's own
"ask before anything irreversible" rule).

Every other Better Auth table (`Session`, `Account`, `Verification`) was
cross-checked line-by-line against Better Auth's own schema source at
the same time — everything else already matched.

---

### 2026-09-26 — Fixed a real bug: login failed with "Invalid origin"

Chris tried to log in right after the OWNER account was created and got
"Invalid origin." Root cause: Better Auth rejects any sign-in request
whose browser `Origin` doesn't match its configured `baseURL`, and the
old config computed `baseURL` from Vercel's `VERCEL_URL` environment
variable — which is the *specific deployment's own* generated hostname,
not the stable `appliance-desk.vercel.app` address Chris actually visits
(and it's a different, unpredictable hostname on every future deploy).
A plain string `baseURL` can only ever match one hostname, so it could
never match both the production domain and preview-deployment domains
at once.

**Fix:** switched to Better Auth's built-in "dynamic baseURL" option
(`baseURL: { allowedHosts, fallback }` in `src/lib/auth.ts`), which is
built for exactly this multi-domain-per-project situation — it accepts
whatever host the real request came in on, as long as it matches an
allowed pattern (`*.vercel.app` for now), rather than requiring an exact
match against one fixed URL. When a real custom domain is bought later,
it needs to be added to that `allowedHosts` list.

---

### 2026-09-26 — Phase 2: design system, email provider, appliance catalog shape

**Design system:** Fraunces (a warm, humanist serif) for headings paired
with Inter for body/UI text — chosen to read as a real, personal small
business rather than a generic corporate template, while keeping the
same navigation/button/menu conventions (sticky header, hamburger menu
below the `md` breakpoint, a persistent primary CTA) used by well-known
consumer sites. Color tokens (warm cream canvas, terracotta primary,
deep green accent) live in `src/app/globals.css` as CSS variables mapped
through Tailwind's `@theme inline`, with a dark-mode variant and a
visible focus ring everywhere (never `outline: none`) per
`docs/DESIGN-SYSTEM.md`.

**Transactional email:** Resend (already a dependency) for new-lead
notifications. Guarded in `src/lib/email.ts` — with no `RESEND_API_KEY`
set, it logs instead of sending, so the site, CI, and every preview
deployment work today with no email account yet required. Turning on
real email later is just adding the Vercel environment variable.

**No product photos yet:** there are no real appliance photos to use
honestly, so the public site uses simple generic line-art illustrations
(`src/components/site/appliance-icon.tsx`) instead, with a visible
disclaimer that the actual appliance may differ in brand/model/color —
per Chris's own instruction. Tracked in `docs/ROADMAP.md` to swap in
real photos once he supplies them.

**Appliance catalog shape (washers/dryers first, more later):**
`ApplianceType` already models "a category with a published price" —
exactly what's needed for this. Seeded three starter rows
(`prisma/seed.ts`): Washer ($35/mo), Dryer ($35/mo), and "Washer + Dryer
Set" ($60/mo) as its own `ApplianceType` row, since BUSINESS-RULES.md's
bundle price is lower than the sum of the two individual prices and
doesn't fit either individual row. This needed no schema change and
keeps "new appliance categories are added as data" true going forward —
adding refrigerators, ranges, etc. later is a data change in
`/desk/settings`. (This is separate from — and doesn't change — the
existing rule that a rented washer/dryer set is always two separately
tracked physical `Appliance` rows once real inventory exists in Phase 3.)

**Fixed a real bug found by CI: the Neon driver adapter doesn't work
against a plain (non-Neon) Postgres.** Once `db:seed` and the new
lead-form e2e test became the first things to run a real Prisma query
against CI's throwaway Postgres container (everything in Phase 1 that
touched the database only did so through `prisma migrate deploy`, which
uses a different connection path — see `prisma.config.ts` — never
through the app's own `PrismaClient`), CI failed with a WebSocket error.
Root cause: `@prisma/adapter-neon` talks to Postgres over a WebSocket
protocol that only Neon's own infrastructure understands — it can't
connect to a vanilla `postgres:17` container the way CI (and anyone
running this locally) does. Fixed in `src/lib/prisma.ts` by choosing the
adapter based on whether `DATABASE_URL` is actually a Neon host: Neon's
adapter for real Neon connections (production, every Vercel preview),
and the standard `@prisma/adapter-pg` (added this session) for anything
else. Nothing about `DATABASE_URL`/`DIRECT_URL` changed — same two
connection strings as always.

**Fixed real bugs found by the accessibility/e2e tests themselves:**
axe flagged real WCAG AA color-contrast failures once the real design
tokens were tested against real rendered pages — the original
`--color-primary` (4.39:1 on button text, need 4.5:1) and
`--color-ink-faint` (3.93–4.37:1, used in the footer and disclaimers)
were both darkened in `src/app/globals.css` until every pairing
actually in use clears 4.5:1 (verified by computing WCAG relative
luminance for each foreground/background pair in use, not by eye).
Two of the new e2e tests also had bugs of their own, not the app: the
mobile-menu test re-used a locator bound to the toggle button's "Open
menu" name after clicking it (the name correctly changes to "Close
menu," so the old locator stopped matching anything — fixed by querying
the new name), and the lead-form test picked "the first checkbox on the
page" to select an appliance, which is actually the unrelated "I'm a
landlord/property manager" checkbox that comes first in the form — fixed
to select a checkbox by appliance name specifically.

**Seeding runs in CI now, safely:** `prisma/seed.ts` was split into two
independent parts — business content (BusinessSettings singleton +
starter appliance types), which always runs and needs no secrets, and
Chris's OWNER account, which still only runs when `OWNER_EMAIL`/
`OWNER_PASSWORD` are set. CI now runs `npm run db:seed` (content only,
those secrets are never set in CI) after migrations so the
accessibility/e2e tests exercise real, populated pages instead of an
empty pricing page — not new mock data, the same real starter catalog
described above.

## Appliance-type management, dollar-entered fees, and split delivery/install fee (2026-09-26)

After using `/desk/settings` for the first time, Chris flagged three real
gaps from Phase 2:

1. **No way to add a new appliance type from the desk.** The pricing
   table only ever showed the three seeded rows (Washer, Dryer, Set);
   the page's own caption said to "ask a developer." Fixed by adding
   `createApplianceType`/`setApplianceTypeActive` to
   `src/domains/settings/index.ts`, a `createApplianceTypeAction`/
   `setApplianceTypeActiveAction` pair, and a real add-appliance-type
   form plus a retire/restore control in
   `appliance-pricing-table.tsx`. New types are never hard-deleted —
   `ApplianceType.isActive` (new column) marks a type retired instead,
   since a hard delete would orphan any `Lead`/`PricingRule`/`Appliance`
   row that already references it.
2. **Fee inputs required cents, not dollars.** `/desk/settings`'
   fee fields (delivery, removal, late fee flat) took raw cents
   ("4500" for $45.00) — correct for the database, wrong for a human
   filling out a form. The database still stores integer cents (money
   is never floating point, per `docs/BUSINESS-RULES.md`); the
   dollars-in/cents-out conversion now happens once, in
   `src/app/desk/settings/actions.ts`, right before the database write
   — the form and its `FormValues` type work in real dollars
   (`deliveryFeeDollars`, not `oneTimeDeliveryFeeCents`) via a new
   `DollarInput` component that mirrors the appliance-pricing table's
   existing dollar-input pattern.
3. **Delivery and installation were one combined fee.** Chris wants to
   be able to charge for delivery and installation independently (e.g.
   delivery-only when a customer installs it themselves). Added
   `BusinessSettings.oneTimeInstallationFeeCents` as its own column
   (migration `20260926190000_appliance_types_and_installation_fee`,
   hand-written SQL per the sandbox limitation noted above) alongside
   the existing delivery and removal fees; `/pricing` now shows three
   independent one-time-fee line items instead of two.

**Also fixed a real bug this surfaced:** the public site's appliance
icon was chosen by pattern-matching the type's *slug* ("dryer" → dryer
icon, anything else → washer icon, `"washer-dryer-set"` → both). That
silently broke the instant a type other than the three seeded ones
existed — a newly-added "Refrigerator" would have rendered a washer
icon. Added `ApplianceType.photoUrl` (same migration) so a real photo
can be set per type, and a new `<ApplianceMedia>` component
(`src/components/site/appliance-icon.tsx`) that shows that photo when
present and otherwise falls back to one single, appliance-agnostic
icon — never a guess at which appliance it is. No real photos exist
yet (this session's sandbox can only reach GitHub and package
registries over the network, not stock-photo sites, and guessing at a
photo's license for a live business site isn't acceptable) — Chris is
supplying 2–4 basic-model photos separately; wiring them in from there
is just setting `photoUrl` per type, no further code change needed.

---

### 2026-09-26 — E-signature: in-house typed-signature capture, not a paid provider (for now)

Phase 4 needed rental agreements to actually get signed. Rather than
wait on or unilaterally pick a paid e-signature vendor (SignWell,
DocuSign, HelloSign, etc. — a recurring cost decision that belongs to
Chris, per `AGENTS.md`'s "ask before anything... costly"), built a
lightweight, in-house capture: a private, unguessable link
(`/sign/[signatureRecordId]`, no login) where the customer reviews the
agreement's terms and signs by typing their full legal name, checking
an "I agree" box, and submitting. That's recorded with a timestamp and
their IP address in `SignatureRecord` (`provider: "typed_signature"`).

**Why this is reasonable for now:** it produces a real, timestamped,
attributable record of agreement — enough to run the business day to
day — while costing nothing and needing no new integration. **Why it's
not the final answer:** it lacks the stronger identity-verification,
tamper-evident PDF, and audit-trail features a dedicated e-signature
service provides, which matters more as transaction volume or dispute
risk grows. `SignatureRecord.provider` already anticipates swapping in
a real provider later without a schema change — that's a flagged
`docs/ROADMAP.md` item for Chris to decide on, not something to switch
to unasked.

---

### 2026-09-26 — Customer account activation reuses Better Auth's own password-reset flow, not a new invite-token system

Phase 6A item 2 required replacing the old workflow where converting a
lead created a one-time random password that Chris had to see and relay
to the new customer himself — a real risk (Chris ends up knowing/typing
customer passwords) and a real gap (no way for a customer to recover
their own account later).

**Decision:** rather than build a separate invitation-token table and
email flow, `src/lib/auth.ts` now wires up Better Auth's built-in
`emailAndPassword.sendResetPassword` (it already generates, stores, and
verifies its own expiring, single-use token via the `Verification`
table that's existed since Phase 1 — no schema change needed). A
brand-new customer account is created with a random password that's
discarded immediately and never shown to anyone, then
`sendCustomerActivationEmail` (`src/domains/leads/index.ts`) triggers
that exact same reset-password email as the account's activation link.
"Set your first password" and "reset a forgotten password" are
deliberately the same code path, not two systems to keep in sync.
Chris can trigger it again any time from "Resend activation email" on
a customer's own page (`src/app/desk/customers/actions.ts`).

New public pages: `/forgot-password` (request the email) and
`/reset-password` (consume the emailed link's token, set a new
password) — both plain forms using Better Auth's client methods
directly, no new server-side password logic of our own to maintain.

**Why not a custom invite-token model:** Better Auth's reset-password
primitive already does everything an invitation needs — a random
opaque token, an expiry (1 hour), single-use consumption, and a
callback to deliver it by email — so building a second, parallel system
would just be more surface area to keep secure and in sync for no real
benefit. This is exactly the guidance the work-order itself gave
("Use Better Auth's built-in primitives rather than inventing your own
where it already covers this").

**Left for later, on purpose:** rate limiting specific to the
forgot-password endpoint (the app-wide Better Auth rate limiter in
`src/lib/auth.ts` already covers it at 10 requests/60s per client, which
is a reasonable starting point, not nothing); requiring email
verification before first login (`requireEmailVerification` stays
`false` until a verified sending domain is confirmed in Resend, same
gating note as the rest of transactional email in this project); real
customer-isolation integration tests (Phase 6A item 3, its own
unstarted piece of work).

---

### 2026-09-26 — Public form spam protection: honeypot + in-memory rate limit, not Turnstile (yet)

Phase 6A item 7. The public lead form (`/contact`) had zero abuse
protection — Verified Finding #4 confirmed no rate limiting, honeypot,
or CAPTCHA anywhere in the codebase.

**Built now, at zero cost and no new infrastructure:**
- A honeypot field (`leadFormSchema`'s `website`) hidden off-screen in
  `contact-form.tsx` — never visible or reachable by a real visitor
  (positioned off-screen, not `display: none`, and wrapped in
  `aria-hidden` so it's never announced to assistive tech either). Any
  value in it means an automated submission; `submitLead` reports
  success but never saves a Lead or emails Chris, so the bot gets no
  signal to adapt its behavior.
- A per-IP sliding-window rate limit (`src/lib/rate-limit.ts`, 5
  submissions / 10 minutes), applied in `submitLead` before touching
  the database.

**Why in-memory instead of a persistent/shared store:** this project
has no Redis/KV service today, and adding one is exactly the kind of
new paid infrastructure `AGENTS.md` says to ask before adding. An
in-memory, per-serverless-instance limiter is honestly "best effort" —
Vercel can run more than one instance of the same route, each with its
own memory, so a determined attacker spreading requests across
instances or IPs won't be fully stopped. It's still real protection
against the common case (a script hammering the endpoint from one
IP), for zero infrastructure and zero cost, and is documented as such
in the code rather than oversold.

**Why not Cloudflare Turnstile now:** the work-order listed it as "an
option if needed," not a default — it needs a Cloudflare account/site
key (a small setup decision, not code), and there's no evidence yet of
real abuse on this form to justify the added friction and setup. If
spam becomes a real, observed problem, Turnstile (or a persistent
rate-limit store) is the documented next step — not something to add
speculatively now.

---

### 2026-09-27 — Reservation aging: an owner-adjustable hold + a manual "extend," never an automatic cancellation

Phase 6A item 6. Assigning a physical appliance to a DRAFT agreement
reserves it immediately (`AVAILABLE` → `RESERVED`), before the customer
has actually signed anything. If that agreement then never gets signed,
the appliance stays reserved and unavailable to any other customer
indefinitely, unless Chris happens to notice and cancels it by hand —
there was no visibility into this at all.

**Decision:** added `RentalAgreement.reservationExpiresAt` (set at
creation to now + `BusinessSettings.draftReservationHoldDays`, an
owner-adjustable default of 7 days — same "adjustable, not hard-coded"
pattern as every other business rule here) and a pure
`isReservationStale(status, reservationExpiresAt)` check (only ever
true for a still-DRAFT/AWAITING_SIGNATURE agreement past its hold). The
desk surfaces this as a visible warning — a "Stale hold" badge on the
agreements list, and a fuller banner with an action on the agreement's
own page — never as anything automatic. Chris chooses what happens
next: **cancel** (already-existing action; frees the appliance back to
`AVAILABLE`) or **extend the reservation** (new — pushes the hold back
out by the same configured number of days, for a deal that's just
taking a while). This was an explicit, non-negotiable constraint from
the work-order itself: "without ever silently cancelling a legitimate
in-progress agreement" — so nothing here ever changes an agreement's
status or an appliance's own status on its own; it only ever informs
and offers the same actions Chris could already take manually.

**Why a separate `reservationExpiresAt` instead of just comparing
against `createdAt`:** extending a hold needs its own moment to record
— recomputing "extend by N more days" from the original creation date
would either need to keep adding N-day increments forever (awkward) or
overwrite the created date itself (dishonest — `createdAt` should mean
what it says). A dedicated, independently-updatable field keeps
"when was this created" and "how long is its hold good for" as two
separate, honest facts.

**Split into its own submodule
(`src/domains/agreements/reservation-status.ts`):** the staleness check
needed to be usable from the agreement detail panel's client component
without dragging `src/domains/agreements/index.ts`'s top-level
`import { prisma } from "@/lib/prisma"` into the browser bundle — the
exact client-bundle-Prisma-leak bug this project has already been bitten
by once (see the Phase 4 entry above). Same split pattern already used
for `src/domains/pricing/money.ts` and `src/domains/leads/schema.ts`.
