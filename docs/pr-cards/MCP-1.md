# MCP-1 — System health that tells the truth

Build spec: `docs/build-specs/engines/HEALTH-BACKUP.md` sections 1–5 (everything is decided there). Design:
`docs/mcp/APPLIANCE-DESK-UPGRADES.md`. Approved by Chris 2026-10-25. No dependencies. Risk: **automation runner and
error text** (no money, no permissions). Replaces the October 17 version of this card, which pointed at the finished
F2 work and PR #494.

## Why
The System health page can say "Working" for a job that stopped days ago, shows four states in the wrong colour,
loads every run ever recorded, and prints raw error text. An assistant connected later (MCP-4) would repeat those
mistakes.

## One PR
States, schedule, bounded reads and typed failures change the same functions and tests; splitting them would ship a
page that is still wrong.

## Acceptance
- [ ] Every state has a label, colour and meaning, and the page shows each (test + browser).
- [ ] Late is computed from each job's real Denver schedule plus the owner's grace setting; DST and clock-skew tests.
- [ ] Every cron in `vercel.json` has a rule with matching hours (test).
- [ ] Health reads are bounded: 10,000 runs, three rows per rule, index used (test).
- [ ] Failures store a code, stage and reference; the planted-secret/PII canary never appears anywhere it is shown.
- [ ] The old check-up key keeps exactly its powers (test).
- [ ] `ci` green at the exact head; every review comment read.

## Progress
2026-10-25: built on `ai/claude/mcp-1-system-health` (spec sections 1–5). Tests: `tests/automation-health.test.ts`
(states, vercel.json schedules, DST, skew, failure codes), `tests/system-health-rows.test.tsx` (one row per state),
`tests/automation-health-integration.test.ts` (10,000 runs, EXPLAIN, grace setting), canary in
`tests/automation-runs-integration.test.ts`, late rule in `tests/system-issue-sweep-integration.test.ts`, browser in
`e2e/system-health.spec.ts`. The browser server in CI has no job settings, so most rows there show Needs setup; every
other state is proved by the component test and the legend. Backup stages, read-back and pruning stay with MCP-2.
