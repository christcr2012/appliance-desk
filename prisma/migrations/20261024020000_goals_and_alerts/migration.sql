-- Additive (Batch O-5). Goals start empty and alerts start at gentle defaults (idle 30 days; utilization alert OFF).
ALTER TABLE "BusinessSettings" ADD COLUMN "idleApplianceAlertDays" INTEGER NOT NULL DEFAULT 30;
ALTER TABLE "BusinessSettings" ADD COLUMN "utilizationAlertPercent" INTEGER;

CREATE TABLE "BusinessGoal" (
  "id" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "month" TIMESTAMP(3) NOT NULL,
  "targetValue" INTEGER NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BusinessGoal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BusinessGoal_target_check" CHECK ("targetValue" > 0)
);
CREATE UNIQUE INDEX "BusinessGoal_metricKey_month_key" ON "BusinessGoal"("metricKey", "month");
