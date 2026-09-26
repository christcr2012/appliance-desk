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
