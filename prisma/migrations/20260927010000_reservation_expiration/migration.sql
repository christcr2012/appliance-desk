-- Reservation aging (Phase 6A item 6 — see docs/DECISIONS.md for the
-- dated design decision and docs/BUSINESS-RULES.md's Pricing section
-- for the related discount rules this file sits alongside):
--
-- 1. BusinessSettings.draftReservationHoldDays — how many days a
--    DRAFT/AWAITING_SIGNATURE agreement's reserved appliances are held
--    before the desk flags it as stale. Owner-adjustable, defaults to
--    7 days.
--
-- 2. RentalAgreement.reservationExpiresAt — set when an agreement is
--    created (now + draftReservationHoldDays) and extendable by hand
--    from the agreement's own page. Only meaningful while still DRAFT
--    or AWAITING_SIGNATURE.

ALTER TABLE "BusinessSettings" ADD COLUMN "draftReservationHoldDays" INTEGER NOT NULL DEFAULT 7;

ALTER TABLE "RentalAgreement" ADD COLUMN "reservationExpiresAt" TIMESTAMP(3);

-- Backfill: every existing DRAFT/AWAITING_SIGNATURE agreement gets a
-- hold expiry computed from its own creation date, using the default
-- 7-day hold — so nothing already old silently starts a fresh clock,
-- and nothing already brand-new gets flagged stale on day one.
UPDATE "RentalAgreement"
SET "reservationExpiresAt" = "createdAt" + INTERVAL '7 days'
WHERE "status" IN ('DRAFT', 'AWAITING_SIGNATURE');
