-- Links a scheduled Job back to the MaintenanceRequest it's resolving,
-- so "Schedule a job for this" on a maintenance request's detail page
-- can pre-fill the customer, service address, and appliance instead of
-- Chris picking them by hand every time, and so a maintenance request's
-- own detail page can show any job(s) already scheduled for it.
--
-- Nullable/additive: a Job can still exist with no linked
-- MaintenanceRequest (a delivery, install, swap, or removal has nothing
-- to link to), and every existing row is unaffected.

ALTER TABLE "Job" ADD COLUMN "maintenanceRequestId" TEXT;

CREATE INDEX "Job_maintenanceRequestId_idx" ON "Job"("maintenanceRequestId");

ALTER TABLE "Job" ADD CONSTRAINT "Job_maintenanceRequestId_fkey"
    FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id");
