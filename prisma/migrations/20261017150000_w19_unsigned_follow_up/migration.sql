-- W-19: owner-editable number of days an agreement may wait for a signature before a "Follow up" To do appears.
-- Additive; existing rows get the recommended 3.
ALTER TABLE "BusinessSettings" ADD COLUMN "unsignedFollowUpDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_unsignedFollowUpDays_check"
  CHECK ("unsignedFollowUpDays" BETWEEN 1 AND 30);
