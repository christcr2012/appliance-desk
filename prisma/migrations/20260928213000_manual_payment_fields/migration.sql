-- Manual (offline) payment recording (Task #72 follow-on, docs/DECISIONS.md
-- 2026-09-28 "Consolidated statements + manual payments + automated late
-- fees"). Both columns nullable, no backfill needed — additive only, and
-- every existing Payment row (all Stripe-sourced) simply gets NULL for
-- both, which is exactly correct: NULL recordedByUserId is what marks a
-- Payment as Stripe-sourced rather than manually recorded.

ALTER TABLE "Payment" ADD COLUMN "notes" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedByUserId" TEXT;
