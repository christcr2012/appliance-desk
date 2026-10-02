# AGENTS.md — the rules. Read this first, every session.

This file is the single, current set of rules for every AI system working on
this repo (ChatGPT/Codex "Sol", Claude, Copilot, or any other). It is
written to be followed literally. There are no "superseded" layers in it: if
something is written here, it is current. History and the reasons behind
decisions live in `docs/DECISIONS.md` and `docs/archive/` — those are for
looking things up, never for instructions. The repo — not chat history — is
the memory: if it isn't written down here or in `docs/`, the next session
won't know it.

Reading order at the start of every session (about 10 minutes total):

1. This file.
2. `docs/START-HERE.md` — what the project is, where everything lives.
3. `docs/STATUS.md` — exactly where work stands right now and what is next.
4. `docs/PLAN.md` — the section for the batch you are working on.
5. `docs/designs/BATCH-<X>.md` — the approved design for that batch (how).
6. `docs/PLAYBOOK.md` — the step-by-step procedure for doing a batch.

Then open only the reference docs the batch section names. Do not read
`docs/DECISIONS.md`, `docs/archive/`, or the audit reports end to end — search
them when a specific question comes up.

## What this is

**Appliance Desk** is the operating system for Chris Robinson's appliance
rental business in Colorado (Robinson Appliance Rentals, Greeley area): a
public website that brings in leads, an admin "desk" where Chris runs the
business, and a customer portal. It is purpose-built for appliance rental —
not a generic SaaS, not multi-industry. Do not add abstractions "in case".

Chris is the owner/operator and **is not a developer**. Every status update,
question, or PR summary written for him must be plain, non-technical English:
what changed, how it was verified, what he needs to decide, what is next.

## Priorities, in order

1. Correctness and security.
2. Legal compliance (accessibility, privacy).
3. Simplicity and maintainability.
4. Features.

When two of these conflict, the higher one wins.

## Definition of Done (non-negotiable)

Work is not done until **all** of these are true:

1. No placeholder functions, stub logic, TODO-as-implementation, or mock data
   presented as real.
2. Automated tests exercise the real behavior — not just "it renders" or "it
   compiles". Business rules, permissions, money, and concurrency get real
   tests against the real (throwaway) Postgres.
3. CI is green: type-check, lint, unit/integration tests, production build,
   browser/accessibility tests.
4. The batch's acceptance list in `docs/PLAN.md` is checked item by item, with
   evidence (test names, CI run, preview URL).
5. `docs/STATUS.md` is updated.

If you cannot fully finish something, **say so explicitly** and record it as
incomplete in `docs/STATUS.md`. Never present partial work as finished. Chris
has been burned by overclaiming before — honesty about what is and isn't
working matters more than looking complete. A passing type-check, a
screenshot, or a plan is not evidence that a feature works.

## Hard limits — stop and ask Chris before any of these

- Turning on live Stripe payments, live SMS, or live customer email sends.
- Buying anything: domains, paid plans, add-ons, higher tiers, storage.
- Deleting or rewriting real (production) customer, billing, or signature data.
- Running fixtures, seeds, or reset scripts against the shared production
  database or production file storage. Preview/CI databases only.
- Changing anything outside this project (other repos, other Vercel or Neon
  projects, Google Workspace settings not named in the plan).
- Committing directly to `main`.

Never modify, reuse, rename, delete, or repurpose the existing Cortiware,
Robinson AI Systems toolkit, YardSync, Household Assistant, or oldReplit
repositories, Vercel projects, or Neon projects. If a name you are about to
create might already exist, ask first.

## Scope

Build what the current batch in `docs/PLAN.md` asks for, completely. If you
notice something else worth doing, add it to `docs/ROADMAP.md` and mention it
in your report. Do not build it unasked.

Audit findings, review threads, and business-audit items (B01–B36) are all
already mapped into the batches in `docs/PLAN.md`. Work them when their batch
comes up, not before. Deferring an item is not resolving it: keep it listed.

Owner decisions you need are tracked in `docs/OWNER-INPUTS.md` with stable
IDs. Check there before asking. Ask only for inputs the current batch needs,
not everything at once. An answer is not applied until the setting and the
resulting behavior are verified.

## How work is organized

- **Implement only from an approved design.** Every batch has
  `docs/designs/BATCH-<X>.md` written by a heavy-reasoning model after
  reading the code: decisions, schema, signatures, work units, tests,
  stop-and-ask points. The implementing model follows it literally, does
  not re-decide, does not add tables/columns/libraries/patterns the design
  does not name, and stops to ask where the design is silent. No design,
  or a DRAFT one → stop and report; do not start.
