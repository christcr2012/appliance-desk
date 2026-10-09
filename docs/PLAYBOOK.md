# PLAYBOOK — how to deliver one PR card, step by step

The rules are in `AGENTS.md`; the short start is `docs/SESSION-START.md`; the work is the card in `docs/pr-cards/`.
Rewritten 2026-10-09 to what still applies (full previous text: `docs/archive/reset-2026-10-09/PLAYBOOK.md`).

## Step 0 — Orient (minutes, not a reading session)

1. `git fetch origin && git status -sb`. Resume the branch/PR in `docs/STATUS.md` (and the card's
   `docs/pr-cards/<ID>.progress.md` resume note) before starting anything new. Never discard local work.
2. Read the card. If the roadmap row says JIT (no card yet), write the card first from the approved design and the
   current code, using `docs/pr-cards/README.md`. A missing card is work, not a reason to stop.
3. Read only what the card names: design headings and code, a section at a time (AGENTS "Working without stalling").
4. Check `docs/OWNER-INPUTS.md` only for inputs this card needs. Build what doesn't depend on a missing answer; keep the
   dependent behavior off; list the ID.
5. Run `npm run hooks:install` once per checkout (Step 4).

## Step 0b — Drift check (every card)

`docs/implementation-contracts/DRIFT-PROTOCOL.md` **checklist A**: compare the card's baseline with current `main`,
fill the drift table in the PR, correct the card before coding. After the PR merges, do **checklist B** (reconcile
before the next slice); when a batch's last PR merges, do **checklist C** (batch close-out) before the next batch.

## Step 1 — Branch

`git checkout -b ai/<tool>/<topic>` from current `main` — or from the unmerged predecessor's branch when stacking
(retarget to `main` after it merges). At most two unmerged implementation PRs in one chain.

## Step 2 — Inventory before coding

`grep` the domain (`src/domains/<name>/`), its actions and tests; read the `docs/BUSINESS-RULES.md` rules it touches.
Reuse existing domain functions, validators, components and fixtures. Fix wrong code in place; never rebuild.

## Step 3 — Implement in ordered commits

One work unit = one local commit. Inside it: (1) additive schema/migration + `docs/DATABASE.md` + backup/schema-health
coverage; (2) domain logic **with its tests in the same commit**; (3) server actions/routes + permission tests; (4) UI +
browser spec if the card asks; (5) docs (BUSINESS-RULES if a rule changed, DECISIONS for each decision).

While implementing:
- Read-then-write runs in a transaction that locks the row first; staff actions call `assertActiveTeamActor`.
- Money in integer cents via existing functions; store UTC, show America/Denver.
- No mock data, stubs returning success, or TODO-as-implementation. Roles filtered at the query/DTO boundary.
- **Ripple check:** `grep -rn "<changed function|route|setting|model>" tests e2e | head -50` and update every affected
  fake, fixture and assertion in the same commit (see the registry list in Step 4c).
- When a design changes behavior on purpose, update the old assertion in the same commit and cite the design line in
  the PR. If the design doesn't say it changes, the old test is right.

### Step 3a — PR size

About 500 production lines (tests/docs not counted), about 15 production files, hard stop ~800 lines, at most one
migration (only where the card names it), one risk area (schema / money / auth / provider / screens), at most one new
browser spec. Measure before opening the PR:

```bash
git diff --shortstat origin/<base>...HEAD -- src prisma scripts ':!scripts/**/*.test.*'
git diff --name-only origin/<base>...HEAD -- src prisma scripts | wc -l
```

Combine adjacent approved units when they make one testable capability within budget; split only for a concrete
reason. Tests are never budgeted.

## Step 4 — Verify before pushing (this is where most time was lost)

**Evidence (24 red CI runs, Oct 8–9):** 9 would have been caught in under 2 minutes by typecheck, lint or one test file;
4 were the same broken browser login pushed again and again; 5 were accessibility or menu-count failures on new screens;
39 more runs were *cancelled* because a new push replaced a running one. Every one cost a full CI round.

### 4a. The automatic gate — installed once, runs on every push

