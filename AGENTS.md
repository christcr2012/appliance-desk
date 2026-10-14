# AGENTS.md — the rules. Read this first, every session.

## Original Toolkit is reference-only — owner clarification 2026-10-14

`Robinson-AI-Systems/robinsons-toolkit-mcp` is the historical capability reference,
not an active implementation/deployment target. The standalone custom MCP servers
and optional `robinsons-toolkit-hub` replace it. Do not maintain/rebuild the original,
resume its recovery PRs, synchronize implementations back to it, or require a bridge.
Preserve its code/history for coverage and behavioral research. When the owner chooses a new provider MCP, its implementing agent inventories the
relevant legacy tool names, families, workflows and intended behavior, reconciles them
with current provider contracts, and tracks coverage in THAT project's cards/index.
The Hub stays provider-agnostic: discover/connect/authorize/route/read results for
new contract-compatible MCP servers without provider-specific handlers or a fixed
family list. Future services and legacy catalog parity are not Hub completion gates.
Do not copy provider capabilities into the Hub or start speculative server projects.
Mapped/planned is not implemented or accepted. Service autonomy and all existing
provider/security/owner gates remain binding.


## Pending professional review is an activation gate, not a development stop — owner standing rule 2026-10-14

A question for an attorney, CPA, bookkeeper or other professional **must not become a
blanket reason to stop building, testing, reviewing or merging an otherwise approved
capability**. It **does restrict using the affected feature to conduct real business**
until the necessary review, rule configuration and approval have actually occurred.
Build the complete workflow now, where technically and legally safe, so that the
professional answer can be applied as owner-controlled, validated configuration
**without another implementation PR**. Leave unrelated business functions usable.
This applies to existing and future batches. Laws and professional advice can
change: design for governed future changes, not one hard-coded interpretation.

For each review-dependent capability, agents **must**:
1. Separate **engineering readiness** (data model, calculations, screens, draft
   workflows, access controls, tests) from **decision/activation readiness**
   (professionally validated treatment, approved customer language, actual
   collection/filing/sending/LIVE use). Explicitly list the exact gated operation,
   not the entire batch, in its card and owner-input/acceptance ledger.
2. Prefer editable settings for rates, taxable categories, exemptions, thresholds,
   notice windows, retention policies, disclosures, jurisdiction choices and
   effective dates, with clear plain-English owner UI, permitted roles, input
   validation, documented unknown states and a durable audit of who changed what,
   when and why. Use a versioned ruleset/snapshot where historically material.
   Business-selectable choices **never** override mandatory legal protections.
3. Preserve immutable agreed/signed terms, prior invoices, collected payments,
   accounting/tax evidence and historical rates. A policy update applies only to
   eligible future events, with effective dates and deliberate correction/adjustment
   paths where required; do not silently reprice or rewrite old records.
4. Treat a genuinely unresolved required classification as **UNDECIDED**:
   implement safe internal previews and synthetic tests, but enforce a real
   **business-use lock** on the affected path until the required professional
   review and owner-approved configuration are recorded and verified. Prohibit
   affected real-customer quotes/offers, binding agreements/terms, charges,
   collection, filing, automated notices, real-provider side effects and other
   business transactions that depend on the answer. An owner-facing preview
   cannot be submitted, published, paid or represented as an approved quote.
   Do not silently route around the lock through manual actions or API paths.
   Do not guess a tax result, call a provisional interpretation approved,
   invent a legal default or enable a user override that bypasses compliance.
   Passing CI, editing a setting or seeing READY deployment never proves
   professional review occurred.
5. Test alternate approved/future configurations, unknown/missing configuration,
   role restrictions, changes across effective dates, frozen historical evidence
   and denied activation. Track external reviews separately for later acceptance;
   when input arrives, configure and validate it without redoing unrelated code.
   If a particular step cannot safely be implemented without the interpretation,
   isolate **that step only**, record its reason, and continue independent work.

