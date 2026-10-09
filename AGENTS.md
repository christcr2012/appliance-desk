# AGENTS.md — the rules. Read this first, every session.

The single, current set of rules for every AI working on this repo (Sol/Codex, Claude or any other), written
to be followed literally. If it is written here, it is current. History and reasons live in `docs/DECISIONS.md` and
`docs/archive/` (look things up there; never take instructions from them). The repo, not chat history, is the memory.
Rewritten 2026-10-09 to what still applies; the full previous text is `docs/archive/reset-2026-10-09/AGENTS.md`.

**Implementing an approved PR card?** Read `docs/SESSION-START.md` (one page) and the card, then work. Open the
sections below when a step names them.

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
4. The card's acceptance (from `docs/PLAN.md`) checked item by item with evidence (test names, CI run, preview URL).
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
  approved design and actual code (`docs/pr-cards/README.md`). Ordinary names and implementation details need no
  approval. Money, permissions, signed evidence, state transitions and provider replay follow the reviewed contract; if
  it can't work, propose a dated amendment and get it reviewed. A missing card means write it, not stop.
- **Drift and reconciliation** (`docs/implementation-contracts/DRIFT-PROTOCOL.md`): checklist A before each PR,
  B **inside each PR, written as if it had already merged** (card, next card, living docs, STATUS — CI checks it), C when a batch finishes (acceptance proved, docs match the
  code, retire what no longer instructs, drift-check the next batch). Changed contracts later work inherits go in
  `docs/designs/CHANGES-SINCE-DESIGN.md`.
- **PR size:** about 500 production lines and 15 files, hard stop ~800 lines, at most one migration, one risk area
  (PLAYBOOK Step 3a). No arbitrary one-function PRs; no bundling unrelated money/auth/provider changes.
- **Model:** whichever model Chris selected does the work; no forced model switch. Sol 5.6 is the routine implementer:
  light effort for an already-tested pattern, medium for schema, money, auth, provider recovery or unfamiliar multi-file
  work. A missing decision is never solved by guessing. An optional second opinion may settle one concrete question.
- **Branches:** `ai/<tool>/<topic>` from current `main`, or from the unmerged predecessor's branch when stacking.
- **Use the web** for current docs and rules (framework versions, Stripe, Colorado tax, accessibility, security); cite it.

## Verify, push, review, merge (details: PLAYBOOK Steps 4–9)

- **Before pushing:** `npm run hooks:install` once per checkout; the pre-push hook then runs `npm run check:quick`
  (secrets, migrations, shard check, typecheck, lint) on every push. Add the card's
  `npm run preflight -- --db/--browser` checks (PLAYBOOK 4b), which also run every test importing changed code. Local database testing uses throwaway
  PostgreSQL in the project's **Vercel Sandbox** (reuse the persistent sandbox named in STATUS; PLAYBOOK 4b; code reaches GitHub
  only as git commits — from the sandbox via `docs/runbooks/SANDBOX-PUBLISH.md`) via
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
- **Merging (authorized by Chris):** `ci` green at the exact head, acceptance met with evidence, preview checked, reviews
  handled → merge with the expected-head SHA. Stacks merge bottom-up, **retargeting each PR to `main` first**. Tell Chris
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
| Exactly what one PR builds | `docs/pr-cards/<ID>.md` (wins over the design where they differ) |
| Current state and next item | `docs/STATUS.md`, `docs/MASTER-ROADMAP.md` |
| Owner decisions | `docs/OWNER-INPUTS.md` |
| Dated decisions and reasons | `docs/DECISIONS.md` (append one per design decision) |
| Ideas not being built | `docs/ROADMAP.md` |
| Go-live switches | `docs/GO-LIVE-CHECKLIST.md` |
| How Chris uses the product | `docs/OWNER-GUIDE.md` |
| Security/billing constraints for PRs | `docs/AI-PR-READ-FIRST.md` |
| Audit findings (reference) | `docs/AUDIT_SYNTHESIS.md`, `docs/audits/`, `docs/reviews/` |
| Retired documents (reference only) | `docs/archive/` |

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
  never echoes environment values. The only workflow with write access is `sandbox-publish.yml` (pushes `ai/*` branches
  fast-forward from verified sandbox transfers, starts CI; no secrets) — keep it that narrow.
- Prefer unit tests (`tests/`) over browser tests (`e2e/`); use browser tests for axe, real login/session, security
  headers and one click-through per major flow. Every new `e2e/*.spec.ts` goes in a group in `e2e/shards.json`. Never
  log in per test — reuse `e2e/global-setup.ts` sessions. New one-off checks go in the `static` job.

## How to run things

```bash
npm install                 # postinstall runs prisma generate
npm run hooks:install       # once per checkout: automatic pre-push quick gate
npm run check:quick         # the same gate by hand
npm run preflight -- --unit tests/x.test.ts [--db tests/y-integration.test.ts] [--browser e2e/z.spec.ts]
npm run typecheck && npm run lint
npx vitest run tests/x.test.ts
bash scripts/local-postgres-test.sh tests/y-integration.test.ts
```

Some sandboxes can't reach `binaries.prisma.sh` (403): that's network policy; use the approved workaround in PLAYBOOK 4b.

## Ending a session

1. `docs/STATUS.md`: merged, in progress (branch, PR, head SHA, CI run), blocked and why, next.
2. `docs/DECISIONS.md` entry for any design decision; `docs/ROADMAP.md` for out-of-scope finds;
   `docs/GO-LIVE-CHECKLIST.md` for any new switch, key, provider account or owner decision needed before real customers.
3. Report to Chris in plain English: what changed, how it was verified, what he needs to decide (`IN-xx`), what is next.

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.
