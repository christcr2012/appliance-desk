# MCP-11 — Assistant help with app feedback

Build spec: `docs/build-specs/engines/FEEDBACK-AGENT.md`. Design: `docs/mcp/FEEDBACK.md`. Approved by Chris
2026-10-25. Depends on MCP-10a, MCP-5, MCP-6. Risk: **private report text** — readable by an assistant only for
reports whose author allowed it.

## Acceptance
- [x] Reporters choose, per report, whether the assistant may read it; off by default; can withdraw any time.
- [x] Without permission, no tool returns what was written — even for the owner's assistant (test).
- [x] Assistant replies are labelled; internal notes never reach reporters; pictures never go to an assistant.
- [x] "Fixed" needs a verified repair case; reporters can reopen.
- [x] Prompt-injection text in a report causes no action (test).
- [x] `ci` green at the exact head; every review comment read.

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

## Close-out — October 31 (Lane 5, MCP-11-CLOSEOUT)

The implementation merged as PR #748 on 2026-10-29 but the card was never
closed out: every acceptance box stayed unticked, the Progress section still
ended at "review-gate and the final squash merge remain pending", and the
work-index still read APPROVED. Verified on current main (`ec131333`) under
packet MCP-11-CLOSEOUT; nothing was rebuilt and no behavior changed.

- **Suites:** the feedback suites re-ran per-file on the lane database —
  journaled-feedback integration 5/5, the existing feedback workflow suite
  13/13, feedback privacy 2/2 and the no-AI bridge guards 4/4 (24 total, zero
  skipped). The first run of the batch failed at the environment level (vite
  config-write EPERM and Prisma connection errors, all suites at once) because
  this VM was replaced mid-verification — uptime had reset when the batch was
  retried; a direct probe then passed and the full batch ran green unchanged.
- **Implementation read:** consent is reporter-owned — reports start
  HUMAN_ONLY, and `setFeedbackAiReview` runs under the reporter report lock
  with a version check and records an AI_PERMISSION_CHANGED event; withdrawal
  moves ALLOWED to WITHDRAWN. Content reads require the separate
  `feedback:content` scope AND live ALLOWED consent AND unremoved content,
  re-checked again in the agent-control action layer at execution, so a
  withdrawal between preview and execution cancels the queued operation (the
  journaled suite proves it). Attachment URLs are never returned to an
  assistant. Replies are journaled (FEEDBACK_REPLY / FEEDBACK_UPDATE /
  FEEDBACK_LINK_CASE, `feedback:triage`) and labelled ASSISTANT; internal
  notes never appear in reporter-visible queries; marking a report fixed
  requires a linked VERIFIED repair case (VERIFIED_REPAIR_REQUIRED) and
  reporters can reopen inside the reopen window. The workflow suite's
  injection case files a report whose text is an instruction string and
  proves it stays inert data — visible only as the consented report's
  description, never executed.
- **Browser:** `e2e/feedback.spec.ts` carries the reporter consent journey
  (the "AI assistant privacy choice" opt-in, the allowed state, and
  withdrawal) and is registered in `e2e/shards.json`; it runs in CI's browser
  shards at heads containing the merged implementation.
- **Index correction:** the work-index named two test files that do not exist
  under those names (`tests/mcp-feedback-integration.test.ts`,
  `tests/feedback-workflow-integration.test.ts`); the real suites are
  `tests/mcp-feedback-agent-integration.test.ts` and
  `tests/feedback-integration.test.ts`, and the index now names them.
