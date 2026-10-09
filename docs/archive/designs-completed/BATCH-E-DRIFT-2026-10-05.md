# Batch E drift check — final post-D baseline

**Date:** 2026-10-05  
**Implementation baseline:** `main` at Batch D merge `a6c9c9acd2f1d673b6020e1819f60c34d9d9c576`.  
**Authority:** read with `BATCH-E.md` and `POST-BATCH-D-RECONCILIATION-2026-10-05.md`. Where an older Batch E assumption conflicts with the merged code or the post-D reconciliation, this note records the verified implementation fact.

## Start gate

Batch D PR #214 is merged. Its exact head passed CI, its Vercel preview was READY, and it had zero unresolved review threads before merge. Batch E may start from the merge SHA above.

## Verified drift from the pre-D Batch E design

1. **`docs/STATUS.md` is stale, not authoritative implementation evidence.** It still describes D as not started. Merged code and merged PRs are the implementation source of truth; STATUS is corrected in the first E slice.
2. **The public limiter is already persistent and cross-instance.** `src/lib/rate-limit.ts` uses Postgres state and an advisory transaction lock. E must not replace it with another distributed limiter. The post-D privacy boundary remains: public privacy intake is rate-limited; the signed-in customer path is not double-limited.
3. **Billing reconciliation has three actual passes, not the older design inventory.** The merged route runs: provider-operation recovery, completed-job billing handoffs, and immutable final-invoice artifact freezing. E records those three independently and does not invent a `subscription-ends` pass.
4. **The renewal lifecycle has seven actual passes and their order is contractual.** They are: auto-renewal queue/cancel, annual reminder queue, pending notice delivery, billing extension after notice evidence, due termination execution, fully-returned rental closure, then due renewal start. E records them independently without reordering their business behavior.
5. **D added messaging and permission surfaces E must migrate rather than recreate.** Public privacy verification currently uses the customer-email sender and must join the E message ledger with a stable request-scoped key while preserving D's phone-verification fallback for failed/not-sent/uncertain delivery.
6. **D's report registry is authoritative.** E changes matching metric definitions/readers in `src/domains/reports/definitions.ts`; it does not create a second registry. Fleet utilization moves to `ApplianceCustodyEpisode` evidence.
7. **Residual B08 belongs to E.** Lead scoring remains hard-coded on the final D merge. E therefore adds the versioned `BusinessSettings.leadScoringPolicy` and `Lead.scoringPolicyVersion` contract using v1 defaults that exactly reproduce the existing score, without silently rescoring old leads.
8. **D's legal/content/evidence/privacy contracts remain intact.** E search, accessibility, SEO and later E2/F work must preserve site-content draft/public isolation, legal approval gating, immutable document evidence, privacy retention/deletion boundaries, and STAFF's lack of private/financial/part-cost visibility.
9. **Browser CI has four groups (`browser-a` through `browser-d`).** New route coverage must be assigned within that current matrix unless the workflow and shard inventory change together.

## A1–A13 recheck outcome

The remaining preflight facts were re-read against the final D merge: email/customer-email already expose explicit provider outcomes; SMS still needs E's richer outcome contract; launch delivery keeps its existing uncertain `SENDING` invariant; `ConsentRecord` exists; search currently exposes the same lead shape to STAFF and privileged users; focus-ring token export and raw gray utility cleanup remain E work; only Stripe has a provider webhook; and B2 `CustomerNotice` remains the legal notice-evidence record.

No owner/business decision conflict was found. These are implementation-drift corrections only, so E proceeds without inventing new policy.
