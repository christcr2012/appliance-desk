-- OPS-8: continuity page details, the owner-only "pause automatic charges" switch, and the yearly check-up record. Additive only.
ALTER TABLE "BusinessSettings"
  ADD COLUMN "continuityEmergencyName" TEXT,
  ADD COLUMN "continuityEmergencyContact" TEXT,
  ADD COLUMN "continuitySuccessorName" TEXT,
  ADD COLUMN "continuitySuccessorContact" TEXT,
  ADD COLUMN "continuityCpaName" TEXT,
  ADD COLUMN "continuityCpaContact" TEXT,
  ADD COLUMN "continuityAttorneyName" TEXT,
  ADD COLUMN "continuityAttorneyContact" TEXT,
  ADD COLUMN "continuityRecordsNote" TEXT,
  ADD COLUMN "continuityReviewedAt" TIMESTAMP(3),
  ADD COLUMN "chargesPausedAt" TIMESTAMP(3),
  ADD COLUMN "chargesPausedByUserId" TEXT,
  ADD COLUMN "chargesPausedNote" TEXT;

CREATE TABLE "YearlyCheckup" (
  "year" INTEGER NOT NULL,
  "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedByUserId" TEXT NOT NULL,
  "ticked" JSONB NOT NULL DEFAULT '[]',
  "note" TEXT,
  CONSTRAINT "YearlyCheckup_pkey" PRIMARY KEY ("year")
);
