# PLAYBOOK — how to deliver one batch, step by step

Follow these steps in order. Each step says what to do, what "done" looks
like, and what to do if it fails. The rules behind the steps are in
`AGENTS.md`; the work itself is in `docs/PLAN.md`.

## Step 0 — Orient (every session, ~10 minutes)

1. Read `AGENTS.md`, `docs/START-HERE.md`, `docs/STATUS.md`.
2. In `docs/STATUS.md`, find the row marked **NEXT**. That is your batch.
   If a row is **IN PROGRESS** with a branch name, continue that branch
   instead of starting over — check it out and read its latest commits.
3. Read that batch's section in `docs/PLAN.md` end to end.
4. Read the batch's design, `docs/designs/BATCH-<X>.md`, end to end, and
   run every check in its "Verify before starting" table. **If the design
   is missing, marked DRAFT, or any check is false: stop and report.** You
   do not implement without an approved design (`docs/designs/README.md`).
5. Open only the reference docs the batch section and the design list.
6. Sync: `git fetch origin && git checkout main && git pull --ff-only`.
7. Check for open PRs (`gh pr list`). Do not duplicate work that is open.

Done when: you can say in eight lines what the batch delivers, how it will
be accepted, and which existing files you will touch.

## Step 1 — Branch

```bash
git checkout -b ai/<tool>/<batch-topic>     # e.g. ai/codex/batch-b-billing
```

Branch from `main`. If `docs/STATUS.md` says your batch depends on an
unmerged PR, branch from that PR's branch and note it in the PR description;
retarget to `main` once the predecessor merges.

## Step 2 — Before writing code: inventory what exists

The batches build on a lot of shipped work. For each item in the batch:

1. `grep` the domain (`src/domains/<name>/`), its actions, and its tests.
2. Read `docs/BUSINESS-RULES.md` for every rule the item touches.
3. Check `docs/reviews/2026-10-01-review-reconciliation.md` and the audit
   report the item cites for findings in this area; list the ones you will
   fix in this batch.
4. Check `docs/OWNER-INPUTS.md` for any decision the item depends on. If it
   is "Awaiting Chris", build everything that does not depend on the answer,
   keep the dependent behavior off, and list the ID in your report.

Do not rebuild what exists. Reuse domain actions, validators, components and
test fixtures. If an existing implementation is wrong, fix it in place.

## Step 3 — Implement in ordered commits

**The design's work units are the commit order.** One work unit = one
commit, named `WU-<X><n>: <name>`. Inside a work unit, order the changes as
below. Do not re-decide anything in the design's "Decisions" section; when
the design is silent on something that matters, stop and ask (its
"Stop-and-ask" list) instead of inventing.

Within a work unit, order the work so a reviewer can read it:

1. Schema/migration (additive only) + `docs/DATABASE.md` + backup/schema-health
   coverage for new tables or columns.
2. Domain logic + its unit/integration tests (same commit as the logic).
3. Server actions / API routes + permission tests.
4. UI + one browser flow if the batch requires it.
5. Docs: `docs/BUSINESS-RULES.md` if a rule changed, `docs/DECISIONS.md`
   entry for each design decision, `docs/STATUS.md`.

Rules while implementing:

- Write the test with the code. A domain change without its test update is
  not a commit.
- Any write that reads state and then changes it runs in a transaction that
  locks the row first and uses `assertActiveTeamActor` for staff actions.
  Copy the pattern from an existing domain (for example `src/domains/tasks`).
- Money in integer cents through existing calculation functions. Times UTC
  in storage, America/Denver in display.
- No mock data, no stub returning "success", no TODO as implementation.
- Roles filtered at the query/DTO boundary.
- New browser spec files go into the lightest group in `e2e/shards.json`.

## Step 4 — Verify locally before any push

Local verification takes ~5 minutes to set up and routinely catches failures
that would cost a 5-minute CI run each (and GitHub shows only the first 10
failures per step, so one CI run rarely shows them all).

### 4a. Fast checks (every time)

```bash
npm run typecheck
npm run lint
npx vitest run <tests you touched>
```

### 4b. Full unit/integration suite on a throwaway Postgres

If your sandbox can reach the internet normally, `npm install` and
`npm run db:migrate:deploy` work and you can skip to "Run" below with a local
Postgres. If `prisma generate` fails with a 403 from `binaries.prisma.sh`,
use this approved workaround (Chris, 2026-10-02). It only ever touches a
local throwaway database.

```bash
# 1. Install without the postinstall that hits the 403
npm ci --ignore-scripts

# 2. Generate the Prisma client with a placeholder engine (writes only to node_modules)
printf '#!/bin/sh\nexit 1\n' > /tmp/fake-engine && chmod +x /tmp/fake-engine
DATABASE_URL=postgresql://test:test@localhost:5432/x \
DIRECT_URL=postgresql://test:test@localhost:5432/x \
PRISMA_SCHEMA_ENGINE_BINARY=/tmp/fake-engine npx prisma generate

# 3. Start a throwaway Postgres and load the schema by hand
#    (prisma migrate really does need the blocked engine, so apply the SQL directly)
mkdir /tmp/pgdata && chown postgres /tmp/pgdata     # NOT inside a /tmp/claude-* dir
B=/usr/lib/postgresql/16/bin
su postgres -c "$B/initdb -D /tmp/pgdata -A trust"
su postgres -c "$B/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp' -l /tmp/pg.log start"
psql -h localhost -U postgres -c "create role test superuser login password 'test'"
psql -h localhost -U postgres -c "create database appliance_desk_test owner test"
for d in $(ls -d prisma/migrations/*/ | sort); do
  [ -f $d/migration.sql ] && PGPASSWORD=test psql -q -v ON_ERROR_STOP=1 \
    -h localhost -U test -d appliance_desk_test -f $d/migration.sql
done

# 4. Export the same environment CI uses (copy the `env:` block of the
#    `database` job in .github/workflows/ci.yml), then seed and run
export DATABASE_URL=postgresql://test:test@localhost:5432/appliance_desk_test
export DIRECT_URL=$DATABASE_URL
export BETTER_AUTH_SECRET=ci-test-secret-not-for-production-use-only
export BETTER_AUTH_URL=http://localhost:3000 NEXT_PUBLIC_APP_URL=http://localhost:3000
export OWNER_EMAIL=ci-owner@example.test OWNER_PASSWORD='Ci-Test-Owner-Password-Not-Real-1!'
export TEST_CUSTOMER_EMAIL=ci-customer@example.test TEST_CUSTOMER_PASSWORD='Ci-Test-Customer-Password-Not-Real-1!'
export TEST_STAFF_EMAIL=ci-staff@example.test TEST_STAFF_PASSWORD='Ci-Test-Staff-Password-Not-Real-1!'
export CI=true
npm run db:seed
npx vitest run
```

