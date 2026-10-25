# MCP-11 — Assistant help with app feedback

Build spec: `docs/build-specs/engines/FEEDBACK-AGENT.md`. Design: `docs/mcp/FEEDBACK.md`. Approved by Chris
2026-10-25. Depends on MCP-10a, MCP-5, MCP-6. Risk: **private report text** — readable by an assistant only for
reports whose author allowed it.

## Acceptance
- [ ] Reporters choose, per report, whether the assistant may read it; off by default; can withdraw any time.
- [ ] Without permission, no tool returns what was written — even for the owner's assistant (test).
- [ ] Assistant replies are labelled; internal notes never reach reporters; pictures never go to an assistant.
- [ ] "Fixed" needs a verified repair case; reporters can reopen.
- [ ] Prompt-injection text in a report causes no action (test).
- [ ] `ci` green at the exact head; every review comment read.

## Progress
Not started.
