-- Referral program (Task #68, docs/DECISIONS.md 2026-09-28 — Chris's
-- pick: "discount for both people"). Every change here is additive; no
-- existing column changes meaning.

-- 1. Every customer gets a shareable code. The table is expected to be
--    empty or near-empty in production right now, but backfill anyway
--    so this is safe to run against a database that already has real
--    customers: each existing row gets its own random code before the
--    column becomes NOT NULL/UNIQUE.
ALTER TABLE "Customer" ADD COLUMN "referralCode" TEXT;

UPDATE "Customer"
SET "referralCode" = upper(substr(md5("id" || clock_timestamp()::text), 1, 8))
WHERE "referralCode" IS NULL;

ALTER TABLE "Customer" ALTER COLUMN "referralCode" SET NOT NULL;
CREATE UNIQUE INDEX "Customer_referralCode_key" ON "Customer"("referralCode");

-- 2. The public lead form can now capture a referral code.
ALTER TABLE "Lead" ADD COLUMN "referredByCode" TEXT;

-- 3. One owner-adjustable reward amount, applied to both sides —
--    matches the same dollar amount ("give X, get X") going to
--    whoever referred and whoever was referred. $25 default.
ALTER TABLE "BusinessSettings" ADD COLUMN "referralRewardCents" INTEGER NOT NULL DEFAULT 2500;

-- 4. The referral itself: created when a referred lead converts to a
--    customer, rewarded once that new customer's billing actually
--    starts (never on signup alone).
CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REWARDED');

CREATE TABLE "Referral" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "referrerCustomerId" TEXT NOT NULL,
    "referredCustomerId" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardCents" INTEGER,
    "rewardedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "Referral_referrerCustomerId_fkey" FOREIGN KEY ("referrerCustomerId") REFERENCES "Customer"("id"),
    CONSTRAINT "Referral_referredCustomerId_fkey" FOREIGN KEY ("referredCustomerId") REFERENCES "Customer"("id")
);

-- A customer can only ever be the *referred* party once.
CREATE UNIQUE INDEX "Referral_referredCustomerId_key" ON "Referral"("referredCustomerId");
CREATE INDEX "Referral_status_idx" ON "Referral"("status");
