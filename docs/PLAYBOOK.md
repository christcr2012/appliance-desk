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

## Step 0b — Design drift check (start of every batch)

Before the first line of a batch's code, do the design drift check in
`docs/designs/README.md` (read `docs/designs/CHANGES-SINCE-DESIGN.md`, verify the
design's "Verify before starting" table against the code, write the dated drift
section, amend small differences, and stop with a stronger-model prompt for
decision-level conflicts).

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
- New browser spec files go into a group in `e2e/shards.json` (all groups run on one runner).

## Step 3a — Size each PR before you start it (Chris, 2026-10-06)

The goal: **more time implementing than testing or debugging, and no PR bigger than one agent can finish well.**
`docs/MASTER-ROADMAP.md` section 7 gives the exact PR list for every remaining batch; it overrides the coarser PR
grouping lines inside the designs (the work units and their order do not change). If you think a PR there is still
too big, split it further along work-unit boundaries and say so in the PR — never merge two of them. When a single
work unit is itself over budget (likely: WU-G3 two-step login, WU-T5 invoices on the engine), split it inside the work
unit at a point where each part is complete and tested on its own — for example G-2a "plugin, schema, enrolment page
and CI login support, enforcement not yet on" then G-2b "enforcement"; or T-4a "local invoices" then T-4b "Stripe
mirror". Never ship a half-built path that tests cannot exercise.

**How to measure the budget** (run before opening the PR; lockfile, generated files, tests, browser specs and docs are
not counted):

```bash
git diff --shortstat origin/<base>...HEAD -- src prisma/schema.prisma prisma/migrations scripts ':!scripts/**/*.test.*'
git diff --name-only origin/<base>...HEAD -- src prisma scripts | wc -l
```

**The budget for one PR** (all must hold; if a planned PR will break one, split it before writing code):

| Limit | Budget | Why |
|---|---|---|
| Production code changed (not tests, not docs) | about **500 lines**, hard stop around 800 | A reviewer (and the next agent) can read it in one sitting |
| Production files touched | about **15** | Fewer places for an unrelated test to break |
| Migrations | **at most one**, and only in the first PR of a batch unless the design says otherwise | One schema change per CI cycle; easy rollback |
| Risk areas | **one** of: schema, money/billing, auth/permissions, provider (Stripe/email/SMS), screens | Mixing two makes a red CI hard to diagnose |
| New browser spec files | **at most one** | Browser shards are the slowest part of CI |
| Expected red CI runs | **1 or none** (3 red runs is the ceiling, see Step 8) | If you expect more, the PR is too big |
| Session | **at most 2 merged PRs per agent session**; write the STATUS handoff after each | Long sessions lose context and start guessing |

Tests are not budgeted — write as many as the change needs. A PR that is mostly tests is fine.

**The cheapest way to avoid CI rounds:** for any PR in the schema, money/billing or auth risk area, run the integration
tests you added or changed against the local throwaway Postgres (Step 4b, only those files) before the first push. It
costs a few minutes once per session and usually saves a whole red CI round. For screen PRs, run the one browser spec
you touched with the 4c recipe.

