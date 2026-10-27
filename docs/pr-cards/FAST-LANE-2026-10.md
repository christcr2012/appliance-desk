# FAST-LANE-2026-10 — remove contradictory agent execution instructions

**Owner-approved:** October 27, 2026 (this session). Scope: execution documentation, not product behavior.

## Acceptance (committed before changes)
- [x] Keep AGENTS.md the only authoritative rules and preserve all section 1 protections.
- [x] Align SESSION-START and AGENT-QUICKSTART with the 2026-10-27 auto-merge (squash), exact-head `ci` + `review-gate`, and **no up-to-date requirement**. Never advocate manually merging past failed protections.
- [x] Reduce idle time: one active bundle per risk boundary, overlap CI/review with independent approved work, avoid repeated full local test suites; fix red runs as batches.
- [x] Clarify that open PRs should be triaged, not allowed to block independent work, and real conflicts need explicit resolution.
- [ ] Check documentation references and CI/preflight; publish a normal PR and enable auto-merge, no direct main push.

## Reason for the change
AGENTS.md already contains these correct rules, but SESSION-START still says to finish every open PR
before proceeding and directs manual merge with `merge_method=merge`, contradicting the authoritative
squash auto-merge and keep-building instructions. The repair is intentionally narrow.
