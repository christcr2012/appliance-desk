# SESSION-START — resume one complete capability

For Sol 5.6 or any selected model. [AGENTS](../AGENTS.md) governs;
read this page and the current packet/card, not every planning file.
[STATUS](STATUS.md) is the permanent handoff; historical entries are reference.

## 1. Orient once, then edit

1. Fetch actual main: `git fetch origin +refs/heads/main:refs/remotes/origin/main`.
   Check branch/dirty work, open PRs, exact-head checks, unresolved reviews and
   concurrent work. Preserve another session's work; never reset a dirty checkout.
2. Read the current top handoff in STATUS. Resume your card's `.progress.md` if
   present; do not redo its completed steps. Once per worktree: `npm run setup`.
3. `npm run work -- start` prints the checked active capability, exact integration
   references, ordered implementation, proving cases and scoped gates. It works
   before npm install. `npm run work -- doctor` diagnoses hook/lock/dependency
   problems without reading credentials or contacting providers.
4. Read the card and only the named functions/design headings. `npm run work -- read 4`
   prints at most 102 lines around numbered integration reference 4. `npm run work -- drift`
   lists changed integration files; apply [DRIFT-PROTOCOL](implementation-contracts/DRIFT-PROTOCOL.md)
   checklist A. Later unit without a packet: `npm run work -- route <unit>` and
   [packet authoring](pr-cards/README.md); missing card means write it, not stop.

## 2. Implement the outcome together

Name the complete observable result before coding. Include its existing domain,
DTO, caller/UI and meaningful tests in one reviewable capability. Routine
450–800 production-line estimates are advisory; the owner removed the old ceiling.
Larger cohesive PRs are permitted with an explicit integration/risk/validation
plan. Split only for concrete independent risk, migration order, reviewability
or execution limits, and name the residual acceptance and successor.

Ordinary file/function names, additive implementation details and mechanical drift
are engineering work. Missing money/security/business semantics still require the
approved contract; never guess a policy or treat recommendations as owner answers.
Use established helpers, lock/actor/tenant rules and fixtures before inventing new ones.
One bounded discovery pass → edit the contract/tests → implement; no distant card-writing spree.

## 3. Diagnose small, verify complete, publish once

- `npm run work -- plan` shows selectors, missing proposed tests and affected-source
  fan-out. No checks run. A small explicit selector can still pull in many related tests.
- Fix one failing DB spec with `npm run test:db:probe -- tests/exact.test.ts` or the
  current packet's `work -- probe`. These are diagnostic, not publication proof.
- After the proposed tests exist, `npm run work -- verify` runs their validated
  selectors through normal preflight; `--fresh` forces checks. Keep all required
  related regressions and local/Actions browser/build gates. `work -- metrics`
  reports bounded local elapsed times, failures and cache hits, not CI/acceptance.
- Local database/browser tests use the existing Vercel Sandbox and disposable
  localhost PostgreSQL, never Neon/production ([PLAYBOOK §4b](PLAYBOOK.md)). Use
  a real per-worktree install: `npm run work -- install` (add `--offline` only with a
  complete npm cache). It uses synthetic localhost config for Prisma generation
  and never migrates/seeds; no real DIRECT_URL or shared node_modules symlink. Reuse the persistent sandbox.
- Finish docs/card/packet/STATUS in the implementation PR before final checks.
  Describe implemented behavior and actual pending gates; do not predeclare merge
  or real acceptance. Staging/committing identical files preserves passing local
  records. Any real file/mode change invalidates them. Failed/interrupted groups
  never get a pass; exact-head CI and review are still mandatory.
- Push the complete checked tree once per CI cycle via sandbox Git (or
  [SANDBOX-PUBLISH](runbooks/SANDBOX-PUBLISH.md)). No `--no-verify`, source copying,
  skipped/disabled tests or repeated blind pushes. Batch all known failures/findings.
- While CI/review runs, work only on the eligible immediate successor in the
  two-lane chain. Sync once onto the predecessor's final main; no third PR.

## 4. Scoped recovery and hard limits

Investigate the failure and attempt authorized code/configuration/dependency/doc
remedies first; check already recorded owner answers. For a genuine external gate,
record only its affected operation, attempted remedies, needed evidence/decision,
prerequisites, reopening trigger and next action in STATUS. Continue the highest-priority
approved independent work; requeue the slice when its gate clears. Inspect the
actual index/dependencies before claiming nothing is eligible. A blocked card,
missing credential, reviewer quota or line count is not a project-wide stop.

Keep explicit gates for LIVE Stripe, SMS/customer email, spend, destructive real
customer/billing/signature changes, production fixtures, cross-project changes,
direct main commits, public signup and secrets. Do not weaken authorization,
independent money-out approval, signed facts, isolation, tests or exact-head checks.
Implementation/mocks/CI do not imply deployed or authenticated real-provider acceptance.

Automatic Vercel previews are disabled. Only the scheduled daily checked main→live
workflow releases production; no manual batch release, preview or promotion.
Existing local/Actions browser tests remain mandatory. Read
[HOSTING-COST-POLICY](HOSTING-COST-POLICY.md) only when hosting/cost work is relevant.

## 5. Resume, wait and finish

After each coherent commit, keep a ≤20-line card `.progress.md`: branch/head,
done, next step, lane A PR/check/review/merge state, lane B successor, blocker.
Delete it from the completed capability's final tree. On interruption resume that
checkpoint; use [ANTI-STALL-RECOVERY](runbooks/ANTI-STALL-RECOVERY.md) before retrying.

Read bounded sections (about 150 lines); narrow searches and output. Commands
must finish (Vitest `run`, no dev/watch); slow commands need timeout/log/command id.
The same failure twice means change the hypothesis. After about ten reads without
an edit, write the smallest justified edit/test, unless a concrete decision remains.
Check external waits once, act on new evidence, then advance useful work; keep the
turn active through finite CI using PLAYBOOK's bounded waits.

Normal development stops after five verified substantive merged PRs, never padding
or treating count as acceptance. A targeted maintenance request may be one cohesive
PR. Earlier stop needs evidence all approved work is blocked or an actual execution
limit. Record confirmed main/PR heads/checks/review dispositions, unfinished acceptance,
gates and next outcome in the permanent PR comment/final handoff; reconcile STATUS
in the next substantive PR. `npm run work -- prompt` produces a compact **draft**;
verify GitHub checkpoint evidence before giving it to Chris. Future prompts refer
to AGENTS/SESSION-START/STATUS and the active packet, not a copied rulebook.
