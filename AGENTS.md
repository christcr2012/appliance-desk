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
   Then `docs/MASTER-ROADMAP.md` — the one ordered list of every remaining step, what
   must be true before each starts, and what only Chris can do.
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
- **One agent, one batch at a time, one stack per batch.** (Chris, 2026-10-03,
  replacing every earlier PR-size rule.) Each batch is built as a *stack* of
  PRs: an ordered chain where each PR is based on the branch below it and the
  bottom one targets `main`. Use GitHub's stacked-PR feature (`gh stack`:
  `init`, `add`, `submit`, `sync`) when the sandbox can install it; if it
  cannot (network policy), build the same chain by hand — branch from the
  previous PR's branch, set that branch as the PR base — and retarget as each
  predecessor merges. A PR is a **reasonably sized cluster that makes sense
  together** (for example "ledger statements and reports", "tax-rate
  precision move", "signing-page terms and consent"): not one item per PR, and
  not a whole batch in one PR. Size it so the work in it can be done properly,
  with its tests and docs, and reviewed in one sitting. **Concrete budget (Chris, 2026-10-06):** about 500 lines of
  production code (tests not counted), about 15 files, at most one migration, one risk area, two CI runs expected,
  at most two merged PRs per session — `docs/PLAYBOOK.md` Step 3a. The PR list for every remaining batch is
  `docs/MASTER-ROADMAP.md` section 7.
- **CI is free and fast, so lean on it** (Chris, 2026-10-03; details in the
  "CI" section below). Do not drop tests to save minutes, and do keep CI fast
  (the "Keeping CI fast" checklist in `docs/ARCHITECTURE.md`).
- **Use the web.** Chris encourages (and expects) you to search the web for
  current documentation, best practices and modern solutions whenever that
  beats your training data (framework versions, Stripe, Colorado/tax rules,
  accessibility, security). Cite what you used in the PR.
- **Owner-configurable by default.** Chris wants to change almost everything
  from his owner account. Anything a business might change someday — prices,
  fees, rates, notice periods, wording, thresholds, schedules, limits, labels,
  toggles — must be a stored setting editable in the app (with a reasonable
  starting value), never a hard-coded constant. If something truly must stay
  in code, say why in the PR.
  Every such setting must be explained **in the screen itself**, in plain
  words anyone can follow (Chris, 2026-10-03): what the setting does, what each
  choice means for a customer, the starting value and why it was chosen, who
  can change it, and a way to restore the recommended value. No jargon, no
  "see the docs".
- **Design drift check at the start of every batch.** Approved designs for later
  batches were written before earlier batches changed the code. Before coding a
  batch, follow the drift check in `docs/designs/README.md`: read
  `docs/designs/CHANGES-SINCE-DESIGN.md`, verify the design against the code,
  record and amend differences, and stop with a written stronger-model prompt only
  for decision-level conflicts (money, statuses, permissions, database design).
  When your batch merges, add its changes to `CHANGES-SINCE-DESIGN.md`.
- **Do not switch models; ask for a stronger one in writing.** If a task needs
  a heavier-reasoning model (for example writing an approved batch design),
  stop on that task, and give Chris a complete, self-contained prompt to run
  in a separate chat, then continue with other work.
- **Model:** whichever model Chris has selected does the work. Older documents
  that assign cards to "Luna" or "Sol" or schedule model switches are
  historical. Do not stop to ask for a model switch.
- **Branch names:** `ai/<tool>/<topic>` (for example `ai/codex/batch-b-billing`).
  Branch from current `main`, or from the previous unmerged PR's branch when
  stacking; retarget `main` once the predecessor merges.
- **Quick local checks, then let CI do the heavy lifting** (agent's call,
  approved by Chris 2026-10-03). Before each push run the cheap checks:
  `npm run typecheck`, `npm run lint`, and `vitest` on the tests you touched
  or that cover the code you changed (seconds). Do **not** build a local
  Postgres and run the whole suite or the browser specs by default: CI runs
  them for free in about 3 minutes, and setting them up costs far more agent
  effort than one CI round trip. Do run more locally when it is cheaper than
  guessing: a migration or SQL change (prove it on a scratch database), a
  failure you cannot understand from CI output, or a browser spec you are
  actively iterating on. The full recipe stays in `docs/PLAYBOOK.md`.
- **Merging:** Chris has authorized agents to merge their own PRs (2026-10-01)
  when all of these are true: the `ci` check green at the exact head being
  merged (CI runs on every push; check it is the latest head),
  the PR's acceptance list is met with evidence, applicable preview checks
  pass, and the review steps below are done. Merge with the expected-head SHA.
  New commits invalidate earlier evidence — re-check before merging. The
  separate approvals under "Hard limits" are never covered by a merge.
  **Standing approval for stacks (Chris, 2026-10-03, "Option 2 approved"):** for
  a stack of PRs (Batch C onward), the agent merges each PR bottom-up when the
  conditions above are met. Before each merge, **retarget that PR to `main`**
  (merging a stacked PR into its base branch leaves `main` without the work —
  this happened to #165 and #166), wait for `ci` at the exact head, read the
  Codex and Copilot threads, record dispositions, then merge with the head SHA.
  Stop and tell Chris first when a review finding is a money, security or
  data-loss problem that is not fixed in the same PR.
- **Automated review:** if an automated reviewer is available, request it. If
  it is not (quota, outage), Chris has waived it (2026-10-01): inspect the
  diff yourself, record "automated review unavailable — waived" in the PR,
  and never claim a review ran that did not. Codex reviews every PR
  automatically when it is opened, so it is normally available: read its
  comments before writing "unavailable". Never write "waived" without checking.
- **Review fixes ride the next planned PR (Chris, 2026-10-03).** Do not open or
  push a separate PR just to fix review comments — each push costs a CI run.
  Collect valid findings from all open PRs, fix them (with regression tests)
  inside the next planned PR of the stack, and record each disposition there.
  Exception: a finding that is a security or money-correctness hole in code
  already merged to `main` gets fixed immediately.

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
5. **Do not merge before the automated reviewers have posted.** Codex and Copilot
   post a few minutes after every push (a "Running Copilot Code Review" workflow run
   shows Copilot still working). "Zero threads" while a reviewer is still running
   means unreviewed, not clean: wait for it to finish, list the threads again, then
   merge. A review that arrives after a merge is handled in the next PR (and
   recorded in its description).

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

## CI — fast, free, and checks for secrets (owner, 2026-10-03)

The repository is **public**, so GitHub Actions minutes on standard runners are
free (the private-repo allowance ran out on day 3 of October). CI is therefore
built for **speed**, not minute-saving: every check runs in parallel on every
push to a pull request, with a goal of results in about 3 minutes
(`docs/ARCHITECTURE.md` → "CI layout and speed"). The rules:

1. **Cheap local checks, then push; CI runs the rest.** Run typecheck, lint
   and the tests for what you changed before pushing (see "Quick local checks"
   above). Push a PR when its cluster is coherent, not after every edit — a new
   push cancels the running CI. When CI fails, read the **full** logs (CI's
   summary shows only the first 10 failures per step; fetch the job log through
   the API), fix everything you can see, and push once. **At most 3 CI runs per
   PR:** after a second red run on the same failure, reproduce locally instead of
   guessing; after a third, stop and report (`docs/PLAYBOOK.md` Step 8, which also
   covers keeping a stack current as `main` moves and updating tests a design
   deliberately changes).
2. **The `ci` check is the single gate.** It needs the secret scan, type-check
   and lint, all three unit-test shards and all four browser shards. It runs on
   every push to a PR and on `main`; the browser suite also runs nightly. Never
   merge on a stale result: the `ci` check must be green at the exact head.
3. **Public repository = anything committed is public forever.** Never commit
   secrets, real customer data, or private infrastructure identifiers (Neon
   branch/endpoint ids, Vercel project/team ids, production URLs with
   credentials). CI runs `scripts/check-secrets.mjs` (our rules; the allowlist
   of reviewed harmless values is inside it) and `gitleaks` over the full git
   history on every run — including docs-only changes. A failure blocks the
   merge. Fix by removing the value (and, if it was real, telling Chris so the
   credential is rotated — deleting it from a later commit does not un-publish
   it). Do not add to `.gitleaksignore` or the script's allowlist without
   saying why in the PR.
4. **Workflow safety.** `.github/workflows/ci.yml` has `permissions: contents: read`,
   uses no repository secrets, and only throwaway test values. Never use
   `pull_request_target`, never add secrets to it, never echo environment values.
5. **Prefer unit tests (`tests/`, vitest) over browser tests (`e2e/`).** Browser
   tests are the slowest part of CI. Use them for axe accessibility, real
   login/session behavior, security headers, one click-through per major flow.
6. **Every new `e2e/*.spec.ts` must be assigned to a group in
   `e2e/shards.json`** (browser-a … browser-d; CI fails otherwise). Keep the
   groups balanced by real durations.
7. **Never log in per test** — reuse the saved sessions from
   `e2e/global-setup.ts` (`test.use({ storageState })`).
8. **Keep the pipeline fast.** New one-off checks go in the `static` job (or
   `secrets`), not a new job, unless they can run in parallel without delaying
   the slowest job. The maintenance guide is `docs/ARCHITECTURE.md`.

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

CI (`.github/workflows/ci.yml`) runs in parallel: a secret scan, type-check +
lint, the unit/integration tests in 3 shards on throwaway Postgres databases,
and the production build + browser suite in 4 shards. Docs-only changes skip the
heavy jobs but never the secret scan. See "CI" above.

**Browser tests locally:** cloud sandboxes include Chromium; PLAYWRIGHT_BROWSERS_PATH
is preset and `playwright install` is forbidden. The build needs a font stand-in
and the browser needs a path shim: the exact recipe is `docs/PLAYBOOK.md` 4c. Do
not skip browser specs for screen changes because "the sandbox has no browser".

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
3. If you found something out of scope, add it to `docs/ROADMAP.md`. If your work added a switch, key, provider account or owner decision needed before real customers, add a line to `docs/GO-LIVE-CHECKLIST.md`.
4. Report to Chris in plain English: what changed, how it was verified, what
   he needs to decide (with `docs/OWNER-INPUTS.md` IDs), and what is next.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
