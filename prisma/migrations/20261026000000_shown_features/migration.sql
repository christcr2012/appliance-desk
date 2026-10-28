-- AR-12: owner-controlled navigation visibility only. Additive: existing capabilities remain available.
ALTER TABLE "BusinessSettings" ADD COLUMN "shownFeatures" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
