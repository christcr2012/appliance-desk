# MCP-6 — Repair cases: from a problem to a checked fix

Build spec: `docs/build-specs/engines/REPAIR-CASES.md`. Approved by Chris 2026-10-25. Depends on MCP-5. Risk:
**the app reads GitHub's public API** (fixed paths, this repo only).

## Acceptance
- [ ] A case keeps its source issue/report and app revision; one active case per problem.
- [ ] PR open / merged / live / checked are separate and only set from what the app verified itself (fake GitHub tests).
- [ ] Foreign repositories, made-up PRs and claimed results are rejected.
- [ ] A fix that doesn't pass its check keeps the problem open.
- [ ] Repairs list on System health; `ci` green at the exact head; every review comment read.

## Progress
Not started.
