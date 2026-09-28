# Decisions log

Dated, one entry per decision, newest first. If you reverse a decision
here, add a new entry rather than editing the old one away.

---

### 2026-09-27 — Workflow continuity: two dead-end actions fixed

Chris pointed out a real UX gap: converting a lead to a customer left him
on the lead page with just a success message — he had to navigate to
Customers himself to do anything with the new account. He suspected there
were more spots like this.

**Checked the rest of the app's "create/convert" actions first, not just
his one example**: every *new-record* form already does this right —
creating a customer redirects to that customer's page (which itself has a
"+ New agreement" button), creating an agreement redirects to that
agreement's page (which has a "+ Schedule a job" button). The lead-
conversion action was the one real exception — it's a status change on an
existing page, not a "create a new record and go there" form, so nobody
had added a next step. Fixed: its success message now includes "Go to
their customer page" and "Start an agreement" buttons.

**Found one more, while looking**: completing a DELIVERY/INSTALLATION/
SWAP/REMOVAL job never prompted updating the appliance's own status (e.g.
marking it RENTED after a delivery, or AVAILABLE after a removal) — Chris
had to remember to do that separately on the appliance's own page. Added a
one-click suggestion (never automatic — the same
`updateApplianceStatus`/allowed-transition rules and audit logging every
other status change already goes through) that appears once a job's
marked COMPLETED, for each appliance on it that isn't already at the
status the job type implies.

Not treated as an open-ended audit of every action in the app — these two
were the concrete, findable gaps; more can be flagged the same way as
they're noticed.

---

### 2026-09-27 — Built the four features Chris picked from the friend's proposal, plus a second architecture review

After the "friend's rebuild proposal" assessment (below), Chris picked all
four genuinely-new ideas — QR codes on appliances, appliance profitability/
ROI, an MRR/ARR revenue dashboard, and fleet utilization analytics — and
asked to go further: "use these as inspiration to come up with ways to
really build out my business part of this system. We are doing great, but
it is so basic."

**Built, all additive (one nullable-column migration, no destructive
changes):**

- `Job.partsCostCents`/`laborCostCents` — lets Chris record what a repair
  actually cost, which is the raw input to profitability.
- `src/domains/inventory/analytics.ts` — pure, unit-tested math for
  per-appliance revenue (prorated from real `ApplianceAssignment` dates and
  the rental line's agreed price, split evenly across appliances sharing a
  line), utilization (% of time in the fleet actually assigned), and
  profitability (revenue − repair cost − purchase cost, "paid for itself"
  yes/no). Verified against the proposal's own worked example (Washer
  W-0047: $310 cost, $1,085 revenue, $92 repairs → $683 net) in
  `tests/inventory-analytics.test.ts`.
- `src/domains/billing/revenue.ts` — MRR/ARR and a 6-month trend
  reconstructed from agreements' own agreed pricing and start/end dates
  (not a separate ledger); collected revenue, past-due, and failed-payment
  figures come straight from real Stripe-confirmed `Payment`/`Invoice`
  rows, never estimated. **Caught and fixed a real bug while testing this**:
  the trend's month-boundary math originally used `new Date(year, month, 1)`,
  which constructs in the server process's local timezone — comparing that
  against `startDate`/`endDate` values that come out of Postgres as UTC
  instants could misclassify a date right at a month boundary depending on
  what timezone the code happens to run in. Fixed to use `Date.UTC(...)`
  on both sides of every comparison, verified with a test on a machine
  actually running in a non-UTC timezone (America/Denver) so the bug
  reproduced and the fix could be confirmed against it.
- `/desk/revenue` (MRR/ARR, collected/past-due/failed payments, a 6-month
  trend bar chart) and `/desk/fleet` (utilization %, total invested/
  revenue/repair cost/net contribution, most/least-utilized and
  highest-repair-cost rankings) — new desk pages, linked from the sidebar
  and from `/desk/dashboard`'s own stat cards.
- `/scan/[assetNumber]` + a printable QR label
  (`/desk/inventory/[id]/qr`, server-rendered SVG via the `qrcode` package,
  no external service call) — one QR code per physical appliance, one URL,
  three outcomes depending on who scans it: staff go straight to that
  unit's inventory page, a customer currently renting it goes to a
  pre-filled service request, anyone else (not signed in, or scanning a
  unit that isn't theirs) gets a safe, generic page — never appliance
  detail before the scanner's identity/relationship is confirmed.

**Also assessed a second, more architectural review** (ChatGPT "Astra,"
saved at `docs/reviews/2026-09-27-astra-operations-review.md`) that Chris
shared mid-session. Unlike the friend's proposal, this one is honest about
its own limits ("I haven't audited its backend") and mostly correct: the
real relational schema, enforced status transitions with audit logging,
and an already-fairly-rigorous billing subsystem (immutable invoice line
items, webhook idempotency, anniversary billing, refunds/credits) it calls
for already exist underneath the screens it reviewed. Full assessment and
the handful of genuinely new ideas from it (a separate Contacts concept, an
accounting export, auditing outgoing-request idempotency) are folded into
`docs/reviews/2026-09-27-business-growth-ideas.md` rather than repeated
here. Its multi-employee-permissions and purchasing/supplier-chain
recommendations describe a business with staff — Chris runs this alone
today, so that layer is correctly left as a future item, not built now.

**Also wrote `docs/reviews/2026-09-27-business-growth-ideas.md`** — a
brainstorm of further ideas grounded in what the app already has (not
generic SaaS features), for Chris to pick from same as everything else
here. Nothing in it is built; it's a menu, not a plan.

---

### 2026-09-27 — Real dark mode, superseding the "light-only" decision below

**What changed:** right after the light-only fix below shipped, Chris
said he wants the app to actually support dark mode, not just avoid
being broken by it. Built a real one rather than redoing the previous
fix a different way:

- A `.dark` class on `<html>` (`src/lib/theme.ts`), not just the
  device's own setting — so there's an explicit toggle (a sun/moon
  button in every header), while still defaulting to the device's
  setting the first time. An inline script runs before the page paints
  so there's no flash of the wrong theme.
- The public site needed **zero component changes** — it was already
  built entirely from CSS variables (`bg-canvas`, `text-ink`, etc.), so
  reinstating those variables' dark values under `.dark` (rather than
  the old `@media (prefers-color-scheme: dark)`, which the light-only
  fix removed) was the whole fix for that half of the app.
- The owner desk, customer portal, and sign/login pages needed a
  different approach, since (as the entry below found) they hard-code
  plain Tailwind colors in ~55 files with no dark equivalent.
  Retrofitting every file to use CSS-variable classes instead would be
  the more conventional fix, but it's a much bigger, easier-to-get-wrong
  change for the same result. Instead, added `.dark` CSS overrides for
  the exact, finite set of hard-coded classes already in use across
  those files (`globals.css`) — this mechanically covers every current
  use of them (and any future one that reuses the same classes) from
  one place, rather than needing every file touched and reviewed
  individually. `docs/DESIGN-SYSTEM.md` has the how-to for anyone
  adding a new page.
- Verified with real automated checks, not by eye: `e2e/accessibility-
  dark-mode.spec.ts` reruns the same axe/WCAG checks used elsewhere,
  with the browser set to prefer dark, across a representative sample
  of public/desk/account pages — specifically because a centralized
  override like this is easy to get a color pairing wrong in without
  noticing visually. Plus `tests/theme.test.ts` and
  `tests/theme-toggle.test.tsx` for the toggle logic itself (including
  a same-tab update bug the tests caught during development: clicking
  the toggle updated `localStorage` and the DOM class, but nothing told
  the button component to re-render in the same tab that clicked it).

