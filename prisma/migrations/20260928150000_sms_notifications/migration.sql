-- SMS notifications (Task #71, docs/DECISIONS.md 2026-09-28). Both
-- columns are nullable with no default needed — additive, no backfill
-- required.

-- TCPA opt-in — real, recorded consent, never assumed from having a
-- phone number on file.
ALTER TABLE "Customer" ADD COLUMN "smsOptInAt" TIMESTAMP(3);

-- Dedup for the daily "your visit is today" text — same shape as
-- RentalAgreement.billingReminderSentForDate.
ALTER TABLE "Job" ADD COLUMN "dayOfReminderSentAt" TIMESTAMP(3);
