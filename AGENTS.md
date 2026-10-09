# AGENTS.md — the rules. Read this first, every session.

This file is the single, current set of rules for every AI system working on
this repo (ChatGPT/Codex "Sol", Claude, Copilot, or any other). It is
written to be followed literally. There are no "superseded" layers in it: if
something is written here, it is current. History and the reasons behind
decisions live in `docs/DECISIONS.md` and `docs/archive/` — those are for
looking things up, never for instructions. The repo — not chat history — is
the memory: if it isn't written down here or in `docs/`, the next session
won't know it.

Reading order once per session; refresh only changed sections:

1. This file.
2. `docs/START-HERE.md` — what the project is, where everything lives.
3. `docs/STATUS.md` — exactly where work stands right now and what is next.
   Then `docs/MASTER-ROADMAP.md` — the one ordered list of every remaining step, what
   must be true before each starts, and what only Chris can do.
4. `docs/PLAN.md` — the section for the batch you are working on.
5. Your PR's card in `docs/pr-cards/` if it has one, then only the design sections it names in
   `docs/designs/BATCH-<X>.md` (find them with `grep -n "^## \|^### "`; never read a large design top to bottom).
6. `docs/PLAYBOOK.md` — the step-by-step procedure for doing a batch.

Then open only the reference docs the batch section names. Do not read
`docs/DECISIONS.md`, `docs/archive/`, or the audit reports end to end — search
them when a specific question comes up.

## Working without stalling (every model; written with Sol at medium effort in mind — Chris, 2026-10-07)

Sessions stall when a model reads something huge, searches too broadly, or runs a command that never ends. These rules
are mandatory:

1. **Read by section, never whole files over ~300 lines.** Big files: `prisma/schema.prisma` (~2,600 lines),
   `docs/designs/BATCH-T.md` (~1,800), `docs/PLAN.md`, `docs/DECISIONS.md`, `docs/designs/BATCH-C-LITERAL-SPEC-*.md`,
   `docs/designs/BATCH-B2.md`. First list headings (`grep -n "^## \|^### " FILE`) or find the name
   (`grep -n "model Invoice " prisma/schema.prisma`), then read at most 150 lines (`sed -n '120,270p' FILE`).
2. **Search narrowly, always with a path and a cap.** `grep -rn "recordPartUsage" src/domains/purchasing | head -30`.
   Never search the repo root, `node_modules`, `.next`, `coverage` or `playwright-report`; never `ls -R` or `find .`
   without `-maxdepth 3`. If a search returns more than ~50 lines, narrow it instead of reading it.
3. **Every command must finish by itself.** Never run `npm run dev`, `npm run test:watch`, bare `vitest`/`npx vitest`
   (watch mode), `playwright test --ui`, `playwright show-report`, `tail -f`, `gh run watch`, or sleep/poll loops. Use
   `npx vitest run <file>`; wrap anything that might be slow in `timeout 600`.
   Exception: when finite CI is the only remaining dependency, PLAYBOOK's quiet, bounded completion wait is allowed;
   this is not an infinite watcher or a reason to end the turn.
4. **Nothing interactive.** Set `GIT_PAGER=cat PAGER=cat GH_PAGER=cat CI=1` (or use `git --no-pager`); use `npx --yes`;
   `prisma migrate dev` always with `--name <name>` (and `--create-only` when only writing the SQL); never a command that
   asks a question.
5. **Cap output.** Pipe long output through `| tail -80` (failures are at the end). One failing test:
   `npx vitest run tests/x.test.ts -t "name" 2>&1 | tail -80`.
6. **Two strikes.** If the same command fails or hangs twice, do not run it a third time: change approach, or write the
   blocker in `docs/STATUS.md` and move to the next work unit.
7. **Explore budget: about 10 purposeful reads/searches, then edit.** Restore the working rule from PRs
   #283–#285. Read the approved design/card and relevant code/tests; do not launch a broad audit. If the next
   edit is still uncertain after about 10 focused inspections, write down the concrete question, make the
   smallest justified implementation edit with its test, or report a true design/authorization blocker.
   Three reads is *not* a stop condition; never make an unsafe guess to satisfy a tool-call quota.
8. **Meaningful work checkpoints.** Complete a coherent work unit with its tests, commit locally, and
   push a reviewed logical PR once. Don't turn every function, tiny migration detail, or single test into
   a separate PR. Publish only the complete validated tree, with one branch-ref update per coherent batch;
   never publish intermediate per-file reconstruction/rebase heads. A short checkpoint note precedes long
   steps; the durable local git commit is the checkpoint. See PLAYBOOK publication recipe.
9. **External waits are checkpoints, not a work loop.** Inspect exact-head CI/review/preview once,
   act on new evidence, and work on another eligible item without polling or watching live logs.
