-- Additive (ZONE-1, Codex finding on PR #604): marks a DELIVERY job that is a customer pickup hand-over at our place.
-- Existing jobs keep false; nothing is removed or rewritten.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "customerPickupHandoff" BOOLEAN NOT NULL DEFAULT false;