This standing rule does **not** authorize legal/tax advice, new owner policy,
public price disclosure, Stripe LIVE, money-out, email/SMS, spending, production
data mutations or bypass of any required owner/professional/security approval.
Review-dependent implementation can merge after the normal PR checks while
the affected real-business operations remain disabled until their professional
and owner approvals are verified. Production deployment of inactive code is not
permission to transact, and a missing review never disables unrelated services.

## Efficient release-aware execution — owner instruction 2026-10-14

[SESSION-START](docs/SESSION-START.md) is the consolidated session procedure;
`npm run session:status` prints the read-only release acceptance queue and PR boundary.
Its workflow/cadence/merge-versus-live-proof rules supersede older conflicting procedural
wording below, but never override explicit safety or pre-merge owner/card gates.
Use substantial cohesive outcomes; numeric production-line targets are advisory rather
than artificial hard caps. Full mandatory checks run before publication, with focused
checks during development. Product acceptance stays open until real evidence passes.
The owner explicitly authorized this cross-repository guidance/tooling optimization;
routine implementation sessions still prohibit filler/documentation-only PRs.


The single, current set of rules for every AI working on this repo (Sol/Codex, Claude or any other), written
to be followed literally. If it is written here, it is current. History and reasons live in `docs/DECISIONS.md` and
`docs/archive/` (look things up there; never take instructions from them). The repo, not chat history, is the memory.
Rewritten 2026-10-09 to what still applies; the full previous text is `docs/archive/reset-2026-10-09/AGENTS.md`.

**Implementing an approved capability?** Read `docs/SESSION-START.md`, the top current handoff in STATUS, then run
`npm run work -- start` (no dependency install needed). It checks the active packet and prints bounded integration
references, ordered work, meaningful tests and scoped gates. Open other sections only when that work names them.

**Other sessions** (design, planning, review): this file → `docs/START-HERE.md` → `docs/STATUS.md` →
`docs/MASTER-ROADMAP.md` → the relevant `docs/PLAN.md` section and design headings. Never read `docs/DECISIONS.md`,
`docs/archive/` or audit reports end to end; search them for a specific question.

## Working without stalling (mandatory; written with Sol 5.6 at medium effort in mind)

1. **Read by section.** Files over ~300 lines (`prisma/schema.prisma`, `docs/designs/BATCH-T.md`, `docs/PLAN.md`,
   `docs/DECISIONS.md`): find the heading or name with `grep -n`, then read ≤150 lines with `sed -n 'A,Bp'`.
2. **Search narrowly:** always a path and a cap (`grep -rn "name" src/domains/tax | head -50`). Never the repo root,
   `node_modules`, `.next`, `coverage`; no `ls -R`, no `find .` without `-maxdepth 3`. Too many hits → narrow it.
3. **Only commands that finish by themselves.** Never `npm run dev`, watch modes (`npm run test:watch`, bare `vitest`),
   `playwright test --ui`, `show-report`, `tail -f`, or sleep/poll loops. Use `npx vitest run <file>`; wrap slow commands
   in `timeout 600`. Exception: the bounded CI wait in PLAYBOOK Step 10.
4. **Nothing interactive:** `GIT_PAGER=cat PAGER=cat GH_PAGER=cat CI=1`; `npx --yes`; `prisma migrate dev --name <n>`
   (`--create-only` to only write SQL).
5. **Cap output** with `| tail -80` and `set -o pipefail`.
6. **Two strikes:** the same command fails or hangs twice → change approach or record the blocker; never a third try.
7. **Explore budget:** after about 10 focused reads/searches without an edit, write down what you know and make the
   smallest justified edit with its test — or report a true blocker. Never guess unsafely to save a read.
8. **Checkpoints:** one coherent work unit with its tests → local commit → update the card's resume note. Publish the
   complete, checked tree with one push; never push per file or intermediate rebase states.
