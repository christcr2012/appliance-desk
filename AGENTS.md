# AGENTS.md — the rules (short on purpose)

> **Rules reset 2026-10-23 (Chris).** The old 664-line version, the old SESSION-START and the old quickstart are kept
> word-for-word in [docs/archive/rules-reset-2026-10-23/](docs/archive/rules-reset-2026-10-23/). They are history,
> never instructions. This file is the only place for rules. If a doc, script or card disagrees with it, this file
> wins unless the other text is a dated owner decision that is **safer** (money, security, data).

**Appliance Desk** runs Chris Robinson's appliance rental business (Robinson Appliance Rentals, Greeley, Colorado):
public website for leads, the owner/staff **desk**, and a customer **portal**. **Chris is not a developer.** Every
update, question or PR summary for him is plain English: what changed, how it was verified, what he must decide,
what is next. The goal is a **finished, working product** — not paperwork, not PR counts.

Start every session: this file → top of [docs/STATUS.md](docs/STATUS.md) → [docs/SESSION-START.md](docs/SESSION-START.md)
(one page) → the card you are building (`docs/pr-cards/`). Commands: [docs/AGENT-QUICKSTART.md](docs/AGENT-QUICKSTART.md).

## 1. Hard limits — stop and ask Chris first (never overridden by anything below)

- Turning on **live Stripe payments, live SMS or live customer email.**
- **Buying anything** (domains, plans, add-ons, tiers, storage) or changing a paid plan / hosting capacity.
- **Deleting or rewriting real customer, billing or signature data.**
- **Fixtures, seeds or resets against the production database or file storage** (isolated testing/CI/throwaway only; see docs/TESTING-ENVIRONMENT.md).
- Changing anything **outside this project**: other repos, Vercel/Neon projects, Google Workspace settings not in
  the plan. Never touch the Cortiware, Robinson AI Systems toolkit, YardSync, Household Assistant or oldReplit
  repositories, Vercel projects or Neon projects. If a name you are about to create might already exist, ask first.
- **Committing directly to `main`.** Never use `--no-verify`.
- **Secrets** never appear in code, docs, logs, screenshots, tests or PR text. If a real value leaks, remove it and
  tell Chris so it gets rotated. Do not extend `.gitleaksignore` or the secret-scan allowlist without saying why in
  the PR. No real customer data or private infrastructure identifiers (Neon branch/endpoint ids, Vercel project/team
  ids, URLs with credentials) in this **public** repo.
- **No manual releases, previews or promotions.** Only the checked workflows release: `main`→`testing` each night at 10 pm, then that tested version `testing`→`live` that night
  ([.github/RELEASE-POLICY.md](.github/RELEASE-POLICY.md)). Never push to or merge into `live`. Automatic per-PR Vercel previews are off. The owner-approved dedicated testing app uses the checked `testing`
  branch and its isolated credentials; its automatic build allowance is once per Denver day.
- **Do not widen anyone's access** or change production data/settings without Chris's approval. Public sign-up
  stays disabled (`disableSignUp` in `src/lib/auth.ts`); never call `/api/auth/sign-up/email` from a test.
- **Cost:** target about $20/month. Neon stays at the verified idle profile (0.25 CU cap, 5-minute autosuspend —
  [.github/NEON-COST-POLICY.md](.github/NEON-COST-POLICY.md)); more capacity needs measured need and Chris's
  approved spend. Heavy automated checks run in GitHub Actions (free, public repo), not in paid sandboxes. Stop sandbox
  sessions when done. Automated unit/integration/browser suites use throwaway Postgres. Owner-authorized hosted
  provider/browser acceptance may use the dedicated synthetic preview database in docs/TESTING-ENVIRONMENT.md.
  Never seed or reset the production database. The testing app is part of this project and is approved scope.
- **Never touch real accounts to "see if it works"** beyond what Chris has authorized. Never claim something
  works without evidence you actually observed. Never tick an owner box or invent an owner answer.