### 2026-09-27 — Mobile color/contrast bug: standardize on light theme everywhere, not a real dark mode

**(Superseded by the entry above, same day — kept for the record of
what the actual color bug was and why "light-only" was the first fix
tried.)**

**What Chris reported:** on at least one page, a text box's background
was white but the typed text was too close in color to read, and
scrolling to the side or past the bottom of a page showed a dark
background outside the normal view instead of white.

**Root cause:** `src/app/globals.css` defined a full second set of
color values under `@media (prefers-color-scheme: dark)`, so a phone
or browser set to dark mode would flip the app's shared color
variables (page background, main text color) to dark ones. But almost
none of the app was actually built to use those variables — every
form, table, and page in the owner desk, customer portal, and the
sign/login pages hard-codes plain light Tailwind colors (`bg-white`,
`text-gray-900`, and so on) with no dark equivalent. So in dark mode:
text inputs with no explicit text color of their own inherited the
page's now near-white text color, sitting on a still-white input box —
unreadable. And the space beyond the page's own content (an
end-of-page scroll, or the bounce past the top/bottom on an iPhone)
showed the browser's own default canvas, using the flipped dark
variable, while every actual page content box stayed hard-coded white
— hence "dark outside the original view."

**Decision:** rather than finish building a real second, dark-mode-safe
theme for the whole app (a bigger design project, and not what was
asked for), standardize on the light theme everywhere: removed the
dark-mode color override entirely and added `color-scheme: light` so
no browser ever substitutes its own dark colors here, plus an explicit
white-background/dark-text default on every `<input>`/`<textarea>`/
`<select>` as a second line of defense. A real dark mode remains a
future option (`docs/ROADMAP.md`) if Chris wants one built properly
later — this fix just makes sure the app can't end up half-light,
half-dark on a phone that's set to dark mode, which is what was
actually happening.

### 2026-09-27 — Idle/auto-logout timeout: 20 minutes for the owner desk, 30 for the customer portal