9. **External waits are checkpoints, not a loop** (PLAYBOOK Step 10). Batch related, independent read calls together.
10. **Two-lane conveyor:** lane A builds the current card and its immediate successor; lane B handles CI/review/merge of
    the predecessor. At most two unmerged implementation PRs in a chain. If the predecessor changes, freeze the
    successor, then sync it once onto final `main` after the merge. No third PR or side project to fill CI time.

**When a command appears stalled, follow
[`docs/runbooks/ANTI-STALL-RECOVERY.md`](docs/runbooks/ANTI-STALL-RECOVERY.md)
before retrying.** In particular, preflight can silently broaden a one-file
DB test into 1,000+ related tests; inspect `--plan` and use the bounded
isolated Postgres runner for the actual single-spec probe. Record the command
ID/log and distinguish an in-progress pre-push gate from a failed `git push`.

## What this is

**Appliance Desk** runs Chris Robinson's appliance rental business in Colorado (Robinson Appliance Rentals, Greeley
area): a public website for leads, the owner/staff **desk**, and a customer portal. Purpose-built for appliance rental;
no "in case" abstractions. **Chris is not a developer:** every update, question or PR summary for him is plain English —
what changed, how it was verified, what he must decide, what is next.

## Priorities (higher wins)

1. Correctness and security. 2. Legal compliance (accessibility, privacy). 3. Simplicity and maintainability.
4. Features.

## Definition of Done (non-negotiable)

1. No placeholders, stubs, TODO-as-implementation or mock data presented as real.
2. Tests exercise real behavior; business rules, permissions, money and concurrency get real tests on throwaway Postgres.
3. CI green: typecheck, lint, unit/integration, production build, browser/accessibility.
4. The capability's acceptance (from `docs/PLAN.md`) checked item by item with actual test/CI/local browser evidence;
   real provider and owner acceptance remain separate. No paid Vercel preview is required under the daily-release policy.
5. `docs/STATUS.md` updated.

If something isn't finished, say so and record it in STATUS. Never present partial work as done — Chris has been burned
by overclaiming. A passing typecheck, a screenshot or a plan is not evidence a feature works.

## Hard limits — stop and ask Chris first

- Turning on live Stripe payments, live SMS or live customer email.
- Buying anything (domains, plans, add-ons, tiers, storage).
- Deleting or rewriting real customer, billing or signature data.
- Fixtures, seeds or resets against the production database or file storage (preview/CI only).
- Changing anything outside this project (other repos, Vercel/Neon projects, Google Workspace settings not in the plan).
- Committing directly to `main`.

Never touch the Cortiware, Robinson AI Systems toolkit, YardSync, Household Assistant or oldReplit repositories,
Vercel projects or Neon projects. If a name you are about to create might already exist, ask first.

## Scope and owner decisions

Build what the current card asks, completely. Other ideas go in `docs/ROADMAP.md` and your report — don't build them
unasked. Audit and review items are already mapped to batches; work them when their batch comes up. Deferring is not
resolving: keep it listed. Owner decisions live in `docs/OWNER-INPUTS.md` with stable IDs; check there first and ask only
for what the current card needs. An answer is applied only once the setting and the behavior are verified.

**Owner-configurable by default.** Anything a business might change (prices, fees, rates, notice periods, wording,
thresholds, schedules, limits, labels, toggles) is a stored setting with a sensible starting value, explained on the
screen itself in plain words: what it does, what each choice means for a customer, the starting value and why, who can
change it, and a "restore recommended" option. If something must stay in code, say why in the PR. Money inputs are in
dollars, never cents.

**Workflow first (Batch W, 2026-10-09).** Every save that creates an obligation tells Chris what, how much, by when and
where, and puts it on his To do list; no Today item may link to a page that doesn't exist.

## How work is organized

