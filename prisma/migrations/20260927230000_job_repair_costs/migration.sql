-- Repair cost tracking on Job (Phase: appliance profitability/ROI,
-- 2026-09-27 — see docs/DECISIONS.md's "Business-growth build" entry).
-- Purely additive, nullable columns — no backfill needed, every existing
-- job simply has no recorded cost yet, which correctly contributes $0 to
-- an appliance's lifetime repair cost rather than a guessed number.

ALTER TABLE "Job" ADD COLUMN "partsCostCents" INTEGER;
ALTER TABLE "Job" ADD COLUMN "laborCostCents" INTEGER;