`npm run hooks:install` sets `core.hooksPath` to `.githooks/`. Every `git push` then runs `npm run check:quick`:
secret scan, migration check, browser-shard check and — when code changed — `npm run typecheck` and `npm run lint`.
About 1–3 minutes; it alone would have stopped 9 of the 24 recent red runs. If it fails, the push does not happen: fix and push again. **Never use `--no-verify`.**
If the hook cannot run (a publishing tool that bypasses git), run `npm run check:quick` yourself first.

### 4b. Add the checks your change needs (before the first push of a PR)

| Your change | Command (each finishes by itself) | Time |
|---|---|---|
| Docs only | `python3 docs/pr-cards/validate-index.py && git diff --check` | seconds |
| Logic, no database | `npm run preflight -- --unit tests/<file>.test.ts` | ~2 min |
| Transactions, money, permissions, schema, concurrency | `npm run preflight -- --db tests/<file>-integration.test.ts` | ~5 min first run |
| A screen, page, menu, layout, auth or seed change | `npm run preflight -- --db <tests> --browser e2e/<spec>.spec.ts` | ~8 min (one build) |

Repeat `--unit/--db/--browser` for every affected test, including existing ones for changed code. With `--db` or
`--browser`, preflight also runs **every test that imports a changed source file** (`vitest related`) inside the same
throwaway database — this finds the stale fakes, registries and consumers you didn't think to select. Use `--db` for
any domain change so this runs; `--unit` alone skips it (many importing tests need a database). `--plan` shows the
commands without running them (a plan is not proof). Use `--base <ref>` when stacked.

**Getting code to GitHub.** Code reaches GitHub only as git commits. If you have a normal git checkout that can push,
commit and push there (pushing a branch with no PR open runs no CI — `ci.yml` runs only on pull requests and `main`) and
fetch the branch in the sandbox to test it (`git fetch origin <branch> && git reset --hard origin/<branch>`; the repo is
public). **If you work in the sandbox and reach GitHub only through a chat tool, publish with
`docs/runbooks/SANDBOX-PUBLISH.md`**: `node scripts/sandbox-transfer.mjs pack ai/<branch>` in the sandbox, upload the
small parts (manifest last) to a `transfer/<id>` branch, and the "sandbox publish" workflow checks, rebuilds and pushes
them. Never copy source files one by one through tool output (they get cut off), and never put a GitHub key in the
sandbox.

**Local PostgreSQL = Vercel Sandbox (owner standard).** All local database and database-backed browser testing runs in
the project's Vercel Sandbox, never Neon, production or another database service. Exact steps (Vercel MCP tools; the
CLI fallback for each tool is `vercel api /v2/sandboxes/...`):

1. **Reuse the persistent sandbox — never create one per card.** `list_named_sandboxes` (project `appliance-desk`,
   sort `statusUpdatedAt`) and take the most recent *persistent* one; its name is recorded in `docs/STATUS.md`
   ("Environment"). Resume it with `get_named_sandbox` `{ name, projectId: "appliance-desk", resume: true }` and use the
   returned session id. Saved snapshots expire after 7 days unused; if resume fails, create one persistent sandbox
   (runtime `node22`), record its name in STATUS, and tell Chris.
2. **Run commands** with `run_session_command` `{ command: "bash", args: ["-lc", "<cmd>"], wait: true, timeout: 1200000 }`
   (never `sudo`; the sandbox user is `ubuntu`, which the launcher requires), then read output with
   `get_session_command_logs`. Pipe through `| tail -80`.
3. **Layout:** the main checkout is `/vercel/appliance-desk`; each card gets a worktree beside it:
   `cd /vercel/appliance-desk && git fetch origin && git worktree add ../appliance-desk-<card> origin/<branch>` (or
   `git -C ../appliance-desk-<card> pull` when it exists). First time in a worktree: `npm ci` (dependencies are reused
   afterwards). Remove worktrees of merged cards: `git worktree remove ../appliance-desk-<old-card>`.
4. **Test:** in the worktree, `npm run preflight -- --db tests/<file>.test.ts [--browser e2e/<spec>.spec.ts]`, or
   `bash scripts/local-postgres-test.sh tests/<file>.test.ts`. PostgreSQL 18 lives at `/usr/lib/postgresql/18/bin` (not on
   `PATH`; `which postgres` failing means nothing). The launcher creates a fresh localhost-only `appliance_desk_test`,
   migrates, seeds CI-only fixtures, runs the tests and deletes the cluster; it never reads an existing `DATABASE_URL`.