- **Approved designs, just-in-time cards.** Implement only approved scope (`docs/designs/`, `docs/PLAN.md`). The
  implementing model writes the card for the current capability (and its immediate successor when useful) from the
  approved design and actual code (`docs/pr-cards/README.md`). Use only the matching section of
  `docs/implementation-contracts/IMPLEMENTATION-RECIPES.md` for exact integration/test patterns; refresh its
  baseline and proposed interfaces in the JIT card. Recipes never grant semantic or owner approval.
  Ordinary names and implementation details need no approval. Money, permissions, signed evidence, state transitions and provider replay follow the reviewed contract; if
  it can't work, propose a dated amendment and get it reviewed. A missing card means write it, not stop.
- **Drift and reconciliation** (`docs/implementation-contracts/DRIFT-PROTOCOL.md`): checklist A before each PR,
  B **inside each PR, describing implemented behavior with truthful pending gates** (card, next card, living docs, STATUS — CI checks it), C when a batch finishes (acceptance proved, docs match the
  code, retire what no longer instructs, drift-check the next batch). Changed contracts later work inherits go in
  `docs/designs/CHANGES-SINCE-DESIGN.md`.
- **PR size (owner, 2026-10-12):** deliver one coherent, independently verifiable outcome. 450–800 production lines
  is a useful estimate for routine lighter-model work, **not a ceiling, minimum or stopping gate**. Larger cohesive PRs
  are allowed when the selected model can implement/review/test them reliably; state the integration boundary and
  risk/validation plan before editing. Include adjacent DTO, UI, persistence and regression work needed to finish
  the capability. Split only for concrete independent risk, migration ordering, reviewability or execution limits;
  name the remaining acceptance and successor. No arbitrary one-function or warning-only slices, filler, unrelated
  features or scope inflation. Related additive migrations may share the capability when their order/upgrade/restore
  proof is explicit. Production-line counts guide review, never substitute for correctness or permission.
- **Model:** whichever model Chris selected does the work; no forced model switch. Sol 5.6 is the routine implementer:
  light effort for an already-tested pattern, medium for schema, money, auth, provider recovery or unfamiliar multi-file
  work. A missing decision is never solved by guessing. An optional second opinion may settle one concrete question.
- **Branches:** `ai/<tool>/<topic>` from current `main`, or from the unmerged predecessor's branch when stacking.
- **Use the web** for current docs and rules (framework versions, Stripe, Colorado tax, accessibility, security); cite it.

## Verify, push, review, merge (details: PLAYBOOK Steps 4–9)

- **Before pushing:** `npm run setup` once per checkout or sandbox worktree; the pre-push hook then runs `npm run check:quick`
  (secrets, migrations, shard check, route inventory, typecheck, lint) on every push. Checks remember passes on identical
  code, so nothing runs twice. Add the card's
  `npm run preflight -- --db/--browser` checks (PLAYBOOK 4b), which also run every test importing changed code. Local database testing uses throwaway
  PostgreSQL in the project's **Vercel Sandbox** (reuse the persistent sandbox named in STATUS; PLAYBOOK 4b; code reaches GitHub
  only as git commits — `git push` from the sandbox (push key installed, STATUS "Environment"), else
  `docs/runbooks/SANDBOX-PUBLISH.md`) via
  `scripts/local-postgres-test.sh` — never Neon or production. Never `--no-verify`.
- **One push per CI cycle.** A push cancels running CI. After a red run, read all failures, reproduce locally, fix them
  all, push once. Same failure twice → reproduce locally; third red run → evidence-based diagnosis before any push.
  "Flake" is not a cause; never skip, weaken or quarantine a test.
