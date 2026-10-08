# COM-L1A — SMS send safety

**PROPOSED card; runtime waits for Batch COM acceptance.**
Base: current main after acceptance · Risk: provider · Migration: none · Estimate: 150–250 production lines, <10 files.
Design: BATCH-COM sections 0, 1, 4.1/4.3, 8. Existing E remains authoritative for email.

## Read only
1. AGENTS/STATUS/MASTER-ROADMAP current entries.
2. src/domains/messaging/deliver.ts: claimDelivery, deliverMessage, finish.
3. src/domains/messaging/events.ts: processVerifiedTwilioStop.
4. src/lib/sms.ts and src/lib/deployment-safety.ts.
5. tests/messaging-deliver-integration.test.ts: UNKNOWN, suppression; tests/sms.test.ts.
6. AI-PR-READ-FIRST external-provider constraints.

## Verify before starting
- SMS caller uses deliverMessage, provider does not transmit idempotencyKey.
- Existing MessageDelivery, MarketingSuppression and CustomerNotice still have inspected contracts.
- No conflicting communication implementation PR; exact current base and approved design recorded.

## Build
No schema/UI/cron/provider configuration changes.
- deliverMessage: retry UNKNOWN once only for EMAIL where the existing sender's documented idempotency contract applies. SMS UNKNOWN stays UNKNOWN after one physical submission.
- SMS dispatch refuses every SMS when MarketingSuppression reason=stop for canonical address, regardless of TRANSACTIONAL/MARKETING. Existing marketing suppression behavior for other reasons stays.
- sendSms and getSmsProviderState require VERCEL_ENV=production AND VERCEL=1 before any SDK request. Unmarked local/CI and unknown environment never contact Twilio. Test injected adapter remains test-only.
- sendSms also reads the existing BusinessSettings.customerEmailEnabled owner master switch (its schema comment says every customer message; currently false). Missing/OFF => NOT_ATTEMPTED. COM-L4 replaces this temporary coupling with the separately approved SMS policy, still OFF by default.
- Add src/domains/messaging/sms-activation.ts:
  export async function isLegacySmsDispatchEnabled(): Promise<boolean>;
  reads only singleton customerEmailEnabled, returns false if absent. Configuration existence never substitutes permission.
- Keep sendSms/getSmsProviderState public return types. No safe retry claim for SMS.
- UNKNOWN lastError says provider outcome unknown, held for review; remove “after one retry” for SMS.
- Preserve day reminder claim on UNKNOWN; clear failure and NOT_SENT paths retain current behavior.
- Missing credentials/provider errors log sanitized code/class only, no raw error/request.
- Never claim STOP can recall an already-submitted/in-flight message.

## Tests
Update existing tests that assume unmarked runtime can use Twilio or UNKNOWN SMS is retried; keep EMAIL retry expectation separately.
- tests/messaging-deliver-integration.test.ts:
  “unknown SMS is submitted once and duplicate invocation does not replay”
  “STOP suppresses transactional SMS without provider request”
  “STOP suppresses marketing SMS without provider request”
  “email safe retry behavior remains independent of SMS”
- tests/sms.test.ts:
  “unmarked local runtime never sends despite copied production credentials”
  “production requires owner master activation”
  “missing settings never activates SMS”
  “production with owner switch on still requires number and credentials”
- tests/deployment-safety.test.ts: preview/non-production no outbound SMS or Twilio lookup.
Use test-only fake SDK and real Postgres for delivery/suppression behavior; no live destination.
No browser test; no screen change.

## Verify
Run typecheck/lint and targeted Vitest with run mode, bounded timeout; real-Postgres delivery tests follow PLAYBOOK.
Update docs/STATUS and the COM acceptance evidence. Review current E/COM comments; record this as correction of existing E's UNKNOWN expectation.
No merge before exact-head CI, applicable preview and reviews.

## Stop if
The owner has not accepted COM, another branch is modifying these paths, or preserving existing legal/email rules requires changing notice semantics. Do not request provider activation to run tests.

## Done
One uncertain SMS invokes Twilio once; STOP blocks both purposes; every non-production/unmarked environment and OFF owner state yields no SDK request. Email regressions remain green. No live activation.
