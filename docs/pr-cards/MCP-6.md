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

**Implementation status:** plan committed; no MCP-6 feature code built yet.
