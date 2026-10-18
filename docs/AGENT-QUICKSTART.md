# AGENT-QUICKSTART — the whole job on one page

Read this after AGENTS.md. It is the resolved, step-by-step version of the rules. If anything here seems to
conflict with AGENTS.md or SESSION-START, **the later-dated owner amendment wins**; if two rules are the same date,
the one that is safer (money, security, data) wins. When unsure, do the safer thing and write the doubt in STATUS.

You do not need to read the other 40 documents to ship a bundle. You need this page, the card, and the checker.

## The one command that tells you what is wrong

```bash
npm run bundle:preflight                                      # before any push
npm run bundle:preflight -- --card docs/pr-cards/F2-C.md --planned-at <sha> --report /tmp/delivery.json    # frozen-plan delivery check
```

It runs every paperwork gate CI runs (clean tree, secret scan, work packet, owner-decision map, e2e shard list,
docs updated, scorecard, frozen plan) and prints PASS / WARN / FAIL with a plain-English fix. **Do not push until
it prints no FAIL.** Most red CI runs in this project were paperwork, not code.

## The loop (ten steps)

1. **Orient.** `git fetch origin && git checkout -b ai/<tool>/<topic> origin/main`, then `npm run setup` once,
   `npm run work -- start`. Read the top of `docs/STATUS.md` and the card it names.
2. **Plan first, in its own commit, before any code.** `npm run bundle:new -- <ID> --subsections A-1,A-2`
   creates the card and packet with `TODO:` markers. Replace every TODO using the approved design
   (`docs/designs/`). Add the card to `docs/pr-cards/work-index.json` if it is new. Commit **docs only**, with
   a message starting `plan:`. Remember that commit's full SHA: it is your `--planned-at`.
   Counting rule: only whole predefined subsections count (see AGENTS.md); never relabel helpers to inflate.
3. **Write the code and its tests together.** Real behavior tests; money/permissions/concurrency on throwaway
   Postgres via `npm run test:db -- tests/x.test.ts`. Run only the focused test while building:
   `npx vitest run tests/x.test.ts`. Never run watch modes or `npm run dev`.
4. **Pick the PR kind** (the scorecard `kind` decides which paperwork CI demands):
   | Kind | Use when | Must have |
   |---|---|---|
   | `implementation` | you changed `src/` or `prisma/` | completed slices, one evidence line per acceptance item |
   | `maintenance` | docs, scripts, tests, tooling only | no slices; evidence list; a `parent` card |
   | `risk_remediation` | fixing a defect already on main | `workloadException` and 3+ `riskEvidence` lines |
   | `completion` | zero code, frozen full criteria, new passed evidence | frozen plan and evidence |
5. **Update the paperwork inside the same PR:** `docs/pr-cards/current-pr-scorecard.json` (must change),
   `docs/STATUS.md` (what is merged / in progress / next, truthfully), a card or `work-index.json` edit when
   `src/` changed, `docs/DECISIONS.md` for any design decision, `docs/GO-LIVE-CHECKLIST.md` for any new switch.
6. **Self-review the diff** (`git diff origin/main --stat`, then read it). Write "automated review unavailable —
   waived; self-reviewed" in the PR if no automated review appears. Never claim a review that did not happen.
7. **Gate:** `npm run check:quick && npm run bundle:preflight`. Fix everything, commit once.
8. **ONE push.** A push cancels running CI, so push once per cycle. Never `--no-verify`. Never commit to `main`.
9. **Open the PR** to `main` (plain-English body: what changed, how verified, what Chris must decide, what is next).
   Wait for the `ci` check on the **exact head SHA**. Poll no faster than every few minutes; do not loop forever.
10. **Merge only when exact-head `ci` is green:** `gh api -X PUT repos/<owner>/<repo>/pulls/<N>/merge -f sha=<head>
    -f merge_method=merge`. Then update STATUS if needed and report to Chris in plain English.

## When CI is red — failure to fix

Read the *annotations* of the failed check (`gh api repos/<owner>/<repo>/check-runs/<id>/annotations`); the raw
log is not downloadable. Fix **all** failures, reproduce locally, push once. "capacity baselines" is not a gate.

| What CI says | Real cause | Fix |
|---|---|---|
| pr-progress: scorecard not updated | `current-pr-scorecard.json` unchanged | edit it for this PR |
| pr-progress: needs completed slices / evidence | `implementation` kind without one evidence line per acceptance item | add them, or use the right kind |
| pr-progress: workload / no src changes | `completion` or zero-code bundle claiming engineering | make a real fix or use `maintenance` |
| check-docs-updated | `src/` or `prisma/` changed without STATUS **and** a card/work-index change | touch both |
| work-session check | stale integration anchor in the packet | `npm run work -- check`, fix the anchor text |
| check-owner-decisions | changed `activeExecution` without a map entry | add `activeExecutionMustRemain` in `docs/owner-decisions/2026-10-13-implementation-map.json` and the ID to `allowedOrdered` in the script |
| e2e-shard | new spec not in `e2e/shards.json`, or a skipped test | register the spec once; skips need `INTENTIONALLY_SKIPPED` in `scripts/e2e-shard.mjs` with a reason |
| bundle-plan | card plan edited after the planning commit, or wrong `--planned-at` | plans freeze; amend via a new dated note, not a rewrite |
| gitleaks / secret scan | a key-shaped string in code, docs or tests | remove it; build fake keys at runtime in tests |
| typecheck: unused `@ts-expect-error` | importing a `.mjs` that already has types | delete the comment |
| scenario test flaky / wrong counts | scenarios share one database | see below |
| a11y/axe failure on a page you touched | missing label, focus ring or contrast | fix the markup; never skip the test |

## Scenario and shared-database tests

`tests/scenarios/**` run serially against one throwaway database. Purge queue rows with `purgeScenarioQueues`
before asserting, count only the messages **you** caused (filter by the recipient you created), and remember that
`mockReset` clears call history. Never write a test that depends on another file's leftovers.

## Hard limits (stop and ask Chris, in plain English, with a recommendation)

Live Stripe, live SMS or customer email; buying anything; deleting or rewriting real customer, billing or
signature data; production fixtures; anything outside this repo or its Vercel/Neon/Google settings; committing to
`main`; secrets anywhere; manual releases (the daily job promotes `main` to `live`). Missing *business* decisions:
ask the smallest question. Missing *legal or tax* facts: research official sources and build owner-editable
defaults (AGENTS.md "publicly researched regulatory defaults").

## Never overclaim

A passing typecheck, a screenshot, or a plan is not proof. Say exactly what is coded, what CI proved, what is
deployed, and what still needs a real provider or Chris. If something is unfinished, write it in STATUS.
