-- Deposit collection at estimate approval (2026-09-29) — see
-- docs/DECISIONS.md's matching entry and
-- src/domains/billing/checkout.ts's createDepositCheckoutSessionForEstimate.

ALTER TABLE "Estimate" ADD COLUMN "depositPaidAt" TIMESTAMP(3);

-- Automatic follow-up on a sent-but-unanswered estimate (2026-09-29) —
-- see src/domains/estimates's sendEstimateFollowUpReminders.
ALTER TABLE "Estimate" ADD COLUMN "followUpSentForSentAt" TIMESTAMP(3);
