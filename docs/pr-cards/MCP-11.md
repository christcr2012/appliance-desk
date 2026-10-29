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

## Acceptance plan — October 28

1. Reporter-owned consent starts off, can be withdrawn at any time, and every change is version-checked and recorded without exposing pictures.
2. MCP triage and content reads are independently scoped and re-check live consent for every content retrieval, including queued operation rechecks.
3. Journal-approved reply, state and repair-case linking use the existing feedback service, never unrestricted database write or a caller's claim of a fix; verified case is required to call a report fixed.
4. Assistant author labels, internal-only notes, privacy/backup coverage, and cross-customer isolation are exercised with disposable-database tests and browser checks.
5. All tests, exact-head full CI, reviewed findings and squash merge are required; no live customer messages enabled.

## Progress
Reporter consent, scope-separated feedback reads and journaled mutations are implemented on `ai/chatgpt/mcp-11-feedback`. On disposable PostgreSQL, 5 journaled-feedback, 13 existing feedback-workflow and 6 MCP read-tool tests passed (24 total) before reconciling current `main`. A browser test now checks opt-in and withdrawal; first GitHub CI exposed two regressions in an outdated MCP-10a source guard and the consent checkbox. Both fixes are prepared; focused 4/4 privacy guards passed locally. Corrected head `db36734c` passed all unit and browser shards, typecheck/lint and the `ci` aggregator in GitHub Actions run 40876566493 (attempt 2). The first retry was a transient telecom-settings browser navigation error; no test was skipped or weakened. PR-triggered review-gate and the final squash merge remain pending; real private-picture storage acceptance is separate and unverified. Local sandbox typecheck exceeded its available Node heap twice, so only GitHub CI can establish a complete typecheck. No live customer messaging is enabled.

## Implementation route (reconciled October 28, 2026)

This adds execution detail to the approved spec, not new scope. Proposed files/tests below must be created
only when absent; inspect the final prerequisite exports once before coding.

1. Start with current `src/domains/feedback/index.ts` (`getMyFeedback`, `replyToReporter`, `addInternalNote`,
   `setFeedbackState`), `src/mcp/scopes.ts` and MCP-5’s final operation dispatcher; do not create a second feedback
   store. New fields/links follow FEEDBACK-AGENT section 3 and existing backup/privacy conventions.
2. Implement the reporter-only locked `setFeedbackAiReview` write and events before content tools. Fixture:
   HUMAN_ONLY with both scopes → metadata only; ALLOWED without content scope → metadata only; ALLOWED with
   both → approved text; WITHDRAWN or content removed → text absent on the next read.
3. Test withdrawal between preview and execution cancels the queued operation. No cached content/result
   handles, screenshots, attachment URLs or duplicate-case links may bypass the report’s live permission.
4. Wire journaled replies/state/link actions to existing writers. Replies are labelled ASSISTANT; internal
   notes never appear on the reporter view; RESOLVED requires MCP-6 VERIFIED evidence. Feed prompt-injection
   text and assert it creates zero operations and grants zero scopes.
5. Run the spec’s two new integration suites plus existing feedback privacy tests; add the reporter permission
   browser journey. Keep the existing feedback service functional if assistant permission is never enabled.