**Never sit idle.** While a PR waits on CI, on a reviewer, or on Chris (Batch V's before/after screenshot gate), start
the next PR in the stack from that PR's branch. Automated reviewers: if Codex replies that its usage limit is reached,
or no review has posted 20 minutes after `ci` went green and no Copilot review run is in progress, record "automated
review unavailable — waived" (AGENTS.md) with your own diff inspection, and continue.

### Anti-stall protocol

This protocol is mandatory whenever work depends on CI, Vercel, GitHub review, or another external system:

1. **One status check, then move.** Check the external state once. If it is still pending and produced no new actionable
   information, do not query it again immediately. Work on the next runnable PR, tests, docs, review reconciliation,
   or handoff instead.
2. **No live watching.** Never tail build logs, repeatedly fetch workflow jobs, or loop on deployment/reviewer state.
   A second check is allowed only after substantive work occurred, Chris explicitly asks for current status, or that
   result is the only remaining dependency.
3. **Collapse duplicate failures.** If several browser shards fail during the same build step, read static/build output
   and at most one representative browser log first. Treat the other build failures as downstream until evidence says
   they are independent.
4. **Two identical tool failures maximum.** After two failed attempts at the same API/tool operation, switch to a
   different supported path or record the blocker. Do not keep retrying the same call.
5. **Prefer actionable logs.** Fetch failed-job logs/annotations, not an in-progress live stream. Fix all visible root
   causes together and push once.
6. **End cleanly instead of polling.** If merge/session limits, owner gates, or dependency ordering leave no useful
   work while an external job is pending, update STATUS/PR evidence with the exact head and pending run, tell Chris
   what remains, and stop the turn. The next turn resumes from that recorded state.
7. **User updates are progress checkpoints.** During a long tool sequence, give Chris a short update after roughly
   2–3 tool calls or when a meaningful result changes. Do not let a long external wait appear as a silent stall.

**Report what the budget cost.** Put "CI runs used: N (red: R)" in each PR description and in the STATUS handoff. If two
PRs in a row needed three red runs, split every remaining PR of that batch one step smaller and say so in STATUS.

**Ripple check before coding (5 minutes, saves a CI round):** grep `tests/` and `e2e/` for every function, route,
setting and fixture you are about to change, and list the tests that will need updating in the same PR. Two known
ripples in the remaining batches:

- **Batch T's readiness gate** (billing blocked until tax is decided) makes every existing test that signs an
  agreement or sets up billing fail unless its fixture is tax-ready. The PR that wires the gate must also add a
  `seedTaxReadyContext()` test helper (reviewed synthetic jurisdiction, synthetic rate, election and rules for the
  test address) and extend the CI seed in `prisma/seed.ts` so browser flows stay green.
- **Batch G's two-step login** changes how test accounts sign in. The same PR must update `scripts/create-ci-login.ts`
  and `e2e/global-setup.ts` so the saved browser sessions complete the second step.

Any new page must be added to `e2e/route-inventory.ts` in the same PR (`tests/accessibility-route-inventory.test.ts`
fails otherwise), and any new browser spec to the lightest group in `e2e/shards.json`.

## Step 4 — Verify locally before any push

**Default (agent decision, approved by Chris 2026-10-03): run only 4a — the
cheap checks — before a push, and let CI run the full suite and browser specs.**
The rest of this step (4b full local suite, 4c browser specs) is for when it is
cheaper than guessing: migrations/SQL, a CI failure you cannot explain, or a
spec you are iterating on. Local verification of the full suite takes ~5 minutes
to set up and can catch failures that would otherwise fail in CI (GitHub shows only the first 10 failures per
step, so one CI run rarely shows them all, and a red run is noise for Chris).

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

### 4c. Browser and accessibility tests locally (required for screen changes)

If you touched `src/app/`, `src/components/`, `src/lib/` or `e2e/`, run the
browser specs that cover those screens **before pushing**. Skipping this is how
a dark-mode contrast failure reached CI on 2026-10-03 and cost a billed run.
Cloud sandboxes ship a Chromium and Playwright works there; two sandbox quirks
need the workaround below (both local-only, nothing is committed):

```bash
S=<scratchpad dir>   # any scratch folder outside the repo

# 1. The sandbox cannot reach fonts.googleapis.com, so `next build` fails on the
#    Google font. Mock it (works with webpack, not Turbopack) using any local .woff2:
cp "$(find / -name '*.woff2' -size +1k 2>/dev/null | head -1)" $S/mock.woff2
cat > $S/font-mock.js <<EOF2
const css = `@font-face { font-family: 'Manrope'; font-style: normal; font-weight: 200 800;
  font-display: swap; src: url($S/mock.woff2) format('woff2'); unicode-range: U+0000-00FF; }`;
module.exports = new Proxy({}, { get: () => css });
EOF2
export NEXT_FONT_GOOGLE_MOCKED_RESPONSES=$S/font-mock.js
npx next build --webpack          # with the step-4 environment exported and the database seeded

# 2. The preinstalled Chromium is an older build than this repo's Playwright
#    wants (the error message names the folder, e.g. chromium_headless_shell-1243).
#    Point Playwright at a shim folder that links to the installed binary:
D=$S/pw/chromium_headless_shell-1243/chrome-headless-shell-linux64   # use the number from the error
mkdir -p $D && ln -sf /opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell $D/chrome-headless-shell
export PLAYWRIGHT_BROWSERS_PATH=$S/pw PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# 3. Run the specs for what you changed (the whole suite is ~6 minutes)
npx playwright test e2e/owner-portal-workspaces.spec.ts
```

Never run `playwright install` (the sandbox forbids it). The accessibility
specs scan every screen in light and dark mode, so a new screen or a new
coloured box should be added to the relevant scan list and run here first.
The local run uses a webpack build and a stand-in font, so CI's
Turbopack/real-font build remains the final authority.

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
3. **Do this at the START of every new PR, not the end** (Chris, 2026-10-03):
   list the unresolved threads on the previous PR and every PR below it in the
   stack, read each comment in full, fix the valid ones in the new PR with a
   regression test, and put a disposition table in the new PR's description.
   GraphQL is blocked in agent sessions, so use REST:
   `gh api repos/<o>/<r>/pulls/<n>/ccr/review_threads` (threads and comment ids),
   `gh api repos/<o>/<r>/pulls/comments/<comment-id> --jq .body` (full text), and
   `gh api -X POST repos/<o>/<r>/pulls/<n>/ccr/comments/<comment-id>/resolve`
   (only after the fix is verified green at the exact head). Also re-read new
   comments on the PR you just opened: Codex keeps commenting after each push.

## Step 6 — Update docs, then push once

1. `docs/STATUS.md`: batch row → IN REVIEW, with branch, PR, head SHA.
2. `docs/DECISIONS.md`: one dated entry per design decision made.
3. `docs/ROADMAP.md`: anything out of scope you noticed.
4. `docs/OWNER-INPUTS.md`: any new decision Chris needs (new ID) or any
   answer applied (status updated).
5. Commit, then push. Each push to a PR starts a fresh CI run and cancels the
   older one; CI is free (public repo) but waiting on it is not, so push when
   the work is verified locally.

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

## Step 8 — CI (and keeping it green while the codebase keeps moving)

**Reading a failure.** Wait for the `ci` check. If it fails:

1. Read the failures: `gh api repos/<owner>/<repo>/check-runs/<job_id>/annotations` (raw logs and the HTML report are
   often unreachable from sandboxes; annotations always are). Browser shards also print per-file durations. GitHub shows
   only the first 10 failures per step — fetch the full job log before deciding you have seen them all.
2. Reproduce locally (Step 4). Fix every failure you can see, not just the first ten.
3. Push once.

**Is it mine?** Before debugging, look at the latest `ci` run on `main` (and, for a stacked PR, on its base PR). If the same test is red there, the failure is
not your PR's: fix it in a tiny separate PR first (allowed alongside AGENTS.md's security/money exception to "review fixes ride the
next PR", because a red `main` blocks every PR), or port
an existing fix into your PR and say so. Never debug someone else's red for hours inside your PR.

**The CI round budget.** At most **3 red CI runs** caused by your change, per PR (a green run after merging the base
branch, or one infra re-run, does not count). After the second red run on the *same* failure, stop pushing
speculative fixes: set up the full local suite (Step 4b) or the browser recipe (4c) and reproduce it. After the third red
run, stop: write the failure, what you tried and your best explanation into `docs/STATUS.md` and report to Chris (the
existing "If you get stuck" rule). If debugging has taken longer than writing the change, the PR was too big — split
what is left along work-unit lines.

**When an old test breaks because the design changes behaviour on purpose** (for example Batch T replacing the single
tax rate): update the old assertion **in the same commit as the code**, list every changed assertion in the PR with the
design line that requires it, and never loosen it to "anything goes". If the design does not say the behaviour changes,
the old test is right and your code is wrong.

**Flaky-looking failures.** "Flake" is not a cause. Re-run a job once only if it died before any test ran (checkout,
install, runner lost). A test that passes and fails on the same code gets fixed (usually a time, ordering or shared-data
assumption), never skipped, retried in a loop or quarantined.

**Keeping a stack current as `main` moves.** One agent works one batch, but `main` still moves when your own PRs merge and
when docs PRs land.

- Before opening each PR and again before merging it, merge **that PR's base branch** into it: `main` for the bottom PR,
  the previous PR's branch for every PR above it (merging `main` straight into an upper PR fills its diff with changes
  its base has not seen yet). Use a merge commit — do not rebase or force-push a branch that already has review
  comments — then run Step 4a and push.
