# PLAYBOOK — how to deliver one batch, step by step

Follow these steps in order. Each step says what to do, what "done" looks
like, and what to do if it fails. The rules behind the steps are in
`AGENTS.md`; the work itself is in `docs/PLAN.md`.

## Step 0 — Orient once; refresh only what changed

1. Read AGENTS, START-HERE and STATUS. Resume the recorded branch/PR before
   opening a new one. Inspect local changes before switching branches.
2. Read the next roadmap/card and its relevant acceptance, design headings and
   named code/tests in bounded sections. Do not read an entire batch by default.
3. Fetch origin, inspect current main and open PRs; preserve unrelated local work.
   Do not blindly checkout/pull main over an active stack.
4. If no card exists, write it using `docs/pr-cards/README.md` from the approved
   contract and current code. A missing card is work, not a model-switch gate.
5. Check only owner inputs this capability needs; keep gated behavior off.

Done when the scope, acceptance, touched contracts and next action are clear.
There is no required ten-minute reading period.

## Step 0b — Drift check before every card and changed base

Follow `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Record the actual
base and prerequisite head. Adapt mechanical differences in the current PR.
For a semantic conflict, write a dated contract amendment and apply normal
review before implementing that slice. No compulsory stronger-model session.

## Step 1 — Branch

```bash
git checkout -b ai/<tool>/<batch-topic>     # e.g. ai/codex/batch-b-billing
```

Branch from `main`. If `docs/STATUS.md` says your batch depends on an
unmerged PR, branch from that PR's branch and note it in the PR description;
retarget to `main` once the predecessor merges.

## Step 2 — Before writing code: inventory what exists

The batches build on a lot of shipped work. For each item in the current capability:

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
below. Do not re-decide approved semantic contracts. Follow established code patterns
for ordinary naming, imports and implementation details. If an unresolved choice
would alter money, permissions, signed evidence, state transitions or provider
replay, document the conflict and obtain the normal reviewed amendment before
that slice; continue other approved work rather than ending the whole session.

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

The goal: **ship coherent, tested features with fewer CI/review/rebase cycles.**
The PR outline in `docs/MASTER-ROADMAP.md` is a planning baseline, not a mandate to
split every implementation into tiny cards. Follow the design's work-unit order.
Combine adjacent approved cards only when they share a risk area, make one complete
reviewable capability, and stay within the hard limits below. Split only when a
concrete safety, dependency, review or size reason requires it. Keep tests with
the affected behavior; never ship a half-built path or a feature without real
integration coverage where required. The fast #283–#285 and #291–#297 delivery
windows show the value of focused work and prompt merge gates, not a reason
to cut test coverage or create more parallel branches.

**How to measure the budget** (run before opening the PR; lockfile, generated files, tests, browser specs and docs are
not counted):

```bash
git diff --shortstat origin/<base>...HEAD -- src prisma/schema.prisma prisma/migrations scripts ':!scripts/**/*.test.*'
git diff --name-only origin/<base>...HEAD -- src prisma scripts | wc -l
```

**The PR sizing guardrails** (cohesion and safety first; do not split just to reduce individual connector calls):

| Limit | Budget | Why |
|---|---|---|
| Production code changed (not tests, not docs) | about **500 lines**, hard stop around 800 | A reviewer (and the next agent) can read it in one sitting |
| Production files touched | target about **15**; allow cohesive exceptions with focused review | Fewer unrelated changes mean fewer regressions |
| Migrations | **at most one**, and only in the first PR of a batch unless the design says otherwise | One schema change per CI cycle; easy rollback |
| Risk areas | **one** of: schema, money/billing, auth/permissions, provider (Stripe/email/SMS), screens | Mixing two makes a red CI hard to diagnose |
| New browser spec files | **at most one** | Browser shards are the slowest part of CI |
| Expected red CI runs | **1 or none** (3 red runs is the ceiling, see Step 8) | If you expect more, the PR is too big |
| Session | **no numeric merge limit**; merge ready PRs in dependency order while exact-head gates/reviews remain clean | Drift control comes from authoritative docs, lockstep and exact-head verification—not a counter |

Tests are not budgeted — write as many as the change needs. A PR that is mostly tests is fine.

**Stack lockstep / context anchor (Chris, 2026-10-07):** keep at most two unmerged implementation PRs open in one dependency chain. Do not keep building a third PR while the bottom PR is still changing. If the bottom PR receives a patch after its successor was branched, freeze the successor, finish/review the bottom PR, then sync/rebase the successor onto that final head before further implementation. Any dependent card or documentation PR stacks on the top prerequisite branch rather than stale `main`.

The approved design, applicable PR card, `docs/STATUS.md` and `docs/MASTER-ROADMAP.md` are the persistent context anchor. Re-read the current applicable pieces at each PR boundary and after a base changes; do not rely on an earlier session's remembered state. Session length by itself is not a stop condition. After each predecessor merges, retarget the next PR to current `main`, verify exact-head CI/performance/preview/reviews once, and merge it if clean. Continue while the next step is authorized and verified; manage a required patch, failed/pending blocking gate or review finding within the conveyor; stop only when no authorized useful work remains, an approval is required, or verified context is insufficient. Never skip exact-head gates.

**Merge conveyor (Chris, 2026-10-08):** when implementation is complete, stop changing scope. Before the first
merge attempt, perform one focused diff self-review and collect all currently open automated-review threads. Resolve every
blocking finding in one patch batch; document and assign low-risk nonblocking
findings to the immediate successor before merging, without a separate CI cycle. Then run exact-head gates; request one
further exact-head automated review only for high-risk semantic changes or an actual required-review gate. If that pass is
clean or a permitted waiver is recorded, merge promptly when CI/performance/preview are green; do not
request an additional ceremonial "final review." If that pass finds blocking issues, batch those blockers, patch once,
self-review those edits and rerun gates. Low-risk nonblocking findings from any pass use the same accountable successor
assignment in Step 5; never defer security, billing, integrity, permissions, contractual behavior or required acceptance. A further automated review is required only when the new patch changes a high-risk semantic
boundary (security, auth, money/billing, schema, provider behavior) or the repository ruleset explicitly requires it.
Pure retarget/rebase operations with an unchanged diff get fresh exact-head CI/performance/preview but do not restart the
review loop. Keep the successor frozen while its predecessor is changing, then rebase it once after the predecessor merges.

**The cheapest way to avoid CI rounds:** for any PR in the schema, money/billing or auth risk area, run the integration
tests you added or changed against the local throwaway Postgres (Step 4b, only those files) before the first push. It
costs a few minutes once per session and usually saves a whole red CI round. For screen PRs, run the one browser spec
you touched with the 4c recipe.

**Use the existing two-lane conveyor.** While a predecessor PR waits on CI or review,
build only its immediate successor, provided the base is stable and at most two implementation PRs remain unmerged.
If the successor already exists, finish targeted tests, defects, review reconciliation or merge evidence for
those same two PRs; do not spin up a third workstream or unrelated documentation PR. Automated reviewers: if Codex replies that its usage limit is reached,
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
6. **Finish all eligible work before ending.** If an external job is pending, continue
   the immediate eligible successor or finish useful checks on the existing chain.
   Only when every authorized action is blocked, record exact head, pending run
   and the next command in STATUS. A finished chat turn cannot restart itself;
   do not imply automatic background continuation or keep polling to simulate it.
7. **User updates are progress checkpoints.** Report a meaningful commit, merge, defect fix or blocking
   finding as it happens and avoid long silent waits. Tool-call count alone is not progress; batching
   several small related calls is encouraged.

**Report what the budget cost.** Put "CI runs used: N (red: R)" in each PR description and in the STATUS handoff. If two
PRs in a row needed three red runs, diagnose the shared cause before proceeding.
Split later capabilities only when scope/coupling caused the failures; repair
shared fixtures or environment assumptions once when those caused them.

**Ripple check before coding:** use narrow `rg` over tests/e2e for changed
functions, routes, settings and fixtures. Update affected regressions in the
same PR. T readiness and G two-step login are already wired at the audited
baseline: reuse their current helpers and session setup; do not recreate them
from old prospective instructions. No fixed five-minute reading period.

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
3. **Review once per PR; distinguish blockers from deferrable findings.** Gather
   current PR threads and fix security, billing, data-integrity, permission and
   acceptance blockers before merging, regardless of green CI. For low-risk
   findings, leave a source-PR comment with explicit rationale, successor PR/card
   ID and verification plan. Begin that successor with the inherited fixes and
   tests, before its new feature work. Keep unresolved threads open until proven
   fixed in the successor, then link the evidence and resolve them.
   Use the GitHub review-thread connector to inspect and resolve thread state. If unavailable,
   use authorized GitHub GraphQL reviewThreads/resolveReviewThread or GitHub's web review UI.
   REST review comments alone cannot prove thread resolution; leave the gate open if unverifiable.
   Resolve only findings proven fixed at the reviewed head. Record dispositions
   together, not in separate review passes for every push.

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

**CI diagnosis checkpoint.** Three change-caused red CI runs require evidence-based diagnosis before another push, not an automatic session stop. For each PR (a green run after merging the base
branch, or one infra re-run, does not count). After the second red run on the *same* failure, stop pushing
speculative fixes: set up the full local suite (Step 4b) or the browser recipe (4c) and reproduce it. After the third red
run, stop speculative CI pushes, not the session: reproduce the failing path
locally or use one exact failed-job trace, change the hypothesis and make an
evidence-based fix. If verification is genuinely unavailable, record the blocker
in `docs/STATUS.md` and continue the next eligible approved unit. Split only if
scope or coupling actually caused repeated failure; do not slice unrelated PRs.

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

Vercel builds a preview for every PR. For changes to any user-facing UI, including owner, staff and customer screens,
click through the affected flow at phone width (360), tablet (768) and desktop
(1440), in light and dark. For backend-only changes, confirm preview build and
relevant API/behavior evidence; for docs-only work, do not require a manual UI
walkthrough unrelated to the change. Previews use the isolated preview database and never send
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

Before merging, check whether any *required* reviewer is still running or has
blocking findings. Read available automated reviews once and use the documented
waiver if unavailable and not required by branch rules; do not wait indefinitely
for a discretionary exact-head re-review on a low-risk patch. Inspect the current
threads together (Step 5.3). Late comments on merged work go into the next PR.

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
3. Continue the next eligible approved capability while the user’s authorization
   remains active. Checkpoint only for a real gate or session boundary; include
   committed work, exact head, pending gates and next action in existing STATUS.

## If you get stuck

- Same failure after two focused fix attempts: stop speculative edits and
  inspect evidence/change the hypothesis. This does not require ending the session. Write down the error, what you tried, and the diff, in
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
  `docs/STATUS.md` and the PR; the selected model proposes a dated contract amendment, obtains the normal
  review, and resumes the affected slice. Continue eligible independent work.

## Commands and speed evidence

Use `set -o pipefail` before commands piped through `tail`; truncated output
must not hide a failed test. For prose-only PRs use the work-doc validator and
`git diff --check`; retain CI/secret scan and applicable review gates.

After the next three implementation PRs, use their existing CI/review history
to compare time to merge, failed CI runs, substantive review defects and rebase
work. Put one short finding in STATUS. Keep faster rules only if quality holds;
no separate metrics report, extra work lane or recurring approval ceremony.

## Avoid repeated setup and broad debugging (Sol-first delivery)

1. Once per session, inspect the available authenticated publication interface,
   installed dependencies/client generation and verified disposable test setup.
   Preserve them across cards. Revalidate only after lockfile/schema/environment
   changes; run all required checks for the new code head. No install or full
   database reset merely because a new card starts. Never reuse production data.
2. If CLI publishing fails for missing authentication, use an available authorized
   repository connector; do not repeatedly try the same unauthenticated push.
   Publish the complete checked tree atomically: one normal git push, or Git Data
   `create_tree` with **all** changed paths on the verified base tree →
   `create_commit` → one leased `update_ref` (or create the new branch at that
   complete commit). Include deletions/modes where applicable; preserve untouched
   base files and verify published/local tree equality. Never update the branch
   once per file or expose intermediate rebase commits. A rejected lease means
   inspect concurrent changes before retrying, not overwrite another agent.
   Local commits may be incremental; remote publication is one coherent batch.
   Save the known route in existing STATUS, without credentials.
3. Reuse real predecessor regression fixtures/helpers. Run the changed high-risk
   integration cases on the already-available disposable DB before pushing;
   include direct callers and changed fixtures. If setup is unavailable, use the
   documented CI route and carry required evidence; do not call unrun tests passed.
   This reconciles quick checks in AGENTS with Step 3a's targeted integration proof.
4. After a failure, classify it: implementation, stale fixture/contract, setup,
   or external dependency. Inspect the smallest evidence that distinguishes them.
   Change a hypothesis after two unsuccessful identical attempts; do not keep
   broad reruns or speculative edits. Fix all confirmed blocking causes in one
   patch, then run Step 4a on the complete post-fix/post-rebase tree before one
   publication. Check schema/enum consumers, required fixture fields and new
   caller mocks together, not one CI round per compiler or test error. If local
   verification is genuinely unavailable, state the missing check and reason in
   the PR and publish one complete candidate for CI; never claim it passed.
5. Choose effort by risk: light for routine existing patterns, medium for new
   transactional/security/provider/schema boundaries. A focused Sonnet second
   opinion may settle a specific ambiguity, with the normal reviewed amendment.
   Most cards remain owned by Sol; there is no model handoff gate or extra stream.
6. Keep handoff updates proportional: record next item/gate, actual changed
   interfaces and meaningful tests. “No shared contract change” is one PR line,
   not another document. Do not restart whole-batch orientation at each card.

Measure improvements from the next three existing PR descriptions: time to merge,
failed CI, cancelled superseded runs, substantive defects and rebase work. The historical PR cycle begins
at PR creation, after much implementation already occurred; it is not total
agent work time. Do not convert fewer reasoning tokens or fewer tests into a
claim of higher quality. Retain changes only when evidence supports them.
