# Decisions log

Dated, one entry per decision, newest first. If you reverse a decision
here, add a new entry rather than editing the old one away.

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
