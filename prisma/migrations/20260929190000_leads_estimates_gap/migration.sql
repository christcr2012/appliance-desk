-- Closes the lead/estimate gap Chris flagged (2026-09-29,
-- docs/DECISIONS.md has the full writeup): staff couldn't add a lead
-- by hand, and couldn't start an estimate for anyone who wasn't
-- already a full customer. Two changes:
--
-- 1. Estimate.customerId becomes optional, and a new optional
--    Estimate.leadId is added, so an estimate can start against a
--    Lead instead of a Customer. A CHECK constraint keeps at least one
--    of the two always set. (Both end up set once a lead-started
--    estimate is approved — see approveEstimate's comment — leadId
--    stays as a trace-back, customerId becomes the real link.)
-- 2. Lead.createdByUserId (nullable) records when staff typed a lead
--    in directly instead of it coming from the public contact form.

ALTER TABLE "Estimate" ALTER COLUMN "customerId" DROP NOT NULL;
ALTER TABLE "Estimate" ADD COLUMN "leadId" TEXT;
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id");
ALTER TABLE "Estimate" ADD CONSTRAINT "Estimate_customer_or_lead_check" CHECK ("customerId" IS NOT NULL OR "leadId" IS NOT NULL);
CREATE INDEX "Estimate_leadId_idx" ON "Estimate"("leadId");

ALTER TABLE "Lead" ADD COLUMN "createdByUserId" TEXT;
