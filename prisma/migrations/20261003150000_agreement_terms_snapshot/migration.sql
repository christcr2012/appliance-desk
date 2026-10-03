-- Agreements keep the ending/renewal terms they were sent for signing with,
-- so changing the system-wide terms never changes an existing lease.
-- Both columns are nullable and additive; existing rows stay null, which means
-- "no terms were agreed" (ending early / auto-renew stay unavailable for them).
ALTER TABLE "RentalAgreement" ADD COLUMN "termsSnapshot" JSONB;
ALTER TABLE "RentalAgreement" ADD COLUMN "termsOverride" JSONB;