5. **Stop the session when the card's local checks are done** (`stop_session`); the persistent sandbox keeps its
   snapshot for next time.

**When checks report failures — the fix-and-retest loop** (2026-10-09: a session stopped after a broad preflight
reported four failures). Never stop on a red result, and never re-run the whole gate to "see if it still fails":
1. Write the failing test names into the resume note.
2. Take one failure at a time: run **only that file** (`npx vitest run tests/x.test.ts -t "<name>" 2>&1 | tail -80`, or
   `preflight -- --db tests/x-integration.test.ts` if it needs the database), find the cause, fix it, re-run that file
   until it passes, commit.
3. A failure not fixed after two focused attempts: record what you know in the resume note and move to the next one.
4. When every listed failure passes alone, run the full preflight **once**. New failures → back to step 1.

Local PostgreSQL results are earlier evidence, **not** a substitute for CI's PostgreSQL 17 jobs. If the sandbox truly
can't be used, record the exact failing step and let CI supply the proof — never claim unrun tests passed.

**Browser.** `--browser` builds once and runs the spec with saved CI logins. If Chromium or Google Fonts are blocked, set
`LOCAL_TEST_CHROMIUM` (existing Chromium path) and `LOCAL_TEST_FONT` (an existing `.woff2`). Never `playwright install`.

**Prisma 403 (`binaries.prisma.sh` blocked).** Network policy, not a bug: use the approved local placeholder-engine
workaround only when needed; never commit generated clients or engines.

### 4c. The registries that break CI when you forget them

| You added or changed | Also update (same commit) | Proved by |
|---|---|---|
| A Prisma model or column | `BACKUP_MODEL_POLICY` (`src/domains/backup/manifest.ts`), schema-health list | `tests/backup.test.ts`, `tests/schema-health.test.ts` |
| A foreign key | cleanup order in integration tests that delete the parent | the affected `*-integration.test.ts` via `--db` |
| An automation rule | `AUTOMATION_RULES` order/fields (`src/domains/automation/health.ts`) | `tests/automation-health.test.ts` |
| A desk page | `e2e/route-inventory.ts` | `tests/accessibility-route-inventory.test.ts` |
| A menu entry | `src/lib/desk-navigation.ts` and the menu-count assertions | `tests/desk-navigation.test.ts`, `e2e/desk-workspace.spec.ts` |
| A browser spec file | a group in `e2e/shards.json` (lightest) | `node scripts/e2e-shard.mjs --check` |
| A domain function's database calls | the unit-test fakes (`$queryRaw`, `tx` calls, `$transaction`) | related tests via `preflight --db` |
| A new screen | color contrast and scrollable regions (focusable `tabIndex={0}` + label) | the screen's browser spec (axe) |
| Login, middleware, layout, seeds | — | **any one** browser spec: global login runs first |

## Step 5 — Pushing and CI

1. **Push once per CI cycle.** A push cancels the running CI. Push when the PR's cluster is coherent and 4a/4b passed.
   Don't push again while CI is running unless the running head is already known bad.
2. **After a red run:** read *all* failures (`gh api repos/<owner>/<repo>/check-runs/<job_id>/annotations`, then the
   failed job log; GitHub shows only 10 failures per step). If every browser shard failed the same way, read one.
   Reproduce the failing file locally with 4b, fix every failure, let the hook pass, push once.
3. **Is it mine?** If the same test is red on `main`, it isn't: port the fix or make a tiny separate fix PR.
4. **Same failure twice:** stop guessing; reproduce locally. **Third red run on a PR:** evidence-based diagnosis before
   any further push; record a real blocker in STATUS if verification is impossible.
5. "Flake" is not a cause. Re-run once only if the job died before any test ran. Never skip, retry-loop or quarantine.
6. Put "CI runs used: N (red: R, cancelled: C)" in the PR description.
7. The `ci` check is the single gate and must be green **at the exact head** you merge.

**When `main` moves while your PR is open.** If the new commits change only docs
(`git diff --stat <your-base>..origin/main -- src prisma tests e2e scripts` prints nothing), no drift re-check is needed:
`git merge origin/main` before your final push. Conflicts in `docs/STATUS.md`, `docs/MASTER-ROADMAP.md` or
`work-index.json`: keep **both** sides' entries, then re-run `python3 docs/pr-cards/validate-index.py`. If code changed,
re-check only the parts of drift checklist A that touch your card's paths.

