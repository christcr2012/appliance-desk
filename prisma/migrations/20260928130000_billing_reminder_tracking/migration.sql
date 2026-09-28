-- Automation rules (Task #67, docs/DECISIONS.md 2026-09-28) — tracks
-- which billing cycle's reminder email was last sent, so the daily
-- reminder cron job never double-sends within its "1-2 days out"
-- window. Nullable, no default needed on existing rows.
ALTER TABLE "RentalAgreement" ADD COLUMN "billingReminderSentForDate" TIMESTAMP(3);
