-- A signed renewal that starts in the future is "scheduled", not active, so reports
-- and availability never count it early (owner decision IN-22). Additive only.
ALTER TYPE "RentalAgreementStatus" ADD VALUE IF NOT EXISTS 'SCHEDULED' AFTER 'AWAITING_SIGNATURE';
