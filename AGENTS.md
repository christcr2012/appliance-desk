# AGENTS.md — read this first, every session

This is the provider-neutral constitution for every AI system working on
this repo (Claude, ChatGPT/Codex, Astra, Augment, GitHub Copilot, or any
other). Tool-specific files (`CLAUDE.md`, etc.) point back here and must
never contradict it. The repo — not chat history — is the memory. If it
isn't written down here or in `docs/`, assume the next AI won't know it.

## What this is

**Appliance Desk** — the operating system for Chris Robinson's appliance
rental business in Colorado: a public website that brings in leads, an
admin "desk" where Chris runs the business, and a customer portal.
Chris is the owner/operator and **is not a developer** — every status
update or question directed at him must be plain, non-technical English.
See `docs/OWNER-GUIDE.md` for how *he* uses the finished product.

Purpose-built for appliance rental. Not a generalized SaaS or
multi-industry platform — don't add abstractions "in case" another
industry needs them.

## Never touch existing projects

This is a NEW, standalone project. Never modify, reuse, rename, delete,
or repurpose the existing Cortiware, Robinson AI Systems toolkit,
YardSync, Household Assistant, or oldReplit repositories/Vercel
projects/Neon projects. If you're unsure whether something already
exists under a name you're about to use, ask before creating it.

## Priorities, in order

Correctness & security → legal compliance (accessibility, privacy) →
simplicity & maintainability → features.

## Definition of Done (non-negotiable)

A feature is not done until **all** of these are true:

1. No placeholder functions, stub logic, TODO-as-implementation, or mock
   data presented as real.
2. It's covered by automated tests that exercise the real behavior — not
   just "it renders" or "it compiles."
3. CI (tests + type-check + lint + accessibility checks + build) passes.
4. It's been verified against the acceptance criteria in the relevant
   `docs/` file.

If you can't fully finish something, **say so explicitly** and mark it
incomplete in `docs/HANDOFF.md`. Never present partial work as finished.
Chris has been burned by overclaiming before — honesty about what is and
isn't working matters more than looking complete.

## Stay in scope

Build only what the current phase (see below) asks for. If you think of
something else worth doing, add it to `docs/ROADMAP.md` and mention it to
Chris in your report — don't build it unasked.

## Ask before anything irreversible or costly

Stop and ask Chris before: turning on live Stripe payments, buying
anything (domains, paid plans, add-ons), deleting real data, or changing
anything outside this project.

## Branching & PRs

- `main` is production. Protect it with required PRs + passing CI where
  the plan allows (Neon's free tier currently caps protected branches —
  see `docs/DECISIONS.md`).
- AI agents never commit directly to `main`.
- Chris authorized agents to merge PRs when safe (2026-10-01), after the gates
  above pass. Merge with an expected-head SHA; stacked PRs must target `main`
  after predecessors merge. Live activation, spending and destructive changes
  still require their separate approvals.
- Branch names: `ai/<tool>/<topic>` for AI work (e.g.
  `ai/claude/customer-portal`), plus `feature/…` and `fix/…`. No GitFlow.
- Open a PR, make sure CI passes, get a preview deployment, update
  `docs/HANDOFF.md`, and stop to report to Chris before starting the next
  phase.

## Review continuity — required before starting each PR

- Read `docs/AI-PR-READ-FIRST.md` before planning or merging each PR; check its
  applicable security/billing constraints against the changes and record evidence.
- Track the owner's expanded prelaunch business scope in
  `docs/reviews/2026-10-01-business-logic-audit.md` (B01–B36). Reconcile claims
  against current behavior; use its launch gates and explicit policy dependencies.
  Never silently defer those outcomes or override existing financial rules.
- At session start, inventory unaddressed review submissions and unresolved
  inline threads across open, merged and closed PRs. Consult the reconciliation
  ledger when present; merged/closed/outdated status is not proof of resolution.
- Before starting each new PR, check the preceding work PR, the latest repository
  PR and every predecessor/dependency for submitted reviews (including review
  bodies), inline threads and new comments. Reuse the session inventory and read
  new or changed submissions rather than repeating unchanged history.
- Check each actionable finding against current code. Fix valid defects with
  behavioral regression tests before new backlog features. Related fixes may form
  a coherent follow-on PR; preserve dependency and acceptance gates.
- Record a disposition for every finding: verified existing fix with evidence,
  fix under review, superseded requirement with its authoritative contract, or
  unresolved/blocked with the reason and next step. Never silently drop a finding
  because its PR was merged, closed, or its line became outdated.
- Resolve threads only after verifying the fix or documented disposition. Fixes
  require inspection of the exact head, full CI and applicable preview/acceptance
  checks. Request automated review when available. Chris authorized proceeding
  without automated review when unavailable (2026-10-01); record the reason and
  waiver, inspect the changes, and never claim the unavailable review passed.
  Re-read reviews before merge; new commits invalidate earlier head evidence.