- **One agent, one batch at a time, in one substantial PR.** Chris has
  explicitly asked for far fewer, much larger PRs because every PR costs a
  full CI run. Do not open a PR per card, page, cron, migration, test repair,
  or documentation sentence. Ordered commits inside the PR keep it reviewable.
- **Model:** whichever model Chris has selected does the work. Older documents
  that assign cards to "Luna" or "Sol" or schedule model switches are
  historical. Do not stop to ask for a model switch.
- **Branch names:** `ai/<tool>/<topic>` (for example `ai/codex/batch-b-billing`).
  Branch from current `main`. If a batch depends on an unmerged predecessor,
  branch from it and retarget `main` once the predecessor merges.
- **Verify locally, push once.** Each push cancels the previous CI run and
  bills the partial minutes. The local verification recipe is in
  `docs/PLAYBOOK.md`; it takes ~5 minutes to set up and catches most failures.
- **Merging:** Chris has authorized agents to merge their own PRs (2026-10-01)
  when all of these are true: full CI green at the exact head being merged,
  the PR's acceptance list is met with evidence, applicable preview checks
  pass, and the review steps below are done. Merge with the expected-head SHA.
  New commits invalidate earlier evidence — re-check before merging. The
  separate approvals under "Hard limits" are never covered by a merge.
- **Automated review:** if an automated reviewer is available, request it. If
  it is not (quota, outage), Chris has waived it (2026-10-01): inspect the
  diff yourself, record "automated review unavailable — waived" in the PR,
  and never claim a review ran that did not.

## Review continuity — before each PR

1. Read `docs/AI-PR-READ-FIRST.md` if the batch touches billing, Stripe,
   webhooks, auth/session, email/SMS, public forms, or preview/runtime safety.
   Its constraints are blocking. Record in the PR how each applicable one was
   honored.
2. Check the previous batch's PR and any PR it depends on for review comments
   and unresolved threads. The historical inventory is
   `docs/reviews/2026-10-01-review-reconciliation.md`. "Merged" or "outdated"
   is not proof a finding was resolved.
3. Fix valid findings that touch your batch's area, with regression tests, in
   the same PR. Record a disposition for every finding you looked at:
   *fixed (evidence)*, *already fixed (evidence)*, *superseded (by what)*, or
   *still open (why, next step)*. Never silently drop one.
4. Resolve a review thread only after verifying the fix at the exact head.

## Where the rules live (one source of truth each)

| Topic | File |
|---|---|
| Prices, fees, lead scoring, statuses, transitions | `docs/BUSINESS-RULES.md` — never hard-code a price or status transition elsewhere |
| Database shape and why | `docs/DATABASE.md` + `prisma/schema.prisma` |
| System wiring: Vercel, Neon, GitHub, env vars, CI | `docs/ARCHITECTURE.md` |
| Visual/accessibility rules, Evergreen brand | `docs/DESIGN-SYSTEM.md`, `docs/brand/` |
| Screen layouts and interaction specs for the overhaul | `docs/plans/overhaul/DESIGN.md` |
| Product behavior spec | `docs/PRODUCT-SPEC.md` |
| The work plan (batches, acceptance, launch gates) | `docs/PLAN.md` |
| How each batch is built (decisions, schema, work units, tests) | `docs/designs/BATCH-<X>.md` — implement only from an approved design |
| Current state | `docs/STATUS.md` |
| Owner decisions needed | `docs/OWNER-INPUTS.md` |
| Dated decisions and reasons | `docs/DECISIONS.md` (append a dated entry when you make a design decision) |
| Ideas not being built now | `docs/ROADMAP.md` |
| How Chris uses the finished product | `docs/OWNER-GUIDE.md` |
| Security/billing constraints for PRs | `docs/AI-PR-READ-FIRST.md` |
| Audit findings (reference) | `docs/AUDIT_SYNTHESIS.md`, `docs/audits/`, `docs/reviews/` |
| Retired documents (reference only) | `docs/archive/` |

## Engineering rules that apply to every change

- **Change code and its tests together.** Many writes run inside database
  transactions that lock a row first (`SELECT … FOR UPDATE`) and re-check the
  acting staff member (`assertActiveTeamActor`). Unit tests that fake the
  database must provide `$queryRaw`, the same `tx` calls the code makes, and
  a `$transaction` that hands the callback that fake `tx`. If you touch a
  domain function's database calls, grep `tests/` for that domain and update
  the fakes in the same commit.
