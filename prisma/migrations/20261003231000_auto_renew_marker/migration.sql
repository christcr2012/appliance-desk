-- Marks renewals the system created from a customer's auto-renew consent, so turning
-- auto-renew off cancels only those (never a renewal someone signed by hand). Additive only.
ALTER TABLE "RentalAgreement" ADD COLUMN "createdByAutoRenew" BOOLEAN NOT NULL DEFAULT false;
