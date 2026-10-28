# MCP-6 — Repair cases: from a problem to a checked fix

Build spec: `docs/build-specs/engines/REPAIR-CASES.md`. Approved by Chris 2026-10-25. Depends on MCP-5. Risk:
**the app reads GitHub's public API** (fixed paths, this repo only).

## Acceptance
- [ ] A case keeps its source issue/report and app revision; one active case per problem.
- [ ] PR open / merged / live / checked are separate and only set from what the app verified itself (fake GitHub tests).
- [ ] Foreign repositories, made-up PRs and claimed results are rejected.
- [ ] A fix that doesn't pass its check keeps the problem open.
- [ ] Repairs list on System health; `ci` green at the exact head; every review comment read.

## Acceptance plan — committed before implementation (October 27)

1. One additive `RepairCase` per source/version/expected-behavior fingerprint,
   tied to a real SystemIssue or feedback report, its revision and a sanitized
   explanation; duplicated requests yield the same ID.
2. Typed candidate/verified/rejected evidence and stages are persisted; code
   agents cannot assert a PR, a merge, a live deployment or a successful fix.
   The server verifies fixed-repo GitHub HTTPS API responses, exact SHA/check
   identities, ancestry, time/redirect/size limits and ambiguous outcomes.
3. Production deployment requires hosting-injected revision evidence AND
   independent GitHub ancestry. Absent deployment proof stays unverified;
   once deployed, source issue closure requires a later successful matching
   automation run. Failed readback never resolves the source.
4. Bounded MCP write/read interfaces use the existing connection role/scope
   checks and durable audit/journal semantics; no GitHub write token or arbitrary
   URL is accepted. Owner alone can reject or supersede a case, with a reason.
5. System health shows the Repairs list with safe links, dates, stages, source
   and a visible reason for blocked verification; phone and dark-mode
   accessibility must be tested.
6. Disposable-Postgres tests verify single case, concurrent duplicates,
   role downgrade/revoke, idempotency and tampering. Fake fetch tests cover
   foreign repos, invented/open/merged PR, checked SHA, deployment ancestry,
   unverified/failed source and private-text rejection. Build/lint, exact-head
   GitHub CI and review-gate must pass before merge.

**Implementation status:** in progress on the dedicated MCP-6 branch; no PR published or merged yet.

## Implementation checkpoint — October 28 (NOT COMPLETE)

- Added additive RepairCase/RepairEvidence schema and migration, bounded and
  fixed-repository GitHub evidence reads, source/version-bound case creation,
  durable stages, owner rejection, and System health > Repairs presentation.
- Unit/security proof: `tests/mcp-repair-evidence.test.ts`, 4/4 passed.
  Disposable PostgreSQL proof: `tests/mcp-repair-cases-integration.test.ts`,
  6/6 passed; no skips. The fifth real-database test sends twelve parallel
  differently worded requests and proves one active case; a source-row lock
  and partial unique index enforce that invariant. The sixth drives fake GitHub
  evidence through PR open, merge with exact check, deployed ancestry, and a
  later independent successful health run before marking verified. The six-test
  rerun also rejects a successful job whose automation fingerprint does not
  belong to the original issue. Prisma validation and
  changed-file lint passed.
- Browser proof is **not** complete: `e2e/mcp-repair-cases.spec.ts` is registered
  but the local 4 GB sandbox's Next.js build was killed (exit 137). GitHub CI
  must run it on a published, fully implemented head.
- Journal and MCP tool checkpoint: added `repairs:write` consent scope;
  journal-backed owner-approved create, link-candidate and check actions; and
  bounded read-only case list/details. `tests/mcp-repair-tools.test.ts` and the
  existing MCP catalog/security suites passed all 19 focused tests without
  skips. `tests/mcp-repair-journal-integration.test.ts` passed 3/3 real
  PostgreSQL tests on the MCP-5 reconciled database: refused execution before
  approval, replay did not repeat the write, rejected a revoked scope, and
  preserved the open system issue when public GitHub evidence could not verify
  a proposed PR. Changed-file lint passed.
- Still to build: the opted-in feedback human check flow, automatic issue
  discovery, owner follow-up/reminders, complete runtime stage tests and hosted
  browser accessibility CI. No PR is opened and this card is not ready to merge.

Read tool checkpoint (October 28): the MCP catalog now offers bounded,
strict-schema `appliance_repair_list_cases` and `appliance_repair_get_case`
under `ops:read`, rechecking the live actor and returning only safe fields.
Three new SDK transport tests passed (scope denial, field isolation, unknown
input); the existing read/consent/evidence suite passed 14 tests and lint
passed. Journaled repair writes, connection consent, browser/full CI and
source workflow remain pending.