10. **Two-lane conveyor, not extra workstreams.** Lane A implements the currently approved batch and
    its immediate successor; Lane B processes review/CI/merge of the predecessor. These are phases
    of ONE ordered work chain, not independent projects or extra planning streams. Keep at most two
    unmerged implementation PRs. When predecessor code changes, freeze its successor until the predecessor
    merges, then sync the successor ONCE onto final `main`. Resume that successor's same approved work;
    never create a third PR or a fresh planning workstream merely to fill CI time.
11. **Use the parallelism already available.** While a completed PR's checks run, build the immediate
    successor if the base is stable. If the predecessor needs a fix, batch every actionable failure/review
    item into one patch, confirm targeted tests, push once, then continue. Do not open unrelated branches,
    repeatedly restart review, or stop implementing just because a non-blocking gate is pending.
12. **Batch bounded connector work by purpose, not by arbitrary call count.** Fetch several related
    PR metadata records, small code sections, review states or independent status checks together when
    this eliminates round trips. Emit compact summaries; exclude giant diffs and long unfiltered logs.
    Keep sequential ordering for dependent writes and expose their results. Splitting an efficient
    batch into one tiny connector call per file is NOT an anti-stall strategy.
13. **Failure recovery.** Use non-interactive commands, output/time bounds, and at most two identical
    failed attempts. For tool failure switch to a proven alternate interface, smaller payload, or
    exact-file operation. Preserve committed work and continue the active objective if possible.
14. **One-pass review and merge.** Freeze scope when implemented; inspect the diff and all current
    review findings together, fix blocking findings in one regression-tested patch, and assign only
    low-risk nonblocking findings to the immediate successor with rationale and verification plan
    (PLAYBOOK Step 5). Never defer security, money correctness, data integrity, required acceptance or
    a required gate. Verify exact-head CI/performance/preview and merge when gates are clean. Do not request
    ceremonial re-reviews or repeatedly fetch unchanged thread state. For high-risk semantic changes
    and mandatory branch rules keep the applicable review gate.
15. **Quality-aware throughput tuning.** After the next 2–3 PRs, compare elapsed time, useful code
    and tests delivered, review defects, red CI rounds, rebase/replacement PRs and merges. Improve
    the existing two-lane process based on observed bottlenecks; do not optimize by dropping tests,
    creating more streams, or making PRs artificially small. Continue until a genuine owner,
    design, external or verification gate blocks productive work.

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

## Sol-first implementation profile — owner request, 2026-10-08

Sol 5.6 is the routine implementer and execution-card author. Use light effort
for a bounded adaptation using an already-tested contract; use medium for schema,
money, authorization, provider recovery and unfamiliar multi-file behavior.
Effort is chosen by actual risk, not the card's length. Missing semantic decisions
are not solved by guessing at light effort. A focused deeper pass or occasional
Sonnet 5.5 second opinion can answer one concrete disputed contract with named
code/tests; it is optional, creates no extra workstream, and never approves an
owner-only choice. No forced model switch and no claim of benchmarked performance.

Before editing, name the invariants and their meaningful regression cases. Keep
routine card authoring within the existing bounded exploration pass; link an
unchanged approved contract instead of transcribing the whole schema/design.
Spend reasoning on changed behavior, failure paths and producer/consumer updates.
Reuse verified session setup and fixtures; never rebuild a local test environment
per card. Current dependencies/generated client/schema and isolated disposable
storage/database must still match the branch. Record only useful environment
facts in existing STATUS, with no secrets; invalidate stale facts after changes.

At each PR boundary refresh only changed card/base contracts and relevant review
findings. Update shared CHANGES-SINCE-DESIGN only for downstream-relevant contract
changes; mechanical path corrections and “no contract change” belong in the card/
PR, not repeated design amendments. Preserve current acceptance, targeted tests,
full CI/secret checks, preview where applicable and required semantic review.

## How work is organized

