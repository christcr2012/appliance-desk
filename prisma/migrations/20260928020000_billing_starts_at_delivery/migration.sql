-- Billing starts at delivery, not at signing (Chris's explicit decision,
-- 2026-09-28). Purely additive: new nullable columns, no existing
-- row changes meaning. Existing agreements that already have a
-- stripeSubscriptionId are unaffected -- this only changes NEW signings
-- going forward.

ALTER TABLE "Customer" ADD COLUMN "stripeDefaultPaymentMethodId" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "billingBlockedReason" TEXT;
ALTER TABLE "RentalAgreement" ADD COLUMN "billingStartedAt" TIMESTAMP(3);

-- Backfill: any agreement that already has a Stripe Subscription (signed
-- before this change, under the old signing-starts-billing model) really
-- did start billing at signing -- so its own startDate is the correct
-- historical billingStartedAt, not null. Only NEW agreements signed after
-- this migration get a real (later, at-delivery) billingStartedAt going
-- forward.
UPDATE "RentalAgreement"
SET "billingStartedAt" = "startDate"
WHERE "stripeSubscriptionId" IS NOT NULL AND "startDate" IS NOT NULL;