- **Decisions never block building (Chris, 2026-10-25).** For any missing business, legal, tax or wording decision:
  research it (current official sources with URL and access date; common practice for a small, new appliance-rental
  business in Greeley, Weld County, Colorado, USA); build it as an owner setting whose starting value is the **most
  likely right answer** for this business now; explain it on screen; and file it as a question in the in-app
  **Decisions & reviews** center (`docs/designs/DECISIONS-CENTER.md`; until that ships, as a `DQ-` entry in
  [docs/OWNER-INPUTS.md](docs/OWNER-INPUTS.md)) for Chris, his CPA, attorney or translator to confirm later. A
  default is never an owner answer: it shows as "Starting value — not confirmed" until someone confirms it. Interrupt
  Chris **immediately** (in the conversation, not a list) only for a **true blocker**: it cannot be built at all
  without the answer, or running the default would be unsafe, illegal or irreversible (moving money, a signed
  document, a real customer message, deleting data) — and then only that one operation waits. Professional review
  (`REVIEW_REQUIRED`) locks only the affected **real business use**, never development, tests or merge. Never
  fabricate a rate, date or legal opinion: when no source supports a default, say so in the question and choose the
  most conservative option.
- **Developer limits are not product limits** ([docs/END-USER-AUTHORITY.md](docs/END-USER-AUTHORITY.md)): rules
  restricting coding agents (no spend, no live actions) do not become permanent "guide-only" limits for the
  product's authorized users. A customer never gains owner/staff powers because an agent acts for them.

## 2. The finish line (how this project actually gets done)

1. **Development never waits for acceptance or verification against real accounts.** When a prerequisite exists
   (a deployed revision, a test account you are authorized to use) do the check yourself with real observations. If
   something blocks it, record it **once** on the checklist and move on to the next piece of work.
2. **Owner-only actions go on ONE plain-English checklist: [docs/OWNER-CHECKLIST.md](docs/OWNER-CHECKLIST.md).**
   Anything that strictly needs Chris's hands — his sign-in, phone or computer, money, a third-party account or
   approval — becomes a row there (what, exact steps, what makes it ready, how he knows it worked) instead of stopping
   to ask. **Decisions are not checklist rows**: they get a researched default and a Decisions & reviews question
   (section 1). **Nothing on it ever blocks building, review or merge.** Never tick a box for him.
   Never write "passed" without a real observation. A row is added **once**; update it, don't duplicate it.