- **Approved contracts, just-in-time execution cards.** The selected implementing
  model may write a short card for the current capability and its eligible immediate
  successor from the approved design and actual code. Sol 5.6 at light/medium effort
  is the intended routine workflow, not a guarantee of model performance. Reserve
  deeper analysis for a concrete unresolved semantic conflict. Ordinary names,
  imports, fixtures and implementation details do not require owner approval.
  Money, permissions, signed evidence, state transitions and provider replay must
  follow the reviewed contract; propose a dated amendment when it cannot work.
  A missing execution card means write it before coding, not stop for another model.
  Unapproved/DRAFT business scope still requires acceptance.
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
  with its tests and docs, and reviewed in one sitting. **Concrete sizing guide:** target about 500 production-code lines and 15 production files,
  with an exceptional hard stop around 800 production-code lines, at most one migration and
  one risk area. Combine adjacent already-approved work units when they form one testable,
  reviewable capability within this guide; avoid arbitrary one-function/one-PR fragmentation.
  Do not combine unrelated money, auth and provider changes just to inflate PR size.
  There is **no numeric merge-per-session limit**. Merge ready PRs in dependency order whenever their exact-head
  CI/performance/preview/review gates are satisfied. Keep at most two unmerged implementation PRs open in one dependency
  chain so later work cannot drift far ahead of a changing base. If the lower PR changes after its successor was branched,
  freeze the successor and sync/rebase it onto the lower PR's final reviewed head before opening another implementation PR.
  Dependent card/docs work must stack on the top prerequisite branch instead of targeting stale `main`.
  **The authoritative design, PR card, STATUS and roadmap are the context anchor**: re-read the applicable current docs
  at PR boundaries and after any base change. Session length alone is not a stop condition when those sources remain current
  and exact-head gates are clean. When a gate blocks the next PR, address the gate or move to the immediate eligible successor while its base stays stable;
  a pending check, actionable failure or review finding is work to manage, not by itself an instruction to end the chat.
  See `docs/PLAYBOOK.md` Step 3a. The PR list for every remaining batch is `docs/MASTER-ROADMAP.md` Work coverage and `docs/pr-cards/work-index.json`.
- **CI is free and fast, so lean on it** (Chris, 2026-10-03; details in the
  "CI" section below). Do not drop tests to save minutes, and do keep CI fast
  (the "Keeping CI fast" checklist in `docs/ARCHITECTURE.md`).
- **Merge conveyor — batch findings, then merge (Chris, 2026-10-08).** Once a PR is implementation-complete,
  freeze feature scope. Do one focused self-review plus one collection of all currently open automated-review findings,
  fix blocking findings in a single batch. Only low-risk nonblocking findings may carry to the immediate successor
  under PLAYBOOK Step 5; inherited fixes precede new feature work. Run exact-head gates once; request a further automated
  review only for high-risk semantic changes or an actual required-review gate; do not request ritual "final reviews" after a clean pass. A rebase/retarget that changes no
  diff requires fresh exact-head CI/performance/preview but not another discretionary review. If the required exact-head
  re-review finds a new blocking issue, batch blocking findings from that pass, patch once, self-review the patch, and rerun gates;
  request another automated review only when the patch changes security, money/billing, auth, schema, provider semantics,
  or the reviewer is required by the ruleset. Merge immediately when required gates are green. Do not hold a green PR
  open to perform extra optional review cycles.
- **Anti-stall rule (Chris, 2026-10-06): external waits are checkpoints, never the work loop.**
  Check CI/reviewer/deployment state once, act on any new result, then immediately do other runnable work.
  Never make back-to-back status checks when the first check produced no actionable change. Re-check only after
  substantive work has been completed, the user asks for status, or the result is now the only remaining dependency.
  Do not tail/watch live logs. On a failure, read the smallest root-cause set first (for example static/build plus one
  genuinely failing test shard); do not inspect four browser logs that all failed because the same build failed.
  After two tool/API failures on the same operation, change approach or record the blocker instead of retrying the
  same call. If ordinary finite CI is the only remaining dependency, remain in the active turn and use the
  quiet bounded completion wait in PLAYBOOK (up to 60 seconds per wait, 10 minutes total). Do not end with
  “waiting for CI” while that completion window is available. If the budget expires, diagnose the queue/job once;
  end only for a verified external blocker or actual session/tool limit, with exact head and next action.
  Commentary updates are checkpoints, not final responses. An ended turn cannot restart itself from repo instructions.
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
- **Drift check before every card and changed prerequisite.** Follow
  `docs/implementation-contracts/DRIFT-PROTOCOL.md`. Adapt mechanical drift in
  the same PR; record actual schema/signatures/guards and successor implications
  in `CHANGES-SINCE-DESIGN.md`. Freeze only the affected successor after a base
  change, sync once, and repeat checks for the changed contracts.
- **No mandatory model handoff.** The selected model can write and review a
  design amendment under the existing review rules. Stop only the dependent
  slice for an unresolved decision or explicit owner gate; continue eligible work.
- **Model:** whichever model Chris has selected does the work. Older documents
  that assign cards to "Luna" or "Sol" or schedule model switches are
  historical. Do not stop to ask for a model switch.
- **Branch names:** `ai/<tool>/<topic>` (for example `ai/codex/batch-b-billing`).
  Branch from current `main`, or from the previous unmerged PR's branch when
  stacking; retarget `main` once the predecessor merges.