Expect every test to pass. Rules: throwaway local database only (never Neon
or production); never commit the placeholder engine or the generated client;
`prisma migrate deploy`, the migration-upgrade drill and the schema-health
drill stay CI-only.

### 4c. Browser tests (when you changed UI or a spec)

`npm run build && npx playwright test <changed specs>` if the sandbox can
install a browser. If it cannot, say so in the PR: CI is the first real run
of that spec and it may need one follow-up fix.

### 4d. Shard assignment

`node scripts/e2e-shard.mjs --check` — must print OK.

Done when: typecheck clean, lint clean, full vitest green locally, shard
check OK.

## Step 5 — Review continuity

1. If the batch touches billing, Stripe, webhooks, auth/session, email/SMS,
   public forms or preview/runtime safety: re-read
   `docs/AI-PR-READ-FIRST.md` and write one line per applicable constraint
   saying how the batch honors it. This goes in the PR description.
2. For every review finding or audit item you addressed, write its
   disposition (fixed / already fixed / superseded / still open) with the
   evidence. This also goes in the PR description.

## Step 6 — Update docs, then push once

1. `docs/STATUS.md`: batch row → IN REVIEW, with branch, PR, head SHA.
2. `docs/DECISIONS.md`: one dated entry per design decision made.
3. `docs/ROADMAP.md`: anything out of scope you noticed.
4. `docs/OWNER-INPUTS.md`: any new decision Chris needs (new ID) or any
   answer applied (status updated).
5. Commit, then **push once**. Each extra push cancels the running CI and
   bills the partial run.

## Step 7 — Open the PR

Title: `<type>: <plain description>` (feat/fix/docs/ci/test).

Description, in this order, in plain English:

1. **What this batch delivers** — for Chris. What he can now do that he
   couldn't.
2. **Acceptance checklist** — the batch's list from `docs/PLAN.md`, each
   item checked with its evidence (test file names, CI run id, preview URL).
   Unchecked items say why.
3. **Owner decisions needed** — `IN-xx` IDs, or "none".
4. **Review continuity** — the lines from Step 5.
5. **What is NOT in this PR** — anything deferred, with where it is tracked.

## Step 8 — CI

Wait for the `ci` check. If it fails:

1. Read the failures: `gh api repos/<owner>/<repo>/check-runs/<job_id>/annotations`
   (raw logs and the HTML report are often unreachable from sandboxes;
   annotations always are). Browser shards also print per-file durations.
2. Reproduce locally (Step 4). Fix every failure, not just the first ten.
3. Push once.

Never weaken an assertion, skip a test, or delete a check to get green.

## Step 9 — Preview

Vercel builds a preview for every PR. Open it and click through the flow
the batch delivers at phone width (360), tablet (768) and desktop (1440),
light and dark. Previews use the isolated preview database and never send
real messages or charge real cards; the proof of that isolation is in
`docs/plans/overhaul/PREVIEW-ISOLATION-PROOF.md`.

## Step 10 — Merge (when authorized conditions are all true)

All of: full CI green at the exact head; acceptance checklist met with
evidence; preview checked; review continuity recorded; automated review
requested or its waiver recorded. Then merge with the expected-head SHA:

```bash
gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge -f merge_method=squash -f sha=<head-sha>
```

If any new commit lands after your evidence, the evidence is stale —
re-verify first. Merging never covers the "Hard limits" in `AGENTS.md`.

## Step 11 — Close the session

1. `docs/STATUS.md`: row → MERGED with PR number and merge SHA; next batch
   → NEXT. Keep the file short: move anything older than the last two
   batches into `docs/archive/STATUS-LOG.md`.
2. Report to Chris: what changed, how verified, what he needs to decide
   (IN-xx), what is next. Plain English, no jargon.
3. Stop. Do not start the next batch unless Chris says to continue.

## If you get stuck

- Same failure after two focused fix attempts: stop making speculative
  edits. Write down the error, what you tried, and the diff, in
  `docs/STATUS.md` under the batch row, and report to Chris.
- A decision that could reasonably go either way and cannot be undone
  (schema, money, data deletion, public promises): do the preparatory work,
  set out the choice, and stop.
- Something in the docs contradicts the code: the code's tests are the truth
  for behavior, `AGENTS.md` is the truth for rules, `docs/PLAN.md` for scope,
  `docs/designs/BATCH-<X>.md` for how. Note the contradiction in
  `docs/STATUS.md` and fix the doc in your PR.
- The design is wrong (a decision cannot work against the real code): stop.
  Do not replace the decision in code. Record exactly what is wrong in
  `docs/STATUS.md` and the PR; a heavy-model session amends the design
  (dated "Amendments" section) and you resume from the amended text.
