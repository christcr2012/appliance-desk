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

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Read REPAIR-CASES sections 1–2, inspect existing `src/domains/agent-control/authorization.ts`,
   `src/mcp/server.ts` and `src/mcp/tools/diagnostics.ts`; inspect MCP-5’s final operations exports after #717
   lands. The spec’s `repair-cases.ts` and named test are new files, not missing prerequisites to search for.
2. Implement schema/backup/restore coverage, then an injected GitHub reader with fixed repo/paths, timeout,
   response cap and redirect refusal. No user URL, raw response or caller-claimed stage becomes evidence.
3. Test the state chain with fixed fake responses: open PR → merged SHA with successful check → running
   revision equal/descendant → later successful runtime check. A failed/absent check leaves the source open.
   Feed foreign repo, fabricated PR, timeout and changed source version; none may produce VERIFIED.
4. Journal create/link/check through MCP-5, including duplicate-request and two-worker create tests. Then add
   role-checked list/detail and the Repairs screen. Human reject/supersede needs a reason and current version.
5. Use `tests/mcp-repair-cases-integration.test.ts` as specified; no live GitHub request in CI. Do not modify
   GitHub, deploy code or label a repair live from PR merge alone.
