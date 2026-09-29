-- Query performance indexes (proactive scaling/hardening pass,
-- 2026-09-29 — no reported problem, just getting ahead of it before the
-- amount of data grows). Postgres does NOT automatically create an
-- index for a foreign-key-style column the way it does for a primary
-- key or a UNIQUE column — every column below is looked up or joined on
-- constantly (a customer's page pulling their jobs/invoices, an
-- agreement's page pulling its rental lines/deposits/invoices, an
-- appliance's page pulling its assignments/maintenance history) and was
-- running those lookups as a full table scan. Purely additive: this
-- only creates new indexes, it doesn't touch any existing data or
-- columns, so it's safe to run at any time.

CREATE INDEX "RentalLine_agreementId_idx" ON "RentalLine"("agreementId");

CREATE INDEX "ApplianceAssignment_rentalLineId_idx" ON "ApplianceAssignment"("rentalLineId");
CREATE INDEX "ApplianceAssignment_applianceId_idx" ON "ApplianceAssignment"("applianceId");

CREATE INDEX "Job_customerId_idx" ON "Job"("customerId");
CREATE INDEX "Job_serviceAddressId_idx" ON "Job"("serviceAddressId");
CREATE INDEX "Job_agreementId_idx" ON "Job"("agreementId");
-- Job.maintenanceRequestId is NOT included here: it already has an index
-- (Job_maintenanceRequestId_idx), created back in migration
-- 20260926210000_job_maintenance_request_link when the column was added.
-- Caught by replaying every migration against a real local Postgres
-- before trusting this file — see docs/DECISIONS.md.

CREATE INDEX "JobAppliance_jobId_idx" ON "JobAppliance"("jobId");
CREATE INDEX "JobAppliance_applianceId_idx" ON "JobAppliance"("applianceId");

CREATE INDEX "Deposit_agreementId_idx" ON "Deposit"("agreementId");

CREATE INDEX "Invoice_agreementId_idx" ON "Invoice"("agreementId");

CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

CREATE INDEX "Refund_invoiceId_idx" ON "Refund"("invoiceId");

CREATE INDEX "CustomerCredit_customerId_idx" ON "CustomerCredit"("customerId");

CREATE INDEX "MaintenanceRequest_applianceId_idx" ON "MaintenanceRequest"("applianceId");

CREATE INDEX "PricingRule_applianceTypeId_idx" ON "PricingRule"("applianceTypeId");