- Update docs/HANDOFF.md and the review ledger before handoff. Unverified or
  blocked findings remain open. Review automation silence is not an approval;
  record what exact-head review actually ran and its result.

## Where the rules actually live

- Pricing, lead scoring, statuses, fees → `docs/BUSINESS-RULES.md` (one
  source of truth — never hard-code a price or a status transition
  outside what that doc describes).
- Database shape and why → `docs/DATABASE.md` + `prisma/schema.prisma`.
- System wiring (Vercel/Neon/GitHub, env vars) → `docs/ARCHITECTURE.md`.
- Accessibility rules → `docs/DESIGN-SYSTEM.md`.
- Dated decisions and why → `docs/DECISIONS.md`.
- Current state / what's incomplete → `docs/HANDOFF.md` — **read this
  first every session**, and **update it before ending any session.**

## How to run things

```bash
npm install               # installs deps; postinstall runs `prisma generate`
npm run dev                # local dev server
npm run typecheck           # generates Next.js route types, then tsc --noEmit
npm run lint                 # eslint (includes jsx-a11y rules)
npm test                      # unit tests (vitest)
npm run test:e2e               # Playwright + axe accessibility tests
npm run build                   # production build
npm run db:migrate:dev            # create + apply a migration locally
npm run db:migrate:deploy          # apply pending migrations (CI/production)
npm run db:seed                     # one-time: creates Chris's OWNER account
```

CI (`.github/workflows/ci.yml`) runs migrate-deploy, typecheck, lint,
unit tests, build, and Playwright/axe accessibility tests against a real
throwaway Postgres — on every PR and on `main`.

## A real constraint you should know about

