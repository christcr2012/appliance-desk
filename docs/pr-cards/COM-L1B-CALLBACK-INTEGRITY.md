# COM-L1B — Twilio callback/state integrity

**Batch COM approved 2026-10-08; runtime waits for L1a and its place in the approved batch order.**
Base: final reviewed COM-L1a branch or current main with it merged.
Risk: provider · Migration: none · Estimate: 350–500 production lines, <12 files.
Design: BATCH-COM sections 0, 4.1, 5, 8.

## Read only
1. Current AGENTS/STATUS/MASTER-ROADMAP; L1a final review.
2. messaging/deliver.ts finish/reconcileUnknownDeliveries; events.ts nextState/processVerifiedTwilioStatusEvent.
3. api/webhooks/twilio/route.ts.
4. automation/runs.ts and existing billing-reconcile/route.ts message reconciliation pass.
5. messaging-events-integration.test.ts, messaging-deliver-integration.test.ts, messaging-webhook-routes.test.ts.
6. AI-PR-READ-FIRST duplicate/uncertain provider rules.

## Verify
ProviderEvent still has provider/eventId/type/summary/receivedAt/processedAt. MessageDelivery.providerMessageId unique.
Current SMS output has no automatic UNKNOWN replay (L1a).
No new schema/dependency is needed for this correction.

## Build
- Create src/domains/messaging/delivery-state.ts:
  export async function applyDeliveryObservationInTx(tx: Prisma.TransactionClient,
    input: { deliveryId: string; state: MessageState; providerMessageId?: string; observedAt: Date; lastError?: string }): Promise<MessageDelivery>;
  Lock MessageDelivery by id with parameterized SELECT FOR UPDATE, reload, and update monotonic state/evidence. Reuse it from finish, status events and unknown reconciliation. Preserve acceptedAt/deliveredAt and lead contact evidence; no duplicate contact audit.
- Make the reducer channel-aware using the locked delivery's persisted channel. SMS transitions: PENDING/UNKNOWN -> ACCEPTED/DELIVERED/FAILED/NOT_SENT; ACCEPTED -> DELIVERED/FAILED. EMAIL must additionally preserve existing Resend BOUNCED and COMPLAINED observations from PENDING/UNKNOWN/ACCEPTED; preserve existing SUPPRESSED handling. Do not apply an SMS-only whitelist to email. Same terminal is no-op.
  DELIVERED/BOUNCED/COMPLAINED/SUPPRESSED never downgraded. NOT_SENT is not provider-accepted.
  FAILED->DELIVERED with contradictory same-attempt evidence stays reviewable; do not last-write-win.
  UNKNOWN sender completion cannot overwrite a stronger callback observation. Existing explicit retry claim remains a separate operation, not a reducer transition.
- Verified unknown Twilio SID/status receipts stay processedAt=null. summary has only messageId/status/errorCode plus matchState=unmatched; no phone/body. Invalid/unrecognized statuses are explicitly ignored with processedAt set.
- Keep existing processVerifiedTwilioStatusEvent(input) signature. Concurrent event insert uses existing createMany skipDuplicates; a duplicate applied receipt is no-op. A duplicate unmatched receipt can be replayed through the reconciliation helper.
- Add events.ts:
  export async function replayUnmatchedTwilioStatusEvents(limit=50): Promise<{matched:number;pending:number}>;
  query provider=twilio, type startsWith message., processedAt null, stable receivedAt/id order with capped take. Validate allowlisted summary. Under a receipt lock, find SID, lock delivery, apply reducer, mark processedAt only after business update commits. Duplicate replay workers serialize. No remote API needed.
- Consistent lock order: receipt then delivery for callback/replay; sender finalization only delivery. No receipt locking from a delivery-locked transaction.
- Invoke replay within current billing-reconcile message-deliveries AutomationRun, before/after unknown delivery pass; expose pending count through existing run counts. No new scheduler.
- Keep Resend semantics, legal CustomerNotice bounce evidence, legacy callback URL and all existing signature verification.
- DB/audit failure rolls back receipt disposition and delivery effects together; 5xx permits webhook retry.
- Existing non-sending environment fixtures do not activate production SDK.

## Tests
Real PostgreSQL:
- tests/messaging-events-integration.test.ts:
  “early status callback remains pending then applies after SID persistence”
  “two replay workers apply one effective status”
  “late accepted finalization cannot overwrite delivered callback”
  “concurrent sent and delivered callbacks preserve delivery”
  “delivery update failure leaves receipt replayable”
  “unrecognized status is explicitly ignored”
- tests/messaging-deliver-integration.test.ts: sender/reconciler share reducer and can't downgrade terminal.
- tests/messaging-webhook-routes.test.ts: tampered signed request rejected, duplicate/early accepted without false delivery.
- Email regression cases: Resend bounce/complaint from PENDING and ACCEPTED persists BOUNCED/COMPLAINED, suppression, and legal CustomerNotice evidence; delivered/terminal behavior and later bounce/complaint side effects retain existing semantics even when state does not change.
Use controlled barriers for concurrency; no sleeps or real Twilio calls. Keep existing email/lead/notice tests green.
No browser change.

## Verify / completion
Targeted typecheck/lint/run-mode tests + real DB. Full CI/preview/reviews at exact head.
Current STATUS records callbacks pending-match honestly. No SID-less UNKNOWN send is relabelled success or automatically replayed.
If implementation exceeds budget, split callback replay from reducer with separate complete cards before coding.