- **The `ci` check is the single merge gate**, green at the exact head.
- **Review:** read `docs/AI-PR-READ-FIRST.md` for billing, Stripe, webhooks, auth/session, email/SMS, public forms or
  preview safety, and record how each applicable constraint is honored. Freeze scope, read the automated review (Codex
  posts on PR open; Copilot reviews are no longer available — Chris ended that plan 2026-10-09, so never wait for or
  require one) and all open threads together, and fix blocking findings (security, permissions, money, data
  integrity, contract, acceptance) in one patch. A low-risk finding may move to the immediate successor with a source-PR
  comment naming the successor and its proving test; the successor fixes it first. Re-request review only for changed
  security/auth/money/schema/provider behavior or when branch rules require it. If no review is available, inspect the
  diff yourself and write "automated review unavailable — waived" — never claim a review that didn't run. Record a
  disposition for every finding (fixed / already fixed / superseded / still open). Resolve threads only after verifying
  the fix at the exact head.
- **Merging (authorized by Chris):** `ci` and all other required checks green at the exact head, PR acceptance met
  with evidence, existing required local/Actions browser checks and reviews handled → merge with the expected-head SHA.
  Vercel previews are disabled; never request one or treat its absence as a development blocker. Stacks merge bottom-up, **retargeting each PR to `main` first**. Tell Chris
  before merging if a money, security or data-loss finding is not fixed in the same PR. Merging never covers a hard limit.
- **Security or money hole already on `main`:** fix it immediately in its own PR.

## Where the rules live (one source of truth each)

| Topic | File |
|---|---|
| Starting a card session; resume note | `docs/SESSION-START.md` |
| Step-by-step procedure and testing | `docs/PLAYBOOK.md` |
| Prices, fees, statuses, transitions | `docs/BUSINESS-RULES.md` (never hard-code these elsewhere) |
| Database shape | `docs/DATABASE.md` + `prisma/schema.prisma` |
| Vercel, Neon, GitHub, env vars, CI layout | `docs/ARCHITECTURE.md` |
| Visual and accessibility rules | `docs/DESIGN-SYSTEM.md`, `docs/brand/` |
| Product behavior | `docs/PRODUCT-SPEC.md` |
| Remaining acceptance and launch gates | `docs/PLAN.md` |
| Active designs (how) | `docs/designs/` (completed ones: `docs/archive/designs-completed/`) |
| Exactly what one capability builds | `docs/pr-cards/<ID>.md` and its checked execution packet; approved design/owner inputs govern semantics |
| Current state and next item | `docs/STATUS.md`, `docs/MASTER-ROADMAP.md` |
| Owner decisions | `docs/OWNER-INPUTS.md` |
| Dated decisions and reasons | `docs/DECISIONS.md` (append one per design decision) |
| Ideas not being built | `docs/ROADMAP.md` |
| Go-live switches | `docs/GO-LIVE-CHECKLIST.md` |
| Business email addresses, aliases, send-as and where each is used | `docs/EMAIL-AND-ALIASES.md` |
| How Chris uses the product | `docs/OWNER-GUIDE.md` |
| Security/billing constraints for PRs | `docs/AI-PR-READ-FIRST.md` |
| Audit findings (reference) | `docs/AUDIT_SYNTHESIS.md`, `docs/audits/`, `docs/reviews/` |
| Retired documents (reference only) | `docs/archive/` |

## Execution packets and efficient completion

`docs/pr-cards/work-index.json` points to one active execution packet. Keep the
current card about 40–100 lines, integration references bounded, and historical
slice logs in `docs/archive/implementation-history/`. The packet records exact
current file/symbol/caller, input→storage→DTO mapping, ordered locks/side effects,
replay/rollback/unknown behavior, concrete fixture numbers and named checks. Ordinary
implementation choices need no owner approval; unresolved business/financial/security
semantics still follow approved contracts and scoped-blocker recovery.

`npm run work -- check` catches stale integration anchors/unsafe selectors; it
never approves scope or proves a feature. `plan` shows missing proposed tests and
related-source fan-out before work; `probe` is diagnostic only; `verify` refuses
missing tests and runs the existing mandatory preflight. Use `doctor` for local
hook/lock/dependency-tree problems, `drift` for changed integration paths, `metrics`
for bounded local timing/cache observations, and `prompt` for a compact restart
**draft**. Reconcile live GitHub evidence before calling a checkpoint verified.
Do not put secrets, customer data, arbitrary commands or provider IDs in packets.

