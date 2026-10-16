ALTER TABLE "Estimate"
  ADD COLUMN "phoneEnteredByUserId" TEXT,
  ADD COLUMN "phoneEnteredAt" TIMESTAMP(3),
  ADD COLUMN "phonePreferredDelivery" JSONB,
  ADD COLUMN "phonePreferredAt" TIMESTAMP(3);
CREATE INDEX "Estimate_phoneEnteredAt_idx" ON "Estimate" ("phoneEnteredAt" DESC)
  WHERE "phoneEnteredAt" IS NOT NULL;
