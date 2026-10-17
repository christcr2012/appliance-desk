-- W-4: owner-editable lead time for the "rental is ending" To do. Additive; existing rows get the 30-day starting value.
ALTER TABLE "BusinessSettings" ADD COLUMN "rentalEndingNoticeDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "BusinessSettings" ADD CONSTRAINT "BusinessSettings_rentalEndingNoticeDays_check"
  CHECK ("rentalEndingNoticeDays" BETWEEN 1 AND 365);