Name a complete observable outcome before editing. If only a prerequisite can
land, explain the concrete safety/migration/review reason and exact unfinished
acceptance; do not rename a helper as the completed milestone. Finish docs before
final checks. Staging/committing identical files reuses actual-content pass records;
real file/mode changes invalidate them, and `--fresh` forces checks. Never remove
related regressions, browser proof or exact-head CI to improve a timing number.

## Engineering rules for every change

- **Code and tests change together.** Writes lock the row first (`SELECT … FOR UPDATE`) and re-check the staff actor
  (`assertActiveTeamActor`). Unit-test fakes must provide `$queryRaw`, the same `tx` calls and a `$transaction` that hands
  the callback that fake `tx`; when you change a domain function's database calls, update its fakes in the same commit.
- **Public sign-up stays disabled** (`disableSignUp` in `src/lib/auth.ts`); never call `/api/auth/sign-up/email` from a
  test. Disposable logins come from `scripts/create-ci-login.ts` (CI throwaway database only).
- **Money is integer cents** through existing calculation functions; never financial math in UI code.
- **Times stored UTC, shown America/Denver.** Day boundaries and reminders use the business time zone; test DST edges.
- **Roles OWNER, ADMIN, STAFF, CUSTOMER** filtered at the query/DTO boundary — hiding a link is not protection.
  Customer A must never reach customer B's data through any URL, action, search or export.
- **Next.js here has breaking changes** from your training: read `node_modules/next/dist/docs/` before framework code.
- **Secrets** never appear in code, docs, logs, screenshots or PR text.
- **Migrations are additive**, checked by `scripts/check-migrations.mjs`; production runs `prisma migrate deploy` in
  `vercel-build`.

## CI — fast, free, public

The repository is **public**: Actions minutes are free, and anything committed is public forever. CI runs in parallel
on every PR push (secret scan, typecheck + lint, 3 unit shards on throwaway Postgres, production build + 4 browser
shards; docs-only changes skip the heavy jobs but never the secret scan).
- Never commit secrets, real customer data or private infrastructure identifiers (Neon branch/endpoint ids, Vercel
  project/team ids, URLs with credentials). `scripts/check-secrets.mjs` and `gitleaks` scan the full history; if a real
  value leaks, remove it and tell Chris so it gets rotated. Don't extend `.gitleaksignore` or the allowlist without saying
  why in the PR.
- `.github/workflows/ci.yml` keeps `permissions: contents: read`, uses no repository secrets, never `pull_request_target`,
  never echoes environment values. The only workflows with write access are `sandbox-publish.yml` (pushes `ai/*` branches
  fast-forward from verified sandbox transfers, starts CI) and `daily-live.yml` (fast-forwards `live` to a green `main`
  once a day); neither uses secrets — keep them that narrow.
- **Cost (target ~$20/month, Chris 2026-10-09):** Vercel bills builds and sandbox time; GitHub Actions is free. Run
  heavy checks (full suites, browser tests) by pushing the branch and running "CI" on it, not in the sandbox; stop
  sandbox sessions when done. Only the scheduled daily checked `main`→`live` workflow releases production; no
  manual batch release, preview or promotion. See `.github/RELEASE-POLICY.md`.
- Prefer unit tests (`tests/`) over browser tests (`e2e/`); use browser tests for axe, real login/session, security
  headers and one click-through per major flow. Every new `e2e/*.spec.ts` goes in a group in `e2e/shards.json`. Never
  log in per test — reuse `e2e/global-setup.ts` sessions. New one-off checks go in the `static` job.

## How to run things

