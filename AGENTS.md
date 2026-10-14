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


## Roadmap order, complete batches and immediate owner escalation — permanent owner rule (2026-10-14)

The authoritative approved roadmap, indexed batch order and current checked
execution packet determine **what is developed next**. Work from actual main;
reconcile newer merged work first. Treat each active batch/subdivision as an
**outcome to finish**, not a source of unlimited one-helper PR slices. Finish
the current planned unit and its coherent end-to-end integration/verification
before advancing to the next ordered unit. A PR-count target or easier task
elsewhere **never** justifies skipping unfinished work. PRs may be large enough
to complete the outcome while retaining independent risk/CI/review boundaries;
never invent filler work to satisfy cadence.

If a selected step appears blocked:
1. Investigate the exact cause and attempt authorized remedies. Check existing
   owner answers, current approved design, interfaces, infrastructure and official
   sources before claiming missing input. If a **necessary owner decision** is
   genuinely missing, ask the owner **immediately in the active conversation**,
   with the minimal exact question, available options and recommended choice.
   Do not make that choice without the owner or silently put the feature into
   a future batch; record the answer and resume **the same session and unit**.
2. If a technical problem is within scope, solve it now and preserve the
   intended implementation sequence; do not prematurely mark it a blocker.
   If a professional determination is needed, research and implement the full
   configurable feature with provisional, source-backed settings; the
   professional sign-off restricts affected **real business use only**.
3. Only genuinely external acceptance waiting on a checked live deployment,
   provider credentials/events, legally required sign-off, or another
   independently controlled future event may remain in the **scoped acceptance
   queue**. State the required revision, exact verification step, responsible
   approver, re-entry trigger, and present evidence. Continue **eligible
   engineering within the same batch**; do not reclassify unimplemented code as
   release-dependent acceptance.
4. If a truly unavoidable obstacle prevents that precise implementation
   step and owner help cannot resolve it in this session, explicitly identify
   the failed attempt, minimal needed action, and re-entry point to the owner.
   Preserve the branch and handoff. Never quietly defer unfinished work,
   claim a batch complete, or start its dependent successor.

The active packet, roadmap/status and owner-input register must agree. Update
them in the substantive PR as implementation advances, with truthful distinct
states for coded, CI-proven, released and externally accepted. Normal session
PR cadence is subordinate to **ordered complete capabilities and safety gates**.
A session handoff points back to the same unfinished unit unless engineering
completion is supported by evidence; real external acceptance may remain in
the explicit queue without blocking unrelated, already-eligible code.
Independent parallel work must be explicitly roadmap-eligible; do not advance
to a dependent successor while eligible engineering in this unit is unfinished.

## Owner questions and publicly researched regulatory defaults — permanent protocol (2026-10-14)

**Owner-business decisions are a short interaction, not a permanent dependency.**
Before making or postponing a decision, search OWNER-INPUTS, dated owner decisions,
current config and the governing design. If an implementation **actually needs**
a missing business-specific choice (policy, price, operational preference, grant,
or user-provided factual input), pause that dependent operation and ask the owner
the **smallest precise actionable question** in the current chat. Give an
understandable recommendation and consequences/options when helpful; do not
invent the owner's answer. Preserve the branch, exact question/decision ID,
acceptance impact, and resume point. On answer, record it in the decision register,
implement it and **resume the same session**; do not make the owner restart the
batch or ask the same question again. If another eligible unit is independent,
continue it while the answer is outstanding. Only an actual required owner
decision justifies interrupting; not technical architecture or a question that
can be answered from existing instructions.

**Research answerable law instead of asking the owner for legal facts.**
For legal, CPA, regulatory and record-retention dependent features, agents must:
1. Research the relevant **current official** legislation, regulations, agency
   guidance and government FAQs; include **local/home-rule jurisdiction** rules
   when applicable. Check enactment versus effective dates, applicability,
   amendments, official interpretations and reliably announced future changes.
   Note access date and exact source URLs in the relevant card/decision record.
   Secondary commentary may orient research but is not evidence of the law.
2. Choose the most supportable **provisional initial settings** from that research
   (including future effective-dated revisions when the effective rule is actually
   enacted/officially adopted). Distinguish known law, interpretation, case-specific
   uncertainty, and the owner's separate business preferences. Never fabricate an
   official rate, legally binding effective date or professional opinion.
3. Implement those defaults as owner-editable, role-protected, validated and
   audited **policy versions** with effective dates where material. The owner
   should be able to replace/update advice later through the app. Effective-date
   changes must not silently rewrite already signed or invoiced transactions.
   Cover default/alternative/unknown/new-law transitions with tests.