- **Targeted publication preflight (owner, 2026-10-08):** run
  local database and database-backed browser tests in **Vercel Sandbox PostgreSQL**.
  Missing binaries in a ChatGPT scratch checkout are not sandbox unavailability:
  connect to the project's existing sandbox first (PLAYBOOK 4b). Never substitute
  Neon, a production database or a different external database service.
  For publication checks use
  `npm run preflight -- --unit tests/<behavior>.test.ts`, use `--db` for
  transaction/money/permission/schema regressions, and `--browser` for affected
  screen/spec tests. Combine selectors so database/browser tests share one fresh
  localhost-only cluster. Include adjacent consumers/mocks, not just new tests.
  Refresh the target base; use `--base <prerequisite-ref>` for stacks. Recheck the
  complete changed tree after repairs/rebase; a prior green head is not proof.
  Schema/enum changes still require a freshly generated Prisma client, exhaustive
  consumers and fixture/mocking updates before these checks.
  See PLAYBOOK Step 4 for optional preinstalled Chromium/font overrides and
  concrete local setup blockers. Never replace local Postgres with production or
  Neon, install a browser in the sandbox, claim skipped tests ran, or drop full
  exact-head CI. A blocked local check requires explicit evidence and CI proof,
  not speculative repeated pushes. Run the full local suite only when warranted.
- **Documentation-only checks:** validate changed links, work-index dependencies,
  contract consistency and `git diff --check`; do not run application tests that
  cannot exercise a prose-only change. CI and secret scanning still apply.
- **Bounded diagnosis:** after two unsuccessful speculative fixes, inspect the
  failure evidence and change the hypothesis. This is a diagnosis checkpoint,
  not an automatic session stop. Record a real blocker only when evidence is
  unavailable or a gated decision is required. Continue independent eligible work.
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
- **Review findings have one owner; defer only when safe.** Fix any finding that affects
  security, permissions, money, data integrity, contractual behavior, or the PR's
  required acceptance before merging. Green CI alone does not override a valid
  blocking review finding. Low-risk nonblocking findings may move into the immediate
  next planned implementation PR when the present PR's required gates are green:
  record the precise finding, why deferral is safe, its successor PR/card owner,
  and the required regression or verification in a comment on the original PR.
  Resolve the original thread only after the successor's fix is verified, then
  link that proof back. Start the successor by correcting its inherited findings
  before developing its new capability. If no suitable next PR is approved,
  fix the finding now rather than leave an unowned loose end.

## Review continuity — before each PR

1. Read `docs/AI-PR-READ-FIRST.md` if the batch touches billing, Stripe,
   webhooks, auth/session, email/SMS, public forms, or preview/runtime safety.
   Its constraints are blocking. Record in the PR how each applicable one was
   honored.
2. Check the previous batch's PR and any PR it depends on for review comments
   and unresolved threads. The historical inventory is
   `docs/reviews/2026-10-01-review-reconciliation.md`. "Merged" or "outdated"
   is not proof a finding was resolved.
3. Fix blocking findings on their source PR; address documented low-risk
   predecessor findings first in the named successor PR, with regression tests
   where relevant. Record a disposition for every finding you looked at:
   *fixed (evidence)*, *already fixed (evidence)*, *superseded (by what)*, or
   *still open (why, next step)*. Never silently drop one.
4. Resolve a review thread only after verifying the fix at the exact head.
5. **Review only when there is new evidence to review.** Read the initial automated
   review when available, or document its permitted waiver after checking actual
   review state. After batching valid findings, request a further exact-head review
   only for changed security, auth, money/billing, schema or provider semantics, or
   when branch protection requires it. A docs-only, formatting or pure retarget
   change does not trigger another discretionary reviewer-wait cycle. Always rerun
   exact-head CI/preview checks as applicable; required branch reviews cannot be waived.

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
| Exactly what one PR builds (files, signatures, tests, what to read) | `docs/pr-cards/<PR>.md` — wins over the design where they differ |
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

1. **Targeted preflight, then one coherent push; CI runs the full suite.**
   Use the selected behavior/database/browser checks above before publication. Push a PR when its cluster is coherent, not after every edit — a new
   push cancels the running CI. When CI fails, read the **full** logs (CI's
   summary shows only the first 10 failures per step; fetch the job log through
   the API), fix everything you can see, and push once. **Three-red diagnosis checkpoint per
   PR:** after a second red run on the same failure, reproduce locally instead of
   guessing; after a third, diagnose with evidence before any further push (`docs/PLAYBOOK.md` Step 8, which also
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

**Browser tests locally:** use targeted preflight (PLAYBOOK 4c). The launcher supports
optional existing Chromium/font overrides; `playwright install` is forbidden in
the sandbox. Inspect installed resources before declaring setup unavailable.

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