```bash
npm run work -- install     # clean per-worktree npm ci + safe synthetic Prisma generation config
npm run setup               # once per checkout/worktree: pre-push gate, HTTP/1.1, merge-based syncing
npm run work -- start       # checked active capability; works before npm install
npm run work -- route W-23  # later scope anchors; never an eligibility claim
npm run work -- plan        # selectors, proposed tests, related-graph warning; no tests executed
npm run work -- verify      # current packet checks after its proposed tests exist
npm run check:quick         # the same gate by hand
npm run test:db -- tests/y-integration.test.ts      # disposable database + migrations + fixtures, one command
npm run test:browser -- e2e/z.spec.ts              # also builds (reused when unchanged); never bare playwright
npm run preflight -- --unit tests/x.test.ts [--db tests/y-integration.test.ts] [--browser e2e/z.spec.ts]
npm run typecheck && npm run lint
npx vitest run tests/x.test.ts
bash scripts/local-postgres-test.sh tests/y-integration.test.ts
```

Some sandboxes can't reach `binaries.prisma.sh` (403): that's network policy; use the approved workaround in PLAYBOOK 4b.

## Blocker triage is scoped, remedied and revisited (owner, 2026-10-12)

One blocked operation, milestone, acceptance check, tool or credential is
**not** an automatic project-wide halt. Before declaring a blocker, inspect
its direct failure evidence and attempt every authorized remedy: underlying
code defect, environment/configuration, dependency/version, stale instructions,
CI/reviews, and owner decisions already recorded. Implement and verify
everything independent that remains possible; a blocker note alone is not
progress. Never bypass authorization, independent money-out approvals,
tenant/data-integrity protections, tests, CI or external acceptance.

For each genuine external dependency, record in `docs/STATUS.md` its exact
affected operation, proof of attempted remedy, needed permission/decision/
evidence, prerequisites, reopening trigger, and next action. Separate
implemented/tested from deployed/real provider acceptance. Reevaluate blockers
after relevant owner input, merges and environment changes and automatically
return newly eligible work to the queue. Inspect the **remaining approved work
index and dependency graph** before concluding the batch is exhausted; advance
the highest-priority independent work instead of stopping. An early stop before
the normal five substantial merged PRs requires concrete evidence of no
eligible approved work **or** a specific execution limitation, not merely a
preferred milestone blocked. Do not manufacture work, pad PR count, or request
approval that was already given. Carry this rule forward in compact handoffs by
referring to AGENTS/SESSION-START/STATUS rather than copying this paragraph.
Hosting limits, daily checked `main`→`live`, preview restrictions, Stripe
LIVE and Cortiware gates remain unchanged.

## Ending a session

1. `docs/STATUS.md`: merged, in progress (branch, PR, head SHA, CI run), blocked and why, next.
2. `docs/DECISIONS.md` entry for any design decision; `docs/ROADMAP.md` for out-of-scope finds;
   `docs/GO-LIVE-CHECKLIST.md` for any new switch, key, provider account or owner decision needed before real customers.
3. Report to Chris in plain English: what changed, how it was verified, what he needs to decide (`IN-xx`), what is next.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

## Daily release and build-cost policy (owner, 2026-10-12)

PRs target `main`. Follow [the daily release policy](.github/RELEASE-POLICY.md): only the daily scheduled job updates `live`; Vercel builds only `live`. Do not request or wait for a Vercel preview deployment, manually deploy production, or promote at a development batch boundary. Keep all existing local/Actions tests mandatory; this policy introduces no new application build/browser requirement where none existed. This newer owner instruction supersedes older batch/weekly release guidance.

## Neon idle-cost profile (owner, 2026-10-12)

Read [the verified cost profile and future scaling procedure](.github/NEON-COST-POLICY.md) before changing database capacity or adding scheduled database traffic. Keep 0.25 CU capped computes and five-minute autosuspend while no real-world workload exists; performance increases require measured need and owner-approved spend.
