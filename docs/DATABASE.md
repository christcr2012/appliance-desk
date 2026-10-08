# Database â€” plain-English guide

The full technical definition lives in `prisma/schema.prisma`. This file
explains *why* each table exists, in order, for whoever picks this up
next (human or AI). Money is always stored as **integer cents** (never a
decimal/float) â€” see `docs/BUSINESS-RULES.md`. Every timestamp is stored
in UTC and only converted to Mountain Time for display.

## Local isolated test database

Use `bash scripts/local-postgres-test.sh tests/<spec>.test.ts` for relevant
money, tax, schema, concurrency and authorization tests. The Vercel Sandbox
has PostgreSQL 18 binaries at `/usr/lib/postgresql/18/bin` (outside PATH).
The launcher creates a **new 127.0.0.1-only** `appliance_desk_test`, runs
migrations and test-only seeding, executes Vitest with `CI=true`, then stops
and removes only its temporary cluster. See [PLAYBOOK Â§4b](PLAYBOOK.md#4b-local-real-postgresql-tests-in-a-vercel-sandbox).
Never use Neon, Vercel preview or production data; CI's PostgreSQL 17 suite
is the final merge authority.

## Auth & people

- **User** â€” anyone who can log in: Chris (`OWNER`), any staff he adds
  later (`ADMIN`), or a customer (`CUSTOMER`). `role` decides what they
  can reach.
- **Session / Account / Verification** â€” Better Auth's own bookkeeping
  tables (login sessions, the hashed password record, email
  verification/reset tokens). Not hand-queried by app code.
- **Customer** â€” the business-side profile attached to a `CUSTOMER`
  user: phone, whether they're a b¶»§q«^