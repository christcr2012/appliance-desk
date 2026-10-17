-- W-5: owner-editable payment-link message wording (JSON, one entry per reason; NULL = recommended wording).
-- W-6: owner-editable lead response time in days (0 = the same day). Additive; existing rows keep today's behavior.
ALTER TABLE "BusinessSettings" ADD COLUMN "paymentLinkTemplates" JSONB;
ALTER TABLE "BusinessSettings" ADD COLUMN "leadResponseDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_leadResponseDays_check"
  CHECK ("leadResponseDays" BETWEEN 0 AND 14);

-- W-6: the follow-up date chosen when a lead is marked contacted (nullable, additive).
ALTER TABLE "Lead" ADD COLUMN "nextFollowUpOn" TIMESTAMP(3);