- After the bottom PR merges: retarget the next PR to `main`, merge `main` into it, and wait for `ci` at that exact head.
  Do this one PR at a time, bottom-up; never merge an upper PR into its base branch (AGENTS.md: that leaves `main`
  without the work).
- **Migrations:** a migration folder's timestamp must be later than every migration on `main` at merge time. If one
  landed after yours was named, rename your folder before merging and re-run CI. Only ever rename a migration that is
  not on `main` yet (a migration on `main` may already be applied in production and must never change); the PR's
  preview database may then need a fresh branch, which is fine because previews are isolated.
- Merge conflicts in `docs/STATUS.md` or `docs/MASTER-ROADMAP.md`: keep both sides' facts; never drop another session's row.

**Write tests that survive change.** Each integration test creates its own data (no dependence on seed order or on another
test's rows); browser specs select by role and accessible name (`getByRole`, `getByLabel`), not by CSS classes or exact
marketing text, so the Batch V redesign does not break them; times are set explicitly (business-date helpers), never
"now" against a hard-coded expectation.

**Keep CI fast as you add tests.** After a PR that adds browser specs, read the printed per-file durations; if one group's
test time passes about 2 minutes, rebalance `e2e/shards.json` in your next PR. A full run should stay near 3–5 minutes.

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
# Stacked PRs cannot use the plain /merge route; use the asynchronous one.
resp=$(gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge-async \
  -f merge_method=merge -f merge_action=direct_merge -f sha=<head-sha>)
echo "$resp" | jq -r '.status, .details.message'
# Only "pending" carries a uuid. Check it once; do not enter a polling loop.
uuid=$(echo "$resp" | jq -r '.details.uuid // empty')
if [ -n "$uuid" ]; then
  r=$(gh api repos/<owner>/<repo>/pulls/<n>/merge-async/$uuid)
  echo "$r" | jq -r '.status, .details.message'
fi
# "merged" = done. "failed" = read details.message (closed, draft, or head moved).
# "pending"/"enqueued" = not merged yet. Record the uuid/status, do other runnable
# work, and re-check at the next anti-stall checkpoint (or next turn if nothing
# else remains). Never sleep/poll in a loop waiting for it.
```

Before merging, confirm the reviewers have finished: the `Running Copilot Code
Review` workflow run is completed and a Codex review exists for the current head;
then list the threads once more (see Step 5.3). Late comments on a merged PR go
into the next PR.

Merge a stack **from the bottom up**, one PR at a time. After each merge the
next PR's base may still name the merged branch: set it to `main`
(`gh api -X PATCH repos/<owner>/<repo>/pulls/<next> -f base=main`), and wait for
fresh CI at its (possibly rewritten) head before merging it. If its history now
conflicts only because the lower PR was merged with a rewritten history, rebase
the rest of the stack onto `origin/main` with
`git rebase --onto origin/main <old-lower-head> <top-branch> --update-refs`, then
push each branch with `git push --force-with-lease=<branch>:<its-old-remote-sha> origin <branch>` (never a plain force; a plain push is rejected after a rebase). The repository merges with merge commits (no squash).
A failed browser job can be re-run with
`gh api -X POST repos/<owner>/<repo>/actions/runs/<run-id>/rerun-failed-jobs`
(find the run with `actions/runs?head_sha=<sha>`; pick the one named CI). The
`ci` check can show an old failed copy next to the new passing one when a push
or retarget cancelled a run: judge the newest.

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