4. Mark any **explicitly required** CPA/attorney/professional sign-off as
   REVIEW_REQUIRED with a concrete owner-facing path to record confirmation,
   source/reference, decision, effective date and acknowledgement. Where such
   sign-off gates actual business use, do not confuse provisional defaults with
   verified approval. Only the **affected business operation** stays disabled;
   unrelated use and engineering continue. Do not invent or extend approval
   requirements where published law and owner policy do not require them.
5. Show exactly why the operation is blocked and where the owner can clear it.
   On validated owner acknowledgement, re-evaluate *all* independent gates,
   lift only the satisfied restriction, and retain immutable approval/audit
   history. An owner attestation records the owner's receipt of professional
   advice; it never makes the agent a lawyer or CPA.

When legal applicability remains genuinely indeterminate from public sources,
record **what** the professional must answer rather than guessing the legal
conclusion. Build safe simulations and full surrounding implementation meanwhile.
A missing owner answer temporarily pauses that exact path; a missing
professional determination gates affected **business use**, never implementation.

## Roadmap-order completion and owner-assisted blocker resolution — permanent owner rule 2026-10-14

The canonical rule is **Roadmap order, complete batches and immediate owner
escalation** above, together with **Owner questions and publicly researched
regulatory defaults**. Follow those requirements and SESSION-START §2; this
heading remains for existing references, not a second competing procedure.

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

## Roadmap-throughput and context-safe execution — owner correction 2026-10-14

**Completion outranks PR count.** The goal is completed, usable, safely proven product
functionality, not GitHub activity. Each implementation PR should **average 2–5 genuinely completed approved roadmap
slices**, grouping adjacent small slices from the same approved parent when their
contract, risk, callers, integration and tests belong together. One high-risk
complete slice or a larger coherent bundle may justify an exception: explain it,
do not rename individual helpers as slices. The **rolling target is 400–800
meaningful production-code lines added per implementation PR on average**,
excluding tests, documentation, generated files and formatting-only changes.
Measure the last five merged implementation PRs plus the proposed PR with
`npm run pr:progress`. The target is a planning/review expectation, not a
padding quota, merge veto, hard cap, or substitute for product outcomes.
A shortfall requires an honest explanation and larger *legitimate* subsequent
workloads, never unnecessary code. Avoid one-helper/one-tool PRs
when the remaining compatible slice work can be completed safely together.

**No fixed PR count or multiple-of-five boundary.** Older directions elsewhere
requiring five or ten PRs or PR-number alignment are superseded. Do not invent
small PRs or pad changes to satisfy a number. Spend the chat's usable context
on complete outcomes; after each merged PR, preserve an exact recoverable
checkpoint (branch/head, card/slice coverage, focused and CI proof, open review,
deployed/live versus source, pending acceptance and next action). Before starting
another work unit, assess whether the remaining chat context can support its
implementation, corrections, tests, merge and handoff. If not, finish a clean
checkpoint instead of beginning work likely to be abandoned. Never use a
continuation prompt instead of completing currently feasible work.

**Adaptive CI budget and measurement.** Validate focused behavior at meaningful
code seams, run required complete gates on the final coherent tree and fix all
reported failures in one root-cause-informed correction cycle where possible.
If repeated CI fixes occur, investigate contract/test drift and reduce the
*next* PR's risk surface; do not silently split the current work to manufacture
success. Track complete slices/outcomes, real acceptance closed, remaining
engineering, first-pass CI failures, correction pushes and review overhead.
Update the checked `docs/pr-cards/current-pr-scorecard.json` in each PR:
list approved slice IDs, proof per acceptance criterion, remaining engineering,
external acceptance separately and justified workload exceptions. `npm run
pr:progress -- --check` validates declared IDs and evidence structure; the
reviewer/CI must verify actual correctness. Source line counts and PR totals
diagnose undersized workloads, but cannot substitute for full acceptance.
Every safety, money-out, service autonomy, release and approval gate remains.

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
- **PR size (updated 2026-10-14):** deliver cohesive, independently verifiable outcomes. Target a
  rolling **400–800 added production lines and 2–5 fully completed approved roadmap slices
  per implementation PR on average**, without inventing work, skipping tests, or weakening review. Larger cohesive PRs
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
the highest-priority independent work instead of stopping. An early stop before finishing the current coherent work requires concrete
evidence of no eligible approved work **or** a specific execution/context
limitation, not merely a preferred milestone blocked. Do not manufacture work, pad PR count, or request
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