- **Public sign-up is disabled on purpose** (`disableSignUp` in
  `src/lib/auth.ts`). Never re-enable it, and never call
  `/api/auth/sign-up/email` from a test. Create disposable logins with
  `scripts/create-ci-login.ts` (CI throwaway database only).
- **Money is integer cents.** Reuse existing calculation functions; never
  reimplement financial math in UI code.
- **Times are stored in UTC and shown in America/Denver.** Day boundaries,
  "today", and reminders use the business time zone; test DST edges.
- **Roles:** OWNER, ADMIN, STAFF, CUSTOMER. Filter restricted data at the
  query/DTO boundary — hiding a link is not protection. Customer A must never
  reach customer B's data through any URL, action, search, or export.
- **Next.js:** this repo's version has breaking changes from what you were
  trained on. Read `node_modules/next/dist/docs/` before writing framework
  code (see the auto-generated note at the bottom of this file).
- **Secrets** never appear in code, docs, logs, screenshots, or PR text.
- **Migrations** are additive and reviewed by `scripts/check-migrations.mjs`
  in CI. Production runs `prisma migrate deploy` during `vercel-build`.

## CI speed budget — 5 minutes per PR (owner's standing target, 2026-10-02)

A full CI run on a pull request must finish in **5 minutes or less**;
documentation-only PRs stay near-free (~10 seconds). As of 2026-10-02 a full
run takes ~4.5 min. Every agent adding tests, CI steps, or dependencies keeps
it there. The maintenance guide is `docs/ARCHITECTURE.md` → "Keeping CI under
5 minutes". The rules that matter most:

1. **Prefer unit tests (`tests/`, vitest) over browser tests (`e2e/`).** A
   browser test costs 10–50× a unit test and sits on CI's critical path.
   Browser tests are for what truly needs a browser: axe accessibility, real
   login/session behavior, security headers, one full click-through per
   major user flow.
2. **Every new `e2e/*.spec.ts` must be assigned to a group in
   `e2e/shards.json`** — CI fails otherwise. Put it in the lightest group;
   each shard prints per-file durations as a CI notice on every run.
3. **No browser shard's test step may exceed ~2 minutes.** Past that,
   rebalance the groups; if all are full, add a shard (one group in
   `e2e/shards.json` + one matrix entry in `.github/workflows/ci.yml`).
4. **Never log in per test** — reuse the saved sessions from
   `e2e/global-setup.ts` (`test.use({ storageState })`).
5. **Don't add steps to the browser job's shared prefix** (install →
   migrate → seed → build); every shard pays it. One-off checks go in the
   `static` or `database` job.
6. If the unit/integration job approaches 3 minutes, shard vitest
   (`vitest run --shard=N/M`) before anything else.

## How to run things

```bash
npm install               # installs deps; postinstall runs `prisma generate`
npm run dev                # local dev server
npm run typecheck           # generates Next.js route types, then tsc --noEmit
npm run lint                 # eslint (includes jsx-a11y rules)
npm test                      # unit/integration tests (vitest)
npm run test:e2e               # Playwright + axe browser tests
npm run build                   # production build
npm run db:migrate:dev            # create + apply a migration locally
npm run db:migrate:deploy          # apply pending migrations (CI/production)
npm run db:seed                     # seeds business content (+ test accounts in CI)
```

CI (`.github/workflows/ci.yml`) runs on every PR and on `main` as parallel
jobs: static checks; migrations + unit/integration tests on a throwaway
Postgres; and the production build + browser suite split across 3 runners by
`e2e/shards.json`. Docs-only PRs skip all of it.

**Sandbox constraint:** some sandboxes cannot reach `binaries.prisma.sh`, so
`prisma generate`/`migrate` fail there with a 403. That is network policy, not
a bug. Chris approved (2026-10-02) a workaround that lets you run the whole
unit suite locally anyway — the recipe is in `docs/PLAYBOOK.md`. Use it; do
not push untested code and wait for CI to find the failures. CI shows only the
first 10 failures per step, so "10 failures" can really be 30.

## Ending a session

Before you stop — whether the batch is finished or not:

1. Update `docs/STATUS.md`: what merged, what is in progress (branch, PR,
   head SHA, CI run), what is blocked and why, what is next.
2. If you made a design decision, add a dated entry to `docs/DECISIONS.md`.
3. If you found something out of scope, add it to `docs/ROADMAP.md`.
4. Report to Chris in plain English: what changed, how it was verified, what
   he needs to decide (with `docs/OWNER-INPUTS.md` IDs), and what is next.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
