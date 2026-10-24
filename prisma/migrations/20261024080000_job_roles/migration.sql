-- Additive (Batch ACC, ACC-5). Job roles: named lists of desk screens on top of an access level (they only narrow).
CREATE TABLE "JobRole" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "accessLevel" "Role" NOT NULL,
  "screens" JSONB NOT NULL DEFAULT '[]',
  "capabilityLimits" JSONB NOT NULL DEFAULT '[]',
  "isStarter" BOOLEAN NOT NULL DEFAULT false,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "JobRole_archivedAt_idx" ON "JobRole"("archivedAt");
ALTER TABLE "User" ADD COLUMN "jobRoleId" TEXT;
ALTER TABLE "TeamInvitation" ADD COLUMN "jobRoleId" TEXT;
-- The four starting job roles (the owner can edit or archive them under Settings -> Team).
INSERT INTO "JobRole" ("id","label","accessLevel","screens","capabilityLimits","isStarter","updatedAt") VALUES ('jobrole-driver','Driver / technician','STAFF','["tasks", "dispatch", "maintenance", "inventory", "activity"]','[]',true,CURRENT_TIMESTAMP);
INSERT INTO "JobRole" ("id","label","accessLevel","screens","capabilityLimits","isStarter","updatedAt") VALUES ('jobrole-office','Office','STAFF','["tasks", "leads", "customers", "communications", "agreements", "phone-orders", "dispatch", "maintenance", "inventory", "activity"]','[]',true,CURRENT_TIMESTAMP);
INSERT INTO "JobRole" ("id","label","accessLevel","screens","capabilityLimits","isStarter","updatedAt") VALUES ('jobrole-bookkeeper','Bookkeeper','ADMIN','["tasks", "customers", "agreements", "estimates", "billing", "sales-tax", "books", "expenses", "suppliers", "activity"]','["EDIT_SETTINGS"]',true,CURRENT_TIMESTAMP);
INSERT INTO "JobRole" ("id","label","accessLevel","screens","capabilityLimits","isStarter","updatedAt") VALUES ('jobrole-manager','Manager','ADMIN','["tasks", "leads", "customers", "communications", "agreements", "phone-orders", "estimates", "dispatch", "maintenance", "inventory", "billing", "sales-tax", "books", "expenses", "suppliers", "activity", "management"]','[]',true,CURRENT_TIMESTAMP);