The sandbox this project was originally built in could not reach
`binaries.prisma.sh` (Prisma's engine download host), so **local**
`prisma generate`/`migrate` calls failed there with a 403. This is a
sandbox network policy, not a bug in the app. GitHub Actions and Vercel
both have normal internet access and run these commands successfully —
CI passing is the real verification gate, not any one contributor's
local sandbox. See `docs/DECISIONS.md`.

**Update 2026-10-02 — Chris explicitly approved working around this block.**
Do not stop at the 403 or push untested code and wait for CI to tell you what
broke. You can run the whole unit suite locally; it takes about five minutes to
set up and has repeatedly caught failures that cost ~10 minutes each in CI. The
recipe (verified on Node 22 with the Postgres 16 that ships in the sandbox):

1. `npm ci --ignore-scripts` (skips the postinstall that hits the 403).
2. Generate the Prisma client without the blocked download. `generate` does not
   actually need the schema-engine binary, so point Prisma at a placeholder:
   ```bash
   printf '#!/bin/sh\nexit 1\n' > /tmp/fake-engine && chmod +x /tmp/fake-engine
   DATABASE_URL=postgresql://test:test@localhost:5432/x \
   DIRECT_URL=postgresql://test:test@localhost:5432/x \
   PRISMA_SCHEMA_ENGINE_BINARY=/tmp/fake-engine npx prisma generate
   ```
   This only writes to `node_modules`. It cannot run migrations (see step 3).
3. Start a throwaway Postgres and load the schema by hand, because
   `prisma migrate` really does need the blocked engine:
   ```bash
   mkdir /tmp/pgdata && chown postgres /tmp/pgdata   # NOT inside a /tmp/claude-* dir; the postgres user can't read those
   B=/usr/lib/postgresql/16/bin
   su postgres -c "$B/initdb -D /tmp/pgdata -A trust"
   su postgres -c "$B/pg_ctl -D /tmp/pgdata -o '-p 5432 -k /tmp' -l /tmp/pg.log start"
   psql -h localhost -U postgres -c "create role test superuser login password 'test'"
   psql -h localhost -U postgres -c "create database appliance_desk_test owner test"
   for d in $(ls -d prisma/migrations/*/ | sort); do
     [ -f $d/migration.sql ] && PGPASSWORD=test psql -q -v ON_ERROR_STOP=1 -h localhost -U test -d appliance_desk_test -f $d/migration.sql
   done
   ```
4. Export the same env CI uses (copy the `env:` block from `.github/workflows/ci.yml`:
   `DATABASE_URL`/`DIRECT_URL` pointing at `appliance_desk_test`, `BETTER_AUTH_*`,
   `NEXT_PUBLIC_APP_URL`, the OWNER/TEST_* logins, and `CI=true`), then
   `npm run db:seed` and `npx vitest run`. Expect every test to pass.

Rules for this workaround: use it only against the throwaway local database
(never Neon/production); do not commit the placeholder or any generated client;
migration-upgrade and schema-health drills (`scripts/test-migration-upgrade.ts`
etc.) and `npm run db:migrate:deploy` stay CI-only.

## Lessons from the Batch A CI failures (2026-10-02)

- **Change code and its tests together.** Batch A moved many writes into
  database transactions that lock a row first (`SELECT ... FOR UPDATE`) and
  re-check the acting staff member (`assertActiveTeamActor`). Every unit test
  that fakes the database must now provide `$queryRaw`, the same `tx` calls the
  code makes, and a `$transaction` that hands the callback that fake `tx`. If
  you touch a domain function's database calls, grep `tests/` for that domain
  and update the fakes in the same commit.
- **CI only shows the first 10 failures per step.** GitHub's summary annotations
  are capped, so "10 failures" can really be 30. Run the full suite locally
  (above) before pushing; read CI failures with
  `gh api repos/<owner>/<repo>/check-runs/<job_id>/annotations` (raw log
  downloads are blocked in the sandbox).
- **Public sign-up is disabled on purpose** (`disableSignUp` in `src/lib/auth.ts`).
  Browser tests must never call `/api/auth/sign-up/email`. Create disposable
  logins with `scripts/create-ci-login.ts` (runs the app's real trusted
  provisioning; refuses to run outside CI's throwaway database). Do not re-enable
  sign-up to make a test pass.
- **Don't push in rapid bursts.** Each push cancels the previous CI run (concurrency
  group). Verify locally, then push once.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->


## Owner authorization update — 2026-09-30

Chris authorizes Codex to merge its own PRs as it goes after exact-head review,
passing CI and applicable acceptance/preview verification. The earlier separate
Claude-review/owner-merge hold in overhaul docs is superseded for Codex-owned
PRs. Use PRs, never direct main commits. Preserve model/phase checkpoints and
all separate approvals for live payments/messages, spending and destructive
changes. Claude owns O01. See docs/plans/overhaul/PR-STACK.md's latest entry.


## Owner execution update — 2026-09-30 (supersedes earlier O01 ownership)

Chris explicitly reassigned O01 from Claude to Codex and requested progress
through the full approved backlog, with larger related PRs to reduce repeated
CI runs. The earlier instruction that Claude owns O01 is superseded. Related
foundation/security changes may exceed the older eight-file/card-per-PR
limit when they form one reviewable outcome; preserve behavioral tests and
acceptance gates. No unrelated mega-PR or direct main commits.

Chris offered to merge green PRs while Codex works on the next PR. Adopt
that workflow: Codex completes local testing and exact-head review before
handoff; owner merges only after CI and applicable previews pass. Subsequent
PRs retain predecessor dependencies and are repaired/rebased if upstream
fails or changes. O01/O02 remain IN_REVIEW/incomplete until their acceptance
evidence passes. Model/phase checkpoints and approvals for live activation,
spending and destructive customer-data changes still apply.


## Owner model and batch update — 2026-09-30

Chris explicitly switched this project to Astra Medium and requested larger,
related implementation batches with minimal repeated reading and validation.
This supersedes the earlier Sol/Luna model-switch schedule. Continue the
approved backlog under the selected model; preserve dependencies, real
behavioral tests, CI/preview and honest completion evidence. Group related
workspace changes into reviewable PRs. Owner continues merging green PRs.
Live activations, paid resources and destructive customer-data actions keep
their separate approval requirements.

## Owner sequencing update — 2026-10-01 (current)

Chris explicitly requested completing and merging the existing green PRs, then
continuing the original roadmap. Implementations from all audits, including
historical review repairs and B01–B36, are deferred until after the roadmap.
This supersedes earlier audit-before-feature and audit-expanded launch sequencing
in this document and linked plans. Preserve the audit registers and unresolved
findings for that later work; deferral is not resolution. Preserve existing
correctness protections, O02/O13/O14/O32 dependencies, CI/preview acceptance and
separate approvals for live activation, spending and destructive real-data changes.

## Owner PR consolidation update — 2026-10-01

Chris explicitly requires far fewer, much larger PRs. Follow
docs/plans/overhaul/REMAINING-BATCHES.md: five remaining substantial batches,
with a single Google follow-up only if external gates lag. This supersedes
card-per-PR, eight-file, separate contract/UI, one report/cron, six Google PR
and old model/phase-stop schedules. Ordered local commits and focused checks
preserve reviewability. Submit complete user outcomes; full CI is a batch gate,
not an edit loop. Consolidate repairs in the same PR. Include plan/HANDOFF with
implementation; no separate documentation PR for this instruction.
Keep acceptance/dependencies, current model/single agent, exact-head merges
and separate live/spending/destructive approvals. Audits follow the roadmap.
