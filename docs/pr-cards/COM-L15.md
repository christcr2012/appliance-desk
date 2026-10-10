# COM-L15 — communications launch regression and owner handoff

Status: MERGED after exact-head CI and review (PR assigned at release). Starting from merged COM-L14B #392. No migration, provider activation or paid action. Authority: BATCH-COM sections 8–11 and current code.

## Acceptance
1. Create an evidence ledger that distinguishes isolated test-proven code, browser-confirmed screens, outside provider/owner prerequisites, and deliberately OFF capabilities. List real test paths and gaps without claiming production acceptance.
2. Add one real PostgreSQL launch-safety regression using a disposable DB. Validate seeded independent SMS master gate OFF, distinct message delivery states, verified context and private financial evidence boundaries, with no live provider calls or singleton settings writes.
3. Add OWNER and STAFF browser regression for provider setup, inbox, reports evidence and mobile/axe. Preserve all previous targeted tests.
4. Correct existing Twilio runbook introduction for implemented-but-unactivated status. Add a plain-English owner guide for business verification, number selection, A2P and consent, forwarding/voicemail and spending policies. Reuse IN-03/09/51/52/53; no passwords or live signup.
5. Link work to F-part-2 acceptance, future COM-N/K books and unapproved activation stages. No SMS, calls, recording, buying, policy activation, or assumption of legal/registration approval.
6. Update STATUS and work-index as MERGED in PR branch, require exact-head full CI and self-review, merge. Pause immediately after COM-L15 merge and report to Chris, before W-1.

Test paths: tests/communication-launch-integration.test.ts and e2e/communication-launch.spec.ts.

## Evidence and release review
- New CI-only read-only SMS-master proof uses the disposable PostgreSQL singleton and is deliberately listed with SHARED_SETTINGS_TESTS to serialize against tests that write it. Synthetic isolated delivery-status fixtures are created/cleaned up by exact IDs and contain no real phone or Twilio call. STAFF assigned/unassigned scope proven.
- OWNER+STAFF browser suite traverses provider setup, separately-labelled financial evidence, and private inbox on a mobile viewport and checks WCAG A/AA. It does not claim to test actual carrier network delivery or sender authorization.
- The technical Twilio runbook and owner guide are linked from the go-live checklist. The acceptance ledger explicitly marks IN-03/09/51/52/53 and real-provider/legal/K/F acceptance as PENDING, so completed code cannot accidentally be interpreted as production activation.
- Automated review unavailable — waived if no reviewer arrives. Self diff review required, no unaddressed findings. Exact-head GitHub CI and non-required performance checks must be inspected before merge. After merge, STOP the implementation chain and tell Chris in plain English.

### Exact-head CI fixture follow-up
The pre-existing `messaging-events-integration.test.ts` constructed one synthetic Twilio SID from the first 30 UUID hex characters, which could equal another test's 28-character prefix plus a fixed two-character suffix. This intermittently violated the unique providerMessageId constraint. The final case now uses its own distinct `e5` suffix. All ten isolated Postgres provider-event tests passed. No production delivery code or validation gate changed.
