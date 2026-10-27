# SESSION-START — the whole session on one page

Rules are in [/AGENTS.md](../AGENTS.md) (hard limits, finish line, Definition of Done). The long 2026-10-15 version of
this file is archived in [archive/rules-reset-2026-10-23/](archive/rules-reset-2026-10-23/) as history only.

## 1. Orient (5 minutes)

1. `git fetch origin` and work from actual current `main`. Look at open PRs, their CI and unread review comments
   (`gh api repos/christcr2012/appliance-desk/pulls?state=open`). **Finish ready PRs first; while their checks
   run, continue an independent approved outcome rather than waiting. Never duplicate another agent's open work.**
2. Read the top of [STATUS.md](STATUS.md) and `npm run work -- start` (names the active card). Trust the repo and
   GitHub over any chat handoff — handoffs go stale.
3. Read [TESTING-ENVIRONMENT.md](TESTING-ENVIRONMENT.md) before hosted acceptance: use the seeded testing app,
   never repoint the public site or seed the production database. Check the deployed SHA and provider mode.
4. Check [OWNER-CHECKLIST.md](OWNER-CHECKLIST.md) for rows that have become ready (a release landed, an account was
   set up). Do the ones you are authorized to do yourself and record real observations; leave Chris's rows alone.

## 2. Pick the next outcome

Take the next item in [MASTER-ROADMAP.md](MASTER-ROADMAP.md) order whose card is approved. A card may be split into
several PRs when each is independently useful and safe (AGENTS.md rule 5); it may also be one PR. Write or refresh the
card from the approved design and the real code (`docs/pr-cards/README.md`); the card is a working note, not a gate.
If the card needs a business, legal, tax or wording decision you cannot find in [OWNER-INPUTS.md](OWNER-INPUTS.md) or
`docs/DECISIONS.md`, follow AGENTS.md section 1 "Decisions never block building": research, build the most likely
answer as a changeable starting value, file the question, and keep going. Ask Chris in the conversation only for a
true blocker.

## 3. Build and verify

Code and tests together; money, permissions and concurrency tested on throwaway Postgres. Focused checks while
building, then the complete tree once. Commands and the table of known CI failures: [AGENT-QUICKSTART.md](AGENT-QUICKSTART.md).

## 4. Publish and merge

One push per CI cycle. Open the PR to `main` in plain English. `ci` and `review-gate` green at the
exact head + every Codex finding replied to + every blocking review fixed → squash merge. Enable squash auto-merge
when the ruleset requires **both** checks; otherwise wait to arm it until Reviewgate is green (see AGENTS §6).
Other agents moving `main` do not force a branch update: reconcile only real merge conflicts. Update STATUS
(short top entry). Do not wait for Vercel, a release, or any real-account acceptance.

## 5. Close out

Report to Chris in plain English: what changed, how it was verified, what is on his checklist (new rows), what is next.
When you have to stop, leave STATUS with: branch/PR/head SHA, what is done and proven, the one next action, and any
blocker with the exact error. Never claim more than you observed.