3. **Third-party verification** (another company's sandbox or review, an outside account, an app-store or marketplace
   review, a partner's approval, a trial QuickBooks/Xero company) is a checklist row with exact steps and the
   trigger that makes it ready. Keep building.
4. **Merge finished pieces.** Split a large card into independently useful, independently safe PRs. Never hold
   finished work as a long-lived draft because a sibling piece is unfinished. A draft with no push in 3 days is
   either finished and made ready, or its remaining work is written on the card and the branch is parked.
5. **No slivers.** One PR = one complete, usable outcome with its tests and docs. Split only for a concrete reason
   (migration order, safety boundary, unreviewable size) and write that reason in the PR. Never split just to merge
   faster; never pad. Distinct risks (money, permissions, provider calls) stay independently enforced and tested.
6. **Counts, line targets and "bundle" numbers are diagnostics, never goals.** No session or PR quota exists.
   The current owner prompt sets scope for that session only.
7. **New scope needs Chris.** Inventories, coverage maps, ideas and audit lists are backlog, not gates; ideas go in
   `docs/ROADMAP.md`. Build only approved scope (`docs/MASTER-ROADMAP.md`, `docs/PLAN.md`, cards, designs).
8. **CI is a decision, not a loop.** Red: read **all** failures once, reproduce locally, fix together, **push
   once**. Same failure twice → reproduce locally. Third red → evidence-based diagnosis before any push. "Flake" is
   not a cause; never skip, weaken or quarantine a test. Green at the exact head → read **every open review
   comment and thread**, fix blocking ones in one patch, then merge. Never merge with an unread comment.
9. **Rules live in one place each** (table in section 7). Do not copy rules into cards, STATUS or handoffs —
   link to them. Fix any script or test that reads text you changed.
10. **Blockers are scoped.** One blocked operation is not a project halt. Find the exact cause, try the authorized
    remedies, record it once (STATUS + checklist if it needs Chris), and continue independent work. Stop early only
    with concrete evidence that no eligible approved work remains.

## 3. Definition of Done

1. No placeholders, stubs, TODO-as-implementation or mock data presented as real.
2. Tests exercise real behavior. Business rules, permissions, money and concurrency get tests on throwaway Postgres.
3. `ci` green at the exact head (typecheck, lint, unit/integration, build, browser + accessibility).
4. The card's acceptance checked item by item with real test/CI/browser evidence. Real-provider and owner
   acceptance are tracked separately on the checklist and **never block merge**.
5. [docs/STATUS.md](docs/STATUS.md) has a short top entry (a few lines: merged, in progress, blocked, next).

If something is unfinished, say so in STATUS. A passing typecheck, screenshot or plan is not proof a feature works.
Chris has been burned by overclaiming. Say exactly what is coded, what CI proved, what is deployed, what needs him.

## 4. Engineering rules for every change

- **Code and tests change together.** Writes lock the row first (`SELECT … FOR UPDATE`) and re-check the staff actor
  (`assertActiveTeamActor`). Unit-test fakes provide `$queryRaw`, the same `tx` calls and a `$transaction` that hands
  the callback that `tx`; change a function's database calls → update its fakes in the same commit.
- **Money is integer cents** through existing calculation functions; no financial math in UI code. Money inputs on
  screens are in dollars. **Times stored UTC, shown America/Denver** (test DST edges).
- **Roles OWNER, ADMIN, STAFF, CUSTOMER** are filtered at the query/DTO boundary — hiding a link is not protection.
  Customer A must never reach customer B's data through any URL, action, search or export. Missing role data denies.
- **Owner-configurable by default:** anything a business might change (prices, fees, rates, notice periods, wording,
  thresholds, schedules, labels, toggles) is a stored setting with a sensible starting value, explained on screen in
  plain words (what it does, starting value and why, who can change it, "restore recommended"). Say in the PR if
  something must stay in code. Policy changes apply to future events only; never rewrite signed or billed history.
- **Workflow first:** every save that creates an obligation tells Chris what, how much, by when and where, and puts it
  on his To do list. No Today item may link to a page that does not exist.
- **Migrations are additive** (`scripts/check-migrations.mjs`); production runs `prisma migrate deploy` in `vercel-build`.
- **Touching billing, Stripe, webhooks, auth/session, email/SMS, public forms or preview safety:** read
  [docs/AI-PR-READ-FIRST.md](docs/AI-PR-READ-FIRST.md) first and say in the PR how each applicable item is honored.
- **Tax/legal wording and plain language:** `npm run lint` includes the plain-words check for owner-facing screens.
- **Next.js here has breaking changes** from your training: read `node_modules/next/dist/docs/` before framework code.
- **Original Toolkit** (`Robinson-AI-Systems/robinsons-toolkit-mcp`) is reference-only history. Do not maintain it.

## 5. Working without stalling

- Read big files by section (`grep -n`, then ≤150 lines). Search with a path and a cap; never the repo root,
  `node_modules`, `.next` or `coverage`.
- Only commands that finish by themselves: no `npm run dev`, watch modes, `--ui`, `tail -f`. Use `npx vitest run <file>`
  and wrap slow commands in `timeout 600`. Nothing interactive (`CI=1`, `GIT_PAGER=cat`, `npx --yes`).
- Two strikes: the same command fails or hangs twice → change approach or record the blocker. If a command seems
  stalled, follow [docs/runbooks/ANTI-STALL-RECOVERY.md](docs/runbooks/ANTI-STALL-RECOVERY.md) before retrying.
- After about 10 reads/searches without an edit, write down what you know and make the smallest justified edit.
- GitHub from agent sessions: GraphQL is unavailable; use the REST API and the `/ccr/` routes the error message names
  (ready for review, review threads, auto-merge). A `create_blob` call does not move a branch: commit and update the
  ref within a few blobs, then verify the remote SHA.
- External waits (CI) are checkpoints: do other eligible work, then re-check at a real transition. No poll loops.

## 6. Branches, PRs, review, merge

- Branch `ai/<tool>/<topic>` from current `main` (or a predecessor branch when stacking; stacks merge bottom-up,
  retargeting each PR to `main` first). `npm run setup` once per checkout; the pre-push hook runs `npm run check:quick`.
  Add focused tests while building (`npx vitest run`, `npm run test:db -- <file>`, `npm run test:browser -- <spec>`);
  push the **complete** tree once and let Actions run the full suites.
- PR body in plain English: what changed, how verified, what Chris must decide, what is next. If a **blocking** finding
  (security, permissions, money, data integrity) is not fixed in the same PR, tell Chris before merging.
- Automated review: Codex comments on PR open; Copilot review is not available (never wait for it). If no review
  appears, read the diff yourself and write "automated review unavailable — waived; self-reviewed". Record a
  disposition (fixed / already fixed / superseded / still open) for every finding and resolve threads only after
  checking the fix at the exact head.
- **Merge (authorized by Chris):** the `ci` check green at the exact head, acceptance met with evidence, all review
  comments read → merge with the expected-head SHA. A merge never covers a hard limit in section 1.
- A security or money hole already on `main` is fixed immediately in its own PR.
- **Never delete remote branches, tags or PRs without asking Chris.** Park or list stale ones instead.

## 7. Where things live (one source of truth each)

| Topic | File |
|---|---|
| Session loop, commands | [docs/SESSION-START.md](docs/SESSION-START.md), [docs/AGENT-QUICKSTART.md](docs/AGENT-QUICKSTART.md), [docs/PLAYBOOK.md](docs/PLAYBOOK.md) (testing mechanics) |
| Everything only Chris can do | [docs/OWNER-CHECKLIST.md](docs/OWNER-CHECKLIST.md) (details for some rows: [docs/GO-LIVE-CHECKLIST.md](docs/GO-LIVE-CHECKLIST.md)) |
| Owner decisions (stable IDs IN-xx) | [docs/OWNER-INPUTS.md](docs/OWNER-INPUTS.md) |
| Current state, next item | [docs/STATUS.md](docs/STATUS.md), [docs/MASTER-ROADMAP.md](docs/MASTER-ROADMAP.md) |
| Remaining scope and acceptance | [docs/PLAN.md](docs/PLAN.md), `docs/pr-cards/<ID>.md`, `docs/pr-cards/work-index.json` |
| Prices, fees, statuses, transitions | [docs/BUSINESS-RULES.md](docs/BUSINESS-RULES.md) (never hard-code elsewhere) |
| Database shape | [docs/DATABASE.md](docs/DATABASE.md) + `prisma/schema.prisma` |
| Hosting, CI layout, env vars | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [.github/RELEASE-POLICY.md](.github/RELEASE-POLICY.md) |
| Design and accessibility | [docs/DESIGN-SYSTEM.md](docs/DESIGN-SYSTEM.md), [docs/ACCESSIBILITY.md](docs/ACCESSIBILITY.md) |
| Product behavior | [docs/PRODUCT-SPEC.md](docs/PRODUCT-SPEC.md), [docs/designs/](docs/designs/) |
| Dated design decisions | [docs/DECISIONS.md](docs/DECISIONS.md) — search it; never read it end to end |
| Ideas not being built | [docs/ROADMAP.md](docs/ROADMAP.md) |
| Security/billing constraints | [docs/AI-PR-READ-FIRST.md](docs/AI-PR-READ-FIRST.md) |
| Old rules and history | `docs/archive/` — search for a specific question only |

## 8. CI facts

The repository is **public**: Actions minutes are free and anything committed is public forever. CI runs secret scan,
typecheck + lint, 4 unit shards on throwaway Postgres, production build + 5 browser shards (docs-only changes skip
the heavy jobs but never the secret scan). `.github/workflows/ci.yml` keeps `permissions: contents: read`, uses no
repository secrets, never `pull_request_target`, never echoes environment values. Only `sandbox-publish.yml`,
`daily-live.yml` and the checked `testing-deploy.yml` promoter have write access; keep them that narrow. Prefer unit tests (`tests/`) over browser tests (`e2e/`);
every new `e2e/*.spec.ts` goes in a group in `e2e/shards.json`; reuse `e2e/global-setup.ts` sessions.

## 9. Ending a session

1. [docs/STATUS.md](docs/STATUS.md): a short top entry — merged, in progress (branch, PR, head SHA), blocked and why, next.
2. New owner-only work → a row on [docs/OWNER-CHECKLIST.md](docs/OWNER-CHECKLIST.md). Design decision →
   `docs/DECISIONS.md`. Out-of-scope idea → `docs/ROADMAP.md`.
3. Report to Chris in plain English: what changed, how it was verified, what is on his checklist, what is next.

<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data.
Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->