**Decision:** Chris asked directly for auto-logout protection — there
was previously no idle timeout at all (just a 14-day session that
never checked whether anyone was still there). Added a client-side
idle timer (`src/components/idle-logout.tsx`) that watches for mouse/
keyboard/touch/scroll activity across every open tab (synced via
`localStorage`, so switching tabs in the same browser doesn't log
someone out from under them), warns with a countdown for the last
minute, and signs out + redirects to `/login?reason=timeout` if no one
responds. Chose 20 minutes for `/desk/**` (an owner/admin account can
see every customer's data — more sensitive) and 30 minutes for
`/account/**` (a customer looking at just their own rentals/billing —
lower risk). Both numbers are easy to change in one line
(`src/app/desk/layout.tsx` / `src/app/account/layout.tsx`) if Chris
wants a different balance between security and convenience.

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

## 2026-09-27 — first real, database-backed integration test (Phase 6A item 3)

**Problem:** every test in this project up to this point mocked (faked)
`@/lib/prisma` — proving business logic correct without needing a real
database. That works well for pricing math, status transitions, and
similar pure logic, but it cannot actually prove
docs/BUSINESS-RULES.md's "Customer data isolation (security-critical)"
rule, since a mocked database only ever returns what the test tells it
to — it can't catch a real, unscoped query that would leak another
customer's data in production.

**Decision:** added `tests/customer-isolation.test.ts`, the first test
in this project that imports the real `@/lib/prisma` and runs against
a real Postgres database instead of a mock. No new CI plumbing was
needed: `.github/workflows/ci.yml` already runs a real, disposable
Postgres service container, applies migrations, and seeds it — all
*before* the `npm test` step — so a real-database test is simply
another file `npm test` picks up. It creates two full, independent
customer fixtures (user, customer, service address, active rental
agreement, appliance) and proves the customer-portal domain
(`src/domains/portal`) never returns or accepts one customer's records
under the other customer's login, then deletes everything it created.

**A real limitation of this specific change:** the sandbox this was
written in cannot generate a local Prisma client at all (see "A real
constraint you should know about" in AGENTS.md), so unlike every other
test added so far, this one could not be run locally before opening
its PR — it's verified purely by CI. Everything reasonably checkable
locally (the file's own syntax, types apart from Prisma's generated
ones, and lint) was checked; the actual pass/fail proof is CI's first
run of it.

## 2026-09-27 — safe production database migrations (Phase 6A item 1)

**Problem:** the only way a migration ever reached the live Neon
database was Chris manually pasting its SQL into Neon's console,
before or alongside each Vercel deploy. This already caused one real
production failure early on (PR #4), and caused a second scare this
session (a Vercel build crashed prerendering "/" because the live
database hadn't been migrated yet — see docs/HANDOFF.md). Vercel's
build never ran `prisma migrate deploy` on its own, and nothing
stopped application code from running against a schema it didn't
match.

**Decision:** package.json's `vercel-build` script (a real, Vercel-
documented override — Vercel runs it instead of `build` automatically,
no dashboard change needed) now runs, in order: `check:migrations`
(refuses to proceed if a migration contains an unreviewed destructive
pattern — see below), `db:migrate:deploy` (applies pending migrations
to the real database), `db:verify-schema-health` (one real query per
major part of the schema, failing with a plain message if something's
still missing/mismatched), then `build`. Each step only runs if the one
before it succeeded, so a failed migration or a failed health check
fails the whole Vercel build — and a failed build is never promoted,
so the live site keeps serving its last good deployment. This closes
the actual gap (additive migrations are now automatic and safe) without
adding any new hosting infrastructure, exactly as the work-order asked.

**Destructive-migration safeguard
(`scripts/check-migrations.mjs` + `prisma/migrations/DESTRUCTIVE-MIGRATIONS-REVIEWED.json`):**
scans every migration.sql for patterns that can destroy or corrupt real
data (DROP TABLE/COLUMN/DATABASE, TRUNCATE, RENAME, or SET NOT NULL on
an existing column) and blocks it unless its migration folder name is
explicitly listed, with a note, in the reviewed-migrations JSON file.
Deliberately a *separate* file rather than a marker inside the
migration.sql itself — editing an already-applied migration's SQL
content after the fact would change its checksum, and Prisma's own
`migrate deploy` refuses to proceed if a migration's checksum doesn't
match what's already recorded as applied in production. This check
runs twice: as its own CI step on every pull request (so a human
reviewer sees it before merge), and again inside `vercel-build` as a
last-resort safety net. The one pre-existing migration that actually
matches a destructive pattern
(`20260926163000_user_email_verified_boolean`, which does `ALTER
COLUMN ... SET NOT NULL`) was retroactively reviewed and added to the
JSON file rather than edited — its own existing comment already
recorded that the User table had zero rows when it ran, so nothing
about the historical migration itself needed to change.

**Schema-health check (`scripts/verify-schema-health.ts`):** a small
script, run with `tsx` (same tool `prisma/seed.ts` already uses) so it
can import and reuse the app's own real `src/lib/prisma.ts` client
rather than duplicating connection logic. It runs one representative
query against each major part of the schema (BusinessSettings, User,
Customer, ApplianceType, RentalAgreement, AuditLog) — enough to catch
"a migration didn't actually run," which is the exact failure mode that
already happened once, with a message a non-developer can act on
instead of a stack trace buried inside Next.js's own build output.

**Restore point — deliberately not a new snapshot mechanism:** the live
Neon project already keeps a rolling 6-hour point-in-time-restore
window as part of its current plan (confirmed directly against the
Neon project via its API, 2026-09-27) — Neon can restore to any moment
in that window with no extra setup or cost. Building a custom
snapshot-before-migrate step would have meant a new Neon API credential
living in Vercel's environment and new code exercising Neon's branching
API on every single deploy — real, ongoing infrastructure and risk for
a safety net Neon already provides. Recommendation, not automated: for
anything the destructive-migration check actually flags, take an
explicit Neon branch snapshot by hand right before merging, so the
restore point isn't limited to the rolling 6 hours.

**What Chris still does by hand:** nothing at all for a routine,
additive migration — merging the PR is now the whole deploy. He's only
asked to look at anything when `check:migrations` blocks a migration,
and even then the ask is "confirm this is safe" plus a recorded note,
never raw SQL.

## 2026-09-27 — first real run of the automatic migration pipeline hit a one-time bookkeeping gap (not a bug in the new system)

The very first time `vercel-build`'s new automatic `prisma migrate
deploy` step actually ran against the live database (as part of
merging the PR for the "Safe production database migrations" entry
above), it failed with Prisma error P3018 trying to re-add
`ApplianceType.isActive`, which already existed.

**Root cause:** every migration before this pipeline existed was
applied by Chris pasting its SQL directly into Neon's console. That
always updated the real schema correctly, but it never touched
Prisma's own private bookkeeping table (`_prisma_migrations`), which
only gets written when Prisma itself runs a migration. So 5 migrations
(`20260926190000_appliance_types_and_installation_fee` through
`20260927010000_reservation_expiration`) were fully, correctly applied
to the real database, but Prisma had no record of that — and the first
time it actually tried to run them itself, it collided with columns
that were already there.

**Confirmed, not assumed:** before touching anything, every column
each of those 5 migrations was supposed to add was checked directly
against the live database and found already present — this was purely
a paperwork gap, never a partially-applied or missing change.

**Fix:** a one-time SQL statement (given directly to Chris to run in
Neon's console, matching this project's existing pattern for anything
that writes to production) marking those 5 migrations as already
applied in `_prisma_migrations`, using the same checksum Prisma itself
computes from each migration.sql file (verified by hashing the actual
files and comparing to what Prisma had already recorded for the
migrations it did track correctly).

**Why this can't recur going forward:** the whole point of the
"Safe production database migrations" change above is that migrations
never get pasted into Neon by hand again — merging a PR is now the
entire deploy. As long as that holds, Prisma's bookkeeping and the real
schema can never drift apart again. **If a genuine emergency ever
requires pasting SQL directly into Neon again** (bypassing the normal
PR flow entirely), immediately follow it with `prisma migrate resolve
--applied <migration name>` against production — skipping that step is
exactly what caused this.

## 2026-09-27 — Phase 6B billing policy decisions, confirmed with Chris

Before any billing/Stripe work begins, four open policy questions
(explicitly flagged in the work-order as needing Chris's own decision,
never an AI's guess) were reviewed with him and confirmed:

1. **Anniversary billing**, not a single fixed billing date for
   everyone — each customer's monthly charge lands on the same day of
   the month they signed. Chosen over a fixed date because it needs no
   partial-month proration logic for a customer who joins mid-month,
   which is a common source of billing bugs and customer confusion.
2. **Deposits are charged as real money up front**, not merely
   authorized/held on a card. A bank hold typically expires after about
   a week, which can't cover a rental that runs for months, so holding
   instead of charging isn't a workable option here regardless of
   preference.
3. **Both cards and ACH bank-transfer payments are offered from day
   one**, through Stripe's own hosted Checkout/Customer Portal — cards
   are instant but cost ~2.9% + $0.30 per charge, ACH is much cheaper
   per charge but takes a few business days to confirm. Offering both
   costs nothing extra to build (Stripe's hosted flow handles the
   difference) and saves real money once there's real volume.
4. **Billing in advance** — a customer is charged at the start of the
   month they're about to rent for, not after the fact for the month
   already used. Protects cash flow: the business is paid before
   providing the next month of service, not floating risk on every
   customer.

These four decisions govern the billing data model and Stripe
integration built under Phase 6B — see `docs/BUSINESS-RULES.md`'s
"Billing rules" section for the plain-English summary kept alongside
the rest of the business rules.

## 2026-09-27 — Phase 6B billing data model redesign

**Problem:** the original `Invoice`/`Payment`/`Deposit` models were
confirmed too minimal to build real billing on (Verified Finding #5 in
the original work-order) — no line items, no invoice numbers, no
billing-period dates, no refund/credit/write-off tracking, no Stripe
customer/subscription linkage, no webhook idempotency. Building Stripe
UI directly against that would mean retrofitting the data model under
pressure once real invoices existed.

**Decision:** redesigned the schema before writing any Stripe code, per
the work-order's own suggested order. Confirmed first that nothing in
the app reads or writes `Invoice`/`Payment`/`Deposit` yet (checked
directly — zero matches for `prisma.invoice`/`prisma.payment` anywhere
in `src/`), so every change was additive: new columns, new tables, and
new enum values, with nothing renamed or removed and no backfill
needed. Added:

- `InvoiceLineItem` — immutable snapshot lines making up an invoice
  (rent, fees, deposit, tax, discount, later credits/corrections),
  matching the same "signed pricing never changes after the fact" rule
  `RentalAgreement` already follows for its own fields.
- Invoice numbering (`invoiceNumber`, sequential and human-facing,
  separate from the internal `id`), billing-period dates (billing is
  always in advance, per the policy decision above), and a real
  subtotal/discount/tax/late-fee breakdown.
- `Refund` (money refunded from an already-paid invoice) and
  `CustomerCredit` (an account-level credit toward a future invoice) —
  kept as two separate models rather than one, since they're genuinely
  different kinds of money movement with different authorization needs.
  A security deposit's own refund stays on `Deposit` itself (extended
  with who authorized it and why it was partial) rather than becoming a
  third overlapping model.
- `WebhookEvent`, keyed by Stripe's own event id — the standard
  idempotency pattern the work-order asked for, since Stripe's webhook
  delivery is at-least-once and can redeliver the same event.
- `Customer.stripeCustomerId` and `RentalAgreement.stripeSubscriptionId`
  / `nextBillingDate` — one Stripe object per Appliance Desk record,
  never recreated, and the field that actually drives anniversary
  billing (set once when an agreement goes ACTIVE, advanced by one
  cycle each time an invoice is generated for it).

**Deliberately not built yet:** any actual Stripe SDK code, webhook
handlers, or UI. This PR is schema only, so it could be reviewed and
merged without needing a Stripe account or API keys at all — the next
piece of work (Stripe test-mode billing itself) needs Chris to have a
real, free Stripe test-mode account with test API keys before it can
be built and actually tested.

## 2026-09-27 — added HSTS header; reviewed a dependency-audit finding

While the billing work is paused waiting on Chris's Stripe test-mode
keys, did a quick correctness/security pass per `AGENTS.md`'s stated
priority order (correctness & security come before features).

- **Added `Strict-Transport-Security`** to the baseline security
  headers in `next.config.ts` (`max-age=31536000; includeSubDomains`).
  This tells browsers to always use HTTPS for this domain for a full
  year, closing off any plain-HTTP downgrade attempt. Safe to add now
  that a real custom domain with SSL (`robinsonappliancerentals.com`)
  is live — adding it before a real domain existed would have had
  nothing meaningful to protect.
- **Reviewed `npm audit`'s 4 high-severity findings** — all four trace
  back to two transitive dependencies of Prisma's own CLI tooling
  (`mysql2` and `deepmerge-ts`), not to anything this app's own code
  imports. `mysql2` is part of Prisma's multi-database support (MySQL
  introspection/migration) — this app only ever connects to Postgres
  (Neon), so the vulnerable code path (a malicious/compromised MySQL
  server sending a crafted auth downgrade or a decompression bomb) is
  never reachable here. `npm audit`'s suggested fix is a downgrade to
  an older major version of Prisma (6.19.3), which would be a real step
  backwards for an unrelated, unreachable issue — not a safe or
  sensible fix to apply blindly. **Decision: leave as-is, revisit when
  Prisma ships a patched 7.x/8.x release** (checked via
  `npm outdated` — Prisma 8.0.0-rc.17 exists but is a release
  candidate, not yet something to move production onto).

## 2026-09-27 — Stripe test-mode API keys added (Phase 6B unblocked)

Chris created a Stripe account (test mode) and provided the test-mode
secret key and publishable key. Both are now set as real Vercel
environment variables on the `appliance-desk` project (Production,
Preview, and Development): `STRIPE_SECRET_KEY` (stored as a Vercel
"sensitive" variable — can't be read back by anyone, including future
AI sessions, once set) and `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (stored
as a plain variable, since a publishable key is designed to be exposed
client-side). Both keys start with `_test_`, confirming test mode, not
live payments — going live remains a separate, explicit decision per
`AGENTS.md`.

This unblocks the real next step in Phase 6B: building the actual
Stripe SDK integration (customer/subscription creation, invoice
generation on each `nextBillingDate`, webhook handling with the
`WebhookEvent` table already in the schema) against Stripe's test-mode
sandbox.

## 2026-09-27 — Phase 6B Stripe billing integration built

Built the full billing engine described in `docs/ARCHITECTURE.md`'s
new "Payments (Stripe)" section: Stripe Checkout right after an
agreement is signed, webhook-driven `Invoice`/`Payment`/`Deposit`
writes (never written speculatively — only once Stripe itself confirms
the money moved), and a hosted Billing Portal for customers to manage
their own card/ACH details. Desk-wide (`/desk/billing`) and per-customer
(`/account/billing`) invoice views were added.

A few decisions worth recording:

- **Checkout + Billing Portal (hosted), not Stripe Elements** — required
  by `docs/BUSINESS-RULES.md`'s existing billing rules ("card details
  never touch our own servers"), so this wasn't a new choice, just the
  one the business rules already required.
- **Webhook idempotency is check-then-act-then-record, not record-then-act**
  — the `WebhookEvent` row is only written *after* a handler succeeds.
  Writing it up front would mean a handler that crashes partway through
  gets marked "done" anyway, silently swallowing Stripe's automatic
  retry of that same event — the one real mechanism that fixes a
  transient failure. Accepted tradeoff: two deliveries of the exact same
  event arriving within milliseconds of each other could both start
  processing before either finishes; each handler's own database
  constraints (a unique `stripeInvoiceId`, an existing-`Deposit` check)
  still catch that rare case.
- **`stripe` npm package installed at v22.6.2** (current major at the
  time) — its TypeScript types reflect a real, recent Stripe API
  restructuring: `Invoice.subscription`/`Invoice.payment_intent` moved
  to `invoice.parent.subscription_details.subscription` and
  `invoice.payments.data[].payment.payment_intent`, `Invoice.tax` was
  replaced by an `Invoice.total_taxes` array, and `Charge.invoice` was
  removed entirely (a refund is now traced back to our own `Invoice` row
  via the `Payment.stripePaymentIntentId` we already store, not via the
  charge itself). All of this is handled in
  `src/domains/billing/webhooks.ts`'s `extractSubscriptionId` /
  `extractPaymentIntentId` / `extractTaxCents` helpers — documented here
  so a future session reading an older Stripe guide/example online isn't
  confused by the mismatch.
- **Automated late fees / dunning were deliberately not built** in this
  pass — see `docs/ROADMAP.md`. `invoice.payment_failed` is recorded (a
  DELINQUENT invoice, visible at `/desk/billing`) but nothing escalates
  automatically yet.

**One manual step only Chris can do, once this is deployed**: register
the webhook endpoint in Stripe's dashboard and set `STRIPE_WEBHOOK_SECRET`
in Vercel — exact steps in `docs/ARCHITECTURE.md`'s "Payments (Stripe)"
section. Until then the webhook route returns HTTP 503 by design, rather
than accepting unverified requests.

## 2026-09-27 — Security review (Phase 7)

Full review of auth/authorization, secrets handling, input validation,
rate limiting, webhook hardening, error-message disclosure, and session/
cookie config. Overall the app held up well — no critical issues.

- **Fixed: `/sign/[id]`'s signing action had no rate limiting.** It's a
  public, unauthenticated POST endpoint (same threat model as the
  contact form, which already had this), and every attempt does real
  work (a database transaction, plus a Stripe Checkout Session creation
  on success). Added the same per-IP throttle pattern
  (`src/lib/rate-limit.ts`) already used on the contact form — 10
  attempts / 10 minutes / IP, generous enough that a real customer
  retrying a typo never hits it.
- **Reviewed, accepted as low priority: a couple of desk (OWNER/ADMIN-
  only) server actions let Prisma's own generic "record not found"
  message pass through to the client** (via `findUniqueOrThrow` +
  `error instanceof Error ? error.message : ...`) instead of a
  hand-written friendly message. Not sensitive (no SQL/stack/paths,
  Prisma's own wording), and only reachable by Chris himself — not worth
  the risk of a broad refactor across every action file for a cosmetic
  issue. Revisit if a customer-facing action ever grows the same
  pattern.
- **Confirmed everything else already solid**: every `/desk/**` server
  action calls `requireRole`, every `/account/**` page/action derives
  the customer from the signed-in session server-side rather than a
  client-supplied id (no IDOR found), no hardcoded secrets in source,
  every server action validates with zod before touching the database,
  the Stripe webhook verifies its signature before doing anything else
  and never leaks raw errors, and Better Auth's session/cookie config
  (14-day session, rolling refresh, `role` field not client-settable,
  10-char minimum password) is sound.
- **Decision point for Chris, not changed here**: `requireEmailVerification`
  is currently `false` in `src/lib/auth.ts`, with an inline comment to
  flip it on "once email sending is verified in production" —
  `robinsonappliancerentals.com` is now fully DKIM-verified in Resend
  (confirmed 2026-09-27), so that condition is met. Not flipped
  automatically here since it changes real customer-facing signup
  behavior (a new customer would have to click a verification email
  before they could log in) — Chris's call on timing, not an automatic
  "now it's technically possible" decision.

## 2026-09-27 — Received a second design review (from OpenAI's "Astra"), not yet acted on

Chris ran his own separate evaluation of the live site using an OpenAI
tool ("Astra") and shared its output: a 292-line rebrand + redesign
brief, saved verbatim at
`docs/reviews/2026-09-28-astra-redesign-brief.md`. It is thorough and
mostly well-reasoned, but it is a proposal from another AI reviewing a
live site from the outside — not a set of decisions Chris has made — and
it's large enough (new brand colors/logo, new business lines, pricing
model changes, full IA rebuild) that implementing it wholesale without
Chris's sign-off would risk real cost and rework. Treating it the same
way as the earlier in-house design review: read it, compare it against
what's actually built (not just what the brief assumes), and bring
Chris specific decisions rather than just building all of it.

Two things worth flagging for whoever picks this up:
- It reviewed **production**, which does not yet include PR #39
  (brand-consistency retint + owner-desk sidebar nav, merged/unmerged
  status as of whenever you're reading this) — some of its "problems to
  resolve first" may already be addressed there. Check PR #39's status
  before assuming a listed problem is still open.
- Its proposed color palette (navy `#17324D` / teal `#006B66`) is a
  **full rebrand away from** the warm terracotta/canvas palette already
  live on the site and just reinforced in PR #39 — this is a real
  business decision (new logo, new look everywhere), not a bug fix, and
  needs Chris to actually choose it before any code changes.

## 2026-09-27 — Rebrand approved: navy/teal palette from the Astra brief

Chris looked at the real preview deployment (PR #41,
`ai/claude/astra-brand-preview`) side by side with the warm palette on
production and said he likes it — "I like the re-design. Continue."
This makes the navy/teal palette from `docs/reviews/2026-09-28-astra-
redesign-brief.md` the real brand going forward. Landed by turning the
PREVIEW-ONLY branch into a real one (removed the "do not merge"
framing from its comments, no functional change) — see
`docs/DESIGN-SYSTEM.md`'s "Brand palette: navy/teal" section for what
this does and doesn't cover yet (no logo, no IA/portal rebuild).

## 2026-09-27 — A friend's "complete rebuild" proposal, assessed and mostly declined

Chris shared a write-up from a friend proposing to rebuild Robinson
Appliance Rentals as "a complete operating platform" — saved verbatim
at `docs/reviews/2026-09-27-friend-full-rebuild-proposal.md`.

**Checked against what's actually built** (not what the proposal
assumes) before responding to Chris, the same way the Astra brief was
handled. Most of it already exists and works today:

- Online rent flow, rental agreement + typed e-signature, Stripe
  monthly recurring billing, delivery scheduling — Phases 4/5/6B.
- The customer portal already has every item on the proposal's list
  (current rental, next payment, payment history/receipts, agreement
  download, service/replacement/pickup requests, upcoming
  appointments) — Phase 5.
- Appliance inventory already tracks unit number, brand/model/serial,
  purchase date/cost, condition, status, current customer/location,
  and full rental/service history — Phase 3, extended 2026-09-26.
- Service/repair requests, lead tracking with source and conversion
  status, and property-manager accounts with multiple properties — all
  built (property managers as of earlier today, see the "Property
  managers / portfolio accounts" entry above).
- **One clear mismatch, worth flagging**: the proposal specifies Clerk
  for staff login. This app uses Better Auth, not Clerk, and always
  has — a sign this write-up was a generic pitch, not an assessment of
  the actual running code.

**Genuinely new, not built anywhere yet** — the real value in this
proposal:
1. QR codes on physical appliances (scan for delivery/pickup
   verification, and for a customer to self-serve a service request
   without knowing their model/serial).
2. Appliance-level profitability/ROI (revenue vs. purchase cost vs.
   repair cost, payback date, utilization) — the raw numbers
   (`acquisitionCostCents`, rental history, no repair-cost field yet)
   are partly there, the rollup/calculation isn't.
3. An MRR/ARR financial dashboard with trends, churn, and past-due
   totals — today's `/desk/dashboard` shows current counts, not
   recurring-revenue math over time.
4. Fleet-wide utilization analytics (% of fleet earning vs. idle vs.
   in repair, most/least utilized, highest-repair-cost units).
5. Formal B2B invoicing for property managers (today's property-
   manager support is account/address structure, not consolidated
   multi-property billing).

**Not recommended: a full rebuild.** Redoing what's already built and
tested (real Stripe billing, e-signature, a working customer portal)
to get four or five new features is a large, risky, mostly-duplicative
undertaking — the honest, lower-risk path is building the new pieces
into what exists, the same incremental way every other addition this
project has gotten has worked. Told Chris this plainly and asked which
of the five new pieces (if any) he wants built next, rather than
starting on all of it unasked.

## 2026-09-27 — A third Astra review ("upgrade to a connected workspace"), fact-checked against the real code

Chris shared a third message from ChatGPT/"Astra" (he'd first sent a
`chatgpt.com/s/...` share link, which couldn't be fetched — the page is
JavaScript-rendered and no browser tool was available in this session — so
he pasted the text instead). Saved verbatim at
`docs/reviews/2026-09-27-astra-workspace-review.md`. This is the most
ambitious of the three reviews this session: it proposes turning Appliance
Desk into "a connected workspace" built around a unified customer
workspace, a guided rental-builder wizard, richer appliance records, a
real dispatch board, an "exception inbox," a set of cross-cutting tools
(global search, saved views, bulk actions, CSV import/export, activity
history, permissions), an owner configuration center, an automation-rules
engine, and a list of software-quality standards. It's upfront that it
hasn't audited the backend and says to verify what already works before
replacing anything — good instinct, so that's what I did before answering
Chris.

**What I checked against the actual code, not just the pitch:**

- *"Two people cannot accidentally reserve the same appliance."* **True,
  already solved.** `src/domains/agreements/index.ts` uses an atomic
  `updateMany({ where: { status: "AVAILABLE" } })` check-and-reserve — the
  database itself decides who wins a race, not a read-then-write check
  that two simultaneous requests could both pass. The code comment even
  references a past "Verified Finding #3 fix," meaning this exact concern
  was already identified and hardened before this session.
- *"Customer data remains isolated."* **True, and tested** —
  `tests/customer-isolation.test.ts` exists and exercises this.
- *"Light and dark modes work across every screen."* **Already true.**
  Dark mode is real (`src/lib/theme.ts`, a `.dark` class toggled on
  `<html>`, color values driven by CSS custom properties so most
  components pick it up automatically without individual `dark:` classes
  — that's why grepping for `dark:` undercounted it at first). Not
  something this review's proposal would be adding; it already shipped.
- *"Conflicting edits do not silently overwrite each other."* **Not
  true yet, and this is a real gap.** Every model has a plain
  `updatedAt @updatedAt` timestamp, but nothing checks it before a write
  — there's no optimistic-concurrency guard. In practice this rarely
  bites Chris today (he's the only person editing most records), but if
  he adds any second user, or a customer and Chris both act on the same
  record close together, the second save can quietly clobber the first
  with no warning. Worth fixing before adding more staff/portal write
  paths, not urgent today.
- *"Backups can actually be restored."* **Partly true, not fully
  verified.** Neon's point-in-time-restore exists and is configured
  (rolling 6-hour window plus snapshots, per the entry above) — the
  capability is real. Whether a full restore has actually been tested
  end-to-end (not just that the feature exists) hasn't been done. Worth
  a real drill before this matters for real customer data.
- Global search, saved views, bulk actions, CSV import/export, an
  automation-rules engine, a formal "exception inbox" as its own concept,
  and a viewable audit-trail UI (the audit log itself is real and used
  everywhere — `auditLog.create` calls exist in every domain — but there
  is no screen that lets Chris browse it): **none of these exist today.**
  These are the review's genuinely new, substantial proposals.
- The "exception inbox" idea specifically overlaps with signals that
  already exist scattered across the app (stale-reservation detection,
  past-due invoices, failed payments — all feed today's dashboard as
  separate stat cards) but there's no unified, actionable list — that's
  a real and fairly cheap win: mostly wiring existing detection logic
  into one page rather than inventing new detection.

**Assessment:** this review is honest about not having audited the
backend, and it's right to say so — several of the concerns it raises as
open questions ("can backups be restored," "do conflicting edits
overwrite") turned out to be exactly the kind of thing that's easy to
assume is fine and isn't fully verified. But most of its "software
quality standard" list turned out to already be true (concurrency-safe
reservations, tested data isolation, working dark mode), which matters
for a report to Chris: the honest picture is "several specific things you
should verify or fix" plus "several big, genuinely new feature areas to
choose from" — not "the app is thin and needs replacing," which isn't
what the code shows.

**Scope reality check:** the nine numbered areas in the review each
describe a substantial feature on their own (a unified customer
workspace with timeline/notes/documents; a guided multi-step rental
wizard with draft-saving; a real drag-and-drop dispatch board; a global
search index; an automation-rules engine with run history and an off
switch). Building all of it is a multi-month undertaking, not a single
PR, and Chris runs this business solo today — some of the proposal (staff
roles/approval limits, multi-employee dispatch assignment) is explicitly
aimed at a team he doesn't have yet. Rather than build any of it unasked,
I'm bringing this to Chris to pick where to start, per `AGENTS.md`'s
guidance to ask before large/costly/ambiguous work.

## 2026-09-27 — A fourth Astra message was an actual code review, and found three real billing bugs — fixed

Unlike the first three Astra messages this session (screen-based pitches),
this fourth one says it read the real repository at commit `872b980`
(`main` after PR #45) and reports specific, line-and-behavior-level
findings rather than a general redesign pitch. Saved verbatim at
`docs/reviews/2026-09-27-astra-code-review.md`. Because this one claims
to be about the actual code and touches real money, I verified every
"Urgent"/"High" claim against the code myself (reading the exact
functions, not taking the report's word) before deciding what to do.

**Three "Urgent" findings were real bugs — confirmed, then fixed:**

1. **A successful retry after a failed payment could stay marked unpaid
   forever.** `handleInvoicePaid` (in `src/domains/billing/webhooks.ts`)
   skipped recording anything whenever an `Invoice` row already existed
   for that Stripe invoice id — including one created by
   `handleInvoicePaymentFailed` and still sitting at `DELINQUENT`. Stripe
   reuses the same invoice id across a failed attempt and a later
   successful retry, so a customer who paid successfully after an initial
   card decline (or a retried ACH debit) would never have that shown —
   Chris would keep seeing them as delinquent even though Stripe had the
   money. **Fixed**: `handleInvoicePaid` now checks the existing invoice's
   *status*, not just whether a row exists — a genuinely-already-`PAID`
   invoice (the real duplicate-delivery case webhook retries are supposed
   to short-circuit) is still skipped, but a `DELINQUENT` one is updated
   in place to `PAID`, given its real line items, and gets a new
   `succeeded` Payment row alongside the earlier `failed` one — an honest
   record of what actually happened, not a rewrite of history. Covered by
   a new test in `tests/billing-webhooks.test.ts`.
2. **Checkout completion was recorded as a successful payment without
   checking whether the money had actually settled.** Stripe fires
   `checkout.session.completed` the moment the customer finishes the
   Checkout flow — for an instant method (card) that's also when the
   money moves, but for the delayed-settlement method this app also
   offers (ACH bank transfer, per `docs/BUSINESS-RULES.md`), the actual
   debit can take days to clear and can still fail after this event
   fires. `handleCheckoutSessionCompleted` called `recordPaidInvoice`
   (marking the invoice `PAID` in our database) regardless, which could
   show a pending — or later-failed — bank payment as paid immediately.
   **Fixed**: it now checks Stripe's own `invoice.status` first and only
   records anything if Stripe itself already considers the invoice paid;
   otherwise it does nothing and waits for `invoice.paid` (once the ACH
   debit actually clears) or `invoice.payment_failed` to say what really
   happened — which is Stripe's own documented pattern for delayed
   payment methods, and exactly what the review pointed to. Covered by
   two new tests (a pending ACH invoice recording nothing at checkout,
   then getting recorded once `invoice.paid` fires for real).
3. **Ending or cancelling an agreement never told Stripe to stop
   billing.** `closeAgreement` (shared by `endAgreement`/
   `cancelAgreement` in `src/domains/agreements/index.ts`) updated only
   our own database — freeing appliances, marking the agreement
   `ENDED`/`CANCELLED` — and never called Stripe at all. A customer Chris
   considered done with could keep being billed monthly on the still-live
   Stripe subscription until he noticed and cancelled it by hand in the
   Stripe dashboard. **Fixed**: `closeAgreement` now calls
   `stripe.subscriptions.cancel(...)` first, before touching any local
   record — if that fails for a real reason (Stripe unreachable, etc.)
   the whole close is blocked rather than telling Chris an agreement is
   "ended" while it might still be billing; if Stripe says the
   subscription is already gone (`resource_missing` — e.g. the
   `customer.subscription.deleted` webhook for it already ran), that's
   treated as success, not an error. Covered by four new tests in
   `tests/agreements-close-stripe-subscription.test.ts`.

**Two "High" findings are real code behavior, but were already
deliberate, documented decisions** — not bugs, though the review's
underlying business concern is legitimate and worth Chris weighing:

4. *"Closing an agreement immediately makes its appliances available."*
   True, and it's exactly what `docs/BUSINESS-RULES.md` already
   documents ("Ending or cancelling an agreement frees its appliances
   back to [AVAILABLE]"). The real-world risk the review names is fair
   though: if Chris clicks "end agreement" before he's actually picked
   the appliance up, it could get assigned to a new customer while still
   sitting at the old customer's house. Not fixed here — this is a
   product decision (add a "returned, awaiting pickup/inspection" status
   in between) that changes a documented workflow, not a silent defect.
5. *"Signing immediately starts the agreement and marks appliances
   rented."* Also true, and also already documented (`docs/BUSINESS-
   RULES.md`: "Signing moves the agreement to ACTIVE and its assigned
   appliances [to RENTED]... Chris manually schedules the delivery/
   installation Job"). Same situation — a real simplification (signature
   date and actual delivery date are conflated for revenue/analytics
   purposes) that was chosen on purpose, not missed.

**The "High" finding about idempotency is a real, smaller gap, not
fixed here:** `createCheckoutSessionForAgreement` passes no idempotency
key to `stripe.checkout.sessions.create` and doesn't reuse an existing
open session — a double-click or retried request would create a second
Checkout Session rather than reusing the first. Lower severity than the
three above (it doesn't lose or misstate money, it just could hand a
customer two payment links instead of one) — logged in `docs/ROADMAP.md`
rather than fixed in this pass.

**Everything else in the review** (separating agreement/equipment/
billing status into explicit intermediate states, expanding customer
accounts beyond one login, turning Jobs into real dispatch software, an
exception queue, splitting estimated vs. actual revenue in reports,
pagination/background jobs for scale) restates or overlaps ground the
third Astra review already covered this session
(`docs/reviews/2026-09-27-astra-workspace-review.md`) — not repeated
here, tracked together in `docs/ROADMAP.md`.

**Why fixed instead of just logged:** `AGENTS.md` puts correctness ahead
of everything else, and gives standing authority to fix bugs without
asking first (the "ask before anything irreversible or costly" list is
about live payments, purchases, and deleted data — not about correcting
code that mishandles money it's already supposed to be tracking
correctly). These three are squarely bugs in existing, intended billing
behavior, not new features or a live-payments change — Stripe remains in
test mode throughout. Fixed in `ai/claude/astra-workspace-review`
alongside the docs assessment for this session's reviews.

## 2026-09-28 — Rental lifecycle split + billing starts at delivery

Chris said "get everything built out now" (covering everything
documented in `docs/ROADMAP.md`), and specifically confirmed two things
mid-build: **billing should start upon delivery**, and it's fine to use
Vercel's own file storage over Neon for any future file uploads (Neon is
for database records, not files).

This directly fixes the two "already documented, intentional
simplification" items from the same-day code review above (items 4 and
5): signing an agreement no longer marks its appliances `RENTED` or
starts the Stripe Subscription — both now wait for an actual
delivery/installation `Job` to be marked `COMPLETED`. See
`docs/BUSINESS-RULES.md`'s new "Rental lifecycle" section and its
updated "Billing rules" for the full policy; the short version:

- Appliances gained two new statuses, `AWAITING_PICKUP` and
  `AWAITING_INSPECTION`, so "agreement ended" and "machine actually back
  and checked over" are no longer the same moment either — closing the
  item-4 gap from the same review at the same time, since both came from
  the same root cause (too few states between "signed" and "returned").
- Signing a Checkout Session now only charges the one-time deposit/
  damage waiver (if any) and always saves a payment method
  (`Customer.stripeDefaultPaymentMethodId`) for later. The real
  recurring Subscription is created by `startRecurringBillingForAgreement`
  once delivery completes, using that saved payment method. If it can't
  actually start (no payment method yet, a declined card, any Stripe
  problem), that's recorded on `RentalAgreement.billingBlockedReason`
  rather than thrown — the delivery itself must never fail or roll back
  over a billing problem, same principle as the existing "signed but
  Checkout Session failed" handling.
- New `RentalAgreement.billingStartedAt`, set the moment recurring
  billing actually begins. Added specifically because the MRR/ARR
  revenue dashboard (`src/domains/billing/revenue.ts`,
  `getRevenueDashboard`) used to reconstruct "when did this agreement's
  revenue start" from `startDate` (the signing date) — which, now that
  billing can start weeks after signing, would have overstated MRR/ARR
  and the "active rentals"/"active customers" counts for every rental
  sitting signed-but-undelivered. Caught before merge by an independent
  audit pass (a second agent, given no other context, asked to find
  stale assumptions left over from the lifecycle split) rather than by
  a user report.
- That same audit caught a second real gap: `ACTIVE_ASSIGNMENT_WHERE`
  (`src/domains/agreements/active-appliances.ts`) — the one shared
  definition of "this appliance currently belongs to this customer,"
  used by both the customer portal and the owner Desk — only checked
  that the agreement was `ACTIVE`, not that the appliance itself had
  actually been delivered. Left as-is, a customer could have seen an
  undelivered appliance listed as their own rental on `/account`, and
  worse, could have picked it from the dropdown when filing a
  maintenance request against equipment still sitting in Chris's shop.
  Fixed by requiring the appliance's own status be `RENTED` or
  `AWAITING_PICKUP` (i.e. actually, physically with the customer) in
  addition to the agreement being `ACTIVE`.
- Chris also asked that anything like the ACH-payment-failure edge case
  (found in the same-day code review, above) be tracked so it's revisited
  "at the appropriate times" rather than forgotten — that's what the
  exception inbox (next on the build list, `docs/ROADMAP.md`) is for:
  `billingBlockedReason` and similar stuck states are meant to surface
  there with a fix action, not just sit logged in a doc.

**Local sandbox note:** as with every earlier phase touching Prisma
models, `tsc`/`vitest` against the real Prisma client can't run in this
sandbox (see `AGENTS.md`'s "A real constraint" section) — every new/
changed file here was checked against a `git stash` baseline to confirm
no *new* errors were introduced beyond that known, pre-existing noise.
CI (real Postgres) is the actual verification gate for the DB-backed
tests (`tests/billing-webhooks.test.ts`, `tests/inventory.test.ts`).

## 2026-09-28 — Exception inbox + "Today" landing page

Second piece of "get everything built out now" (`docs/ROADMAP.md`'s
build list, item 2 of 12). Built on top of the rental-lifecycle branch
(PR #49), since its centerpiece — `billingBlockedReason` — only exists
there; this PR should merge after (or together with) that one.

Gathers six already-possible-but-easy-to-miss stuck states into one list
(`src/domains/exceptions`) instead of leaving Chris to notice them by
happening to open the right page: billing blocked, an expired
reservation hold, a past-due invoice, an overdue job, an unreviewed
maintenance request, and an appliance sitting uninspected too long. See
`docs/BUSINESS-RULES.md`'s new "The exception inbox and 'Today'"
section for the full list and thresholds.

**Changed where logging in sends Chris**, from `/desk/dashboard` (a
stats page) to the new `/desk/today` (what's scheduled today + what
needs attention) — not something Chris asked for by name, but it's the
direct realization of what he described wanting from this feature
("one place to see anything that needs your attention instead of having
to go hunting for it"), and it's a one-line, easily-reversed routing
change, not a removal of anything — the stats dashboard is still there,
one click away in the nav. Flagged to Chris in the session report rather
than treated as silently obvious.

**A known approximation, documented in code rather than hidden**: "how
long has this appliance been sitting `AWAITING_INSPECTION`" is read off
`Appliance.updatedAt`, which changes on any edit to that row, not only a
status change — good enough to sort a secondary list by roughly how
stale something is, not worth a dedicated timestamp column for. Same
spirit as `computeMrrTrend`'s own documented approximation.

## 2026-09-28 — Customer workspace: notes, contacts, activity timeline

Third piece of "get everything built out now." Adds two new tables
(`CustomerNote`, `CustomerContact`) and a merged activity timeline to a
customer's own Desk page — see `docs/BUSINESS-RULES.md`'s new "Customer
workspace" section.

Notes are deliberately append-only (no edit or delete) — same reasoning
as `AuditLog` itself: a record of what was actually said and when is
more trustworthy than one that can be quietly rewritten later. Contacts
*can* be deleted (people leave a company, a number changes), scoped to
both the contact id and the customer id in the same query so a stale or
tampered form can never delete a different customer's contact.

The activity timeline reads the existing `AuditLog` table back, scoped
to one customer's own history (itself, plus every one of their
agreements/jobs/maintenance requests) rather than one entity at a time
the way every other page reads it — the first place in the app that
does this. An action string it doesn't specifically recognize falls back
to showing the raw string rather than dropping the entry, so a new audit
action added elsewhere never silently disappears from a customer's
timeline.

## 2026-09-28 — Appliance record: guided actions and history

Fourth piece of "get everything built out now." Adds
`src/domains/inventory/guided-actions.ts` — see `docs/BUSINESS-RULES.md`'s
new "Appliance guided actions and history" section for what each one
does and why.

The notable one is **swap**: before this, there was genuinely no way to
reassign an appliance from one active rental line to a different
physical unit short of editing the database by hand — `ApplianceAssignment`
had no reassignment path at all, only assign-at-agreement-creation and
unassign-at-agreement-end. This is the first code in the app that
actually does a mid-rental reassignment, and it does the whole thing
(unassign old, assign new, move both statuses, create the job) in one
`$transaction` so it can't be left half-done.

Every guided action reuses the exact same pure rules from
`src/domains/inventory/lifecycle.ts` that the raw status buttons already
enforce (`canTransitionApplianceStatus`, `applianceStatusAfterInspection`)
rather than re-deciding allowed transitions itself, so a guided action
can never move an appliance somewhere the raw buttons would have
refused.

**Real bug found and fixed while building this**: `getBusinessSettings`'s
`DEFAULT_SETTINGS` fallback (used only if the singleton `BusinessSettings`
row is somehow missing) had never been updated with the
`inspectionChecklist` field added to the schema earlier in this session's
work — so reading `settings.inspectionChecklist` would have broken, in
that fallback case, for every caller, not just this one. The local
sandbox's Prisma-client issue meant this didn't show up until CI's real
type-check caught it (`src/domains/settings/index.ts`); fixed by adding
the missing field to `DEFAULT_SETTINGS`.

## 2026-09-28 — Dispatch board: day/week/agenda, unscheduled queue, conflicts, checklists

Fifth piece of "get everything built out now." Adds `/desk/dispatch` —
see `docs/BUSINESS-RULES.md`'s new "Dispatch board" section for what it
shows and why.

**Conflict detection is deliberately approximate**, the same spirit as
the `Appliance.updatedAt`-as-staleness approximation noted above and
`computeMrrTrend`'s own documented one: jobs don't record how long a
visit actually takes, so a single assumed duration
(`ASSUMED_JOB_DURATION_MINUTES = 120` in `src/domains/jobs/dispatch.ts`)
stands in for a real duration field. Good enough to warn Chris he's
likely double-booked, not worth asking him to estimate a duration for
every job just to make this one warning slightly more precise.

Added `Job.checklist` (JSONB, same shape and same
default-then-persist pattern as `ApplianceInspection.checklist` from the
guided-actions work above) — `DEFAULT_JOB_CHECKLISTS` in
`src/domains/jobs/checklist.ts` is a pure per-`JobType` lookup, parsed
defensively (`parseChecklist`) the same way `featuresToText` and
`parseServiceArea` defensively narrow their own JSONB columns elsewhere
in the app. Saving a checklist has no status gate at all — it's
explicitly not a completion requirement, just a memory aid, so there's
nothing to validate beyond "is this shaped like a checklist."

## 2026-09-28 — Guided rental builder wizard

Sixth piece of "get everything built out now." Replaces
`/desk/agreements/new`'s single form with a 4-step wizard — see
`docs/BUSINESS-RULES.md`'s new "Guided rental builder wizard" section.

Deliberately **not** a new agreement-creation code path: every step
calls the same `createDraftAgreementAction` / `addRentalLineAction` /
`sendForSignatureAction` the old two-page flow already called (both are
already well-tested — `tests/agreements.test.ts` and friends). Only the
UI sequencing is new, which keeps the actual risk surface of this
change small.

**`createCustomerDirectly` now also returns the `ServiceAddress` rows it
just created** (previously only the `Customer` row), so the wizard's
inline "new customer" step can move straight to picking that customer's
new address for the agreement without a second lookup. Purely additive
— every existing caller of `createCustomerDirectly`/`createCustomerAction`
ignores the new field, so nothing about the existing "add a customer"
page changed.

## 2026-09-28 — Cross-cutting desk tools

Seventh piece of "get everything built out now" — see
`docs/BUSINESS-RULES.md`'s new "Cross-cutting desk tools" section for
what this covers (global search, pagination, CSV export, bulk status
actions) and what was deliberately left out (CSV import, a separate
saved-views feature).

Implementation notes:
- Pagination math lives in one pure file (`src/domains/pagination.ts`,
  `parsePage`/`paginationMeta`) shared by every paginated list, paired
  with one shared `<Pagination>` component
  (`src/components/pagination.tsx`) — same split as the rest of the
  app's pure-logic/UI separation.
- Each paginated domain (customers, inventory, jobs, activity) got a
  *new* `getXCount`/`getXPage` pair sitting alongside its existing
  unpaginated lookup, rather than changing that lookup's signature —
  several callers (the rental wizard's pickers, the job form) still
  need the full unfiltered list and shouldn't have to pass a page
  number they don't care about.
- CSV writing is a small hand-rolled RFC-4180-ish writer
  (`src/lib/csv.ts`) rather than a dependency — quoting only a field
  that actually needs it (comma/quote/newline), doubled inner quotes,
  CRLF line endings. Export routes always return the *complete*
  matching list, never just the current on-screen page.
- Bulk status change (`bulkUpdateApplianceStatus`) deliberately loops
  and reuses the existing single-appliance `updateApplianceStatus` per
  item instead of one all-or-nothing transaction, so a selection that
  mixes valid and invalid transitions still applies everywhere it can
  and reports back exactly what didn't, instead of failing the whole
  batch over one bad row.
- Global search (`src/domains/search`) runs its three lookups
  (customers/appliances/leads) in parallel via `Promise.all`, capped
  at 8 results each, and short-circuits on a blank query rather than
  running three pointless queries.

## 2026-09-28 — Reports: actual vs. estimated earnings, missing-cost warnings

Eighth piece of "get everything built out now" — see
`docs/BUSINESS-RULES.md`'s new "Reports" section.

New `/desk/reports` page and `src/domains/reports/` (pure math in
`earnings.ts`, same split as `src/domains/inventory/analytics.ts`),
plus a new exception-inbox category, `MISSING_REPAIR_COST`
(`src/domains/exceptions`), for completed `MAINTENANCE_VISIT` jobs with
no parts/labor cost logged — those already silently counted as $0
repair cost in fleet profitability; this makes that fact visible in two
places (the Reports page and `/desk/today`) instead of nowhere.

Deliberately reused the existing MRR-trend proration convention
(days-since-`billingStartedAt`, 30-day month) for "estimated earnings"
rather than inventing a new one, so the Reports page's numbers are
consistent with what the Revenue page already shows — two different
reconstructions of the same underlying agreed-pricing data would be
confusing to reconcile against each other.

The $10 "notable gap" threshold on the Reports page is deliberately
simple and low, same spirit as the exception inbox's own thresholds
(`UNREVIEWED_MAINTENANCE_REQUEST_DAYS`, `UNINSPECTED_RETURN_DAYS`) —
a number Chris could recite back, not a statistically tuned cutoff.

## 2026-09-28 — Growth signals: churn risk, win-back, price review, fleet flags, local pages

Ninth piece of "get everything built out now" — picks up a subset of
`docs/reviews/2026-09-27-business-growth-ideas.md`'s brainstorm. See
`docs/BUSINESS-RULES.md`'s new "Growth signals" section for the full
list of what's included and, just as importantly, what was left out and
why.

New `/desk/growth` page and `src/domains/growth/` (pure scoring in
`churn.ts` and `signals.ts`, same split as lead scoring and the
exception inbox), plus a new public route, `/rent/[city]` — one real
page per city actually listed in Settings' service area, never a
fabricated one.

Deliberately did **not** build the brainstorm's automatic review/
referral-request email — an email fired automatically at a set
milestone is a customer-facing action Chris hasn't explicitly signed
off on sending unattended, which is exactly the spirit of `AGENTS.md`'s
"ask before anything irreversible or costly." Built the useful half
instead: a list of who's a good candidate to ask, refreshed from real
billing data, that Chris acts on himself. Also deliberately left out the
brainstorm's bigger, separate-schema, or paid ideas (a formal referral
program, SMS notifications, a separate Contacts concept, an accounting
export, the driver mobile job view) — each is substantial enough to be
its own future piece, not something to fold in here.

Churn-risk and fleet-utilization-flag thresholds (a $20-point at-risk
score, 3+ units before a utilization flag means anything, a year before
a price review is "due") are all deliberately simple, explainable
numbers — same "no AI/ML, no hidden math" standard as lead scoring
(`docs/BUSINESS-RULES.md`'s Lead scoring section) — not statistically
tuned cutoffs.
