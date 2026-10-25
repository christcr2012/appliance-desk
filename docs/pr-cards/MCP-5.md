# MCP-5 — Assistant actions you approve, done once and checked

Build spec: `docs/build-specs/engines/AGENT-ACTIONS.md`. Design: `docs/mcp/DATA-AND-RECOVERY.md`. Approved by Chris
2026-10-25. Depends on MCP-4, MCP-2, DEC-1a. Risk: **first assistant writes** (settings via decisions, job pause,
backup retry). No money, messages or deletion actions exist.

## Why
Chris wants to hand a completed CPA/attorney form to his assistant and have it apply the answers through the app,
and to let it fix simple problems (retry a failed backup) — with him approving each change.

## One PR
The operation record, approval and the six actions share one execution path; an action without the journal would be
unsafe, and the journal without actions does nothing.

## Acceptance
- [ ] Nothing changes without a preview; in-app approvals need the OWNER; conversation approvals need the preview id.
- [ ] Twenty retries of the same request do the work once (test).
- [ ] A change between preview and execute expires the preview (test).
- [ ] Disconnect, role change or expiry before execute → nothing happens (tests).
- [ ] Uncertain outcomes are checked nightly, never re-run automatically.
- [ ] A filled form's answers apply through DEC-1 exactly as previewed; tampering is refused (test).
- [ ] Assistant activity list with Approve/Decline passes axe, phone/desktop, light/dark.
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