## Step 6 — Docs as if merged, then open the PR

Write the docs for the world **after** this PR merges (DRIFT-PROTOCOL checklist B — CI checks it): the card says
`MERGED (#n)`, `docs/STATUS.md` says it merged and names the next card, and the living docs describe the new behavior.
Also update `docs/DECISIONS.md` (dated decisions), `docs/ROADMAP.md` (out-of-scope
ideas), `docs/OWNER-INPUTS.md` (new questions/answers), `docs/GO-LIVE-CHECKLIST.md` (new switches or keys).
PR title `<type>: <plain description>`. Description in plain English: what Chris can now do; the acceptance list with
evidence (test names, CI run, preview URL); owner decisions (IN-xx or none); review dispositions; what is not included;
CI runs used. Delete the card's resume note in the final commit.

## Step 7 — Review

1. Billing, Stripe, webhooks, auth/session, email/SMS, public forms, preview safety: re-read `docs/AI-PR-READ-FIRST.md`
   and write one line per applicable constraint in the PR.
2. When implementation is complete, freeze scope. Read the automated review (Codex posts on PR open; there is no Copilot review any more — don't request or wait for it)
   and every open thread together. Fix all blocking findings (security, permissions, money, data integrity, contract,
   acceptance) in one patch. A low-risk finding may move to the immediate successor: comment on the source PR with the
   finding, why deferral is safe, the successor card and the test that will prove it; that successor fixes it first.
3. Ask for another automated review only when the patch changes security, auth, money, schema or provider behavior, or
   branch rules require it. If no review posts (outage/quota), inspect the diff yourself and write "automated review
   unavailable — waived"; never claim a review that didn't happen.
4. Resolve a thread only after verifying the fix at the exact head (review-thread connector or GraphQL
   `resolveReviewThread`).

## Step 8 — Preview

Every PR gets a Vercel preview (isolated database; never sends messages or charges cards). For UI changes click through
the flow at 360, 768 and 1440 px in light and dark. Backend: confirm the preview built. Docs: nothing to click.

## Step 9 — Merge (authorized when all are true)

`ci` green at the exact head; acceptance met with evidence; preview checked; reviews handled. Merge with the
expected-head SHA (merge commits, no squash). Stacks merge bottom-up: **retarget each PR to `main` before merging it**
(merging into its base branch leaves `main` without the work), wait for fresh `ci` at that head, then merge.
`gh api -X PUT repos/<owner>/<repo>/pulls/<n>/merge-async -f merge_method=merge -f merge_action=direct_merge -f sha=<head>`
returns `merged`, `failed` (read the message) or `pending` (record it, do other work, check once later — no polling).
After the lower PR merges, sync the successor **once** onto final `main`. A migration folder's timestamp must be later
than every migration on `main` at merge time (rename only if not yet on `main`). New commits make evidence stale.

## Step 10 — Waiting and stopping

- External waits are checkpoints: check once, act on anything new, then build the immediate successor (if its base is
  stable) or finish checks on the current chain. No live log watching, no rapid polling.
- If finite CI is the only remaining dependency, a quiet bounded wait is allowed: at most 60 seconds per wait,
  10 minutes total, e.g. `timeout 300 gh run watch <run-id> --exit-status --interval 60 > /tmp/ci-wait.log 2>&1`;
  timeout means pending, not passed.
- A finished turn cannot restart itself. Before ending: commit, update the resume note and `docs/STATUS.md` (exact head,
  pending gates, next action), and tell Chris in plain English.

## If you get stuck

- Same failure after two focused attempts: stop editing, inspect the evidence, change the hypothesis.
- A decision that can't be undone (schema, money, data deletion, public promises) and isn't in the design: prepare the
  work, set out the choice, stop that slice.
- Docs contradict code: tests are the truth for behavior, `AGENTS.md` for rules, `docs/PLAN.md` for scope, the card and
  design for how. Note it in STATUS and fix the doc in your PR.
- The design can't work against the real code: don't improvise in code — record what's wrong, propose a dated
  amendment, get it reviewed, continue independent work.
