-- Appliance Desk — initial schema
-- Generated to match prisma/schema.prisma. See docs/DATABASE.md.

CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'CUSTOMER');
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'CONVERTED', 'LOST');
CREATE TYPE "ApplianceStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'RENTED', 'MAINTENANCE', 'RETIRED');
CREATE TYPE "RentalAgreementStatus" AS ENUM ('DRAFT', 'AWAITING_SIGNATURE', 'ACTIVE', 'ENDED', 'CANCELLED');
CREATE TYPE "JobType" AS ENUM ('DELIVERY', 'INSTALLATION', 'SWAP', 'MAINTENANCE_VISIT', 'REMOVAL');
CREATE TYPE "JobStatus" AS ENUM ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "MaintenanceStatus" AS ENUM ('SUBMITTED', 'REVIEWING', 'SCHEDULED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'OPEN', 'PAID', 'FAILED', 'VOID', 'DELINQUENT');

-- Auth & people ---------------------------------------------------------

CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMPTZ,
    "passwordHash" TEXT,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CUSTOMER',
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_role_idx" ON "User"("role");

CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

CREATE TABLE "Account" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "idToken" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "Account_providerId_accountId_key" ON "Account"("providerId", "accountId");

CREATE TABLE "Verification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

CREATE TABLE "Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "phone" TEXT,
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "isPropertyManager" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    CONSTRAINT "Customer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE UNIQUE INDEX "Customer_userId_key" ON "Customer"("userId");
CREATE INDEX "Customer_isPropertyManager_idx" ON "Customer"("isPropertyManager");

CREATE TABLE "ServiceAddress" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'CO',
    "zip" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "ServiceAddress_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
);
CREATE INDEX "ServiceAddress_customerId_idx" ON "ServiceAddress"("customerId");
CREATE INDEX "ServiceAddress_zip_idx" ON "ServiceAddress"("zip");

-- Leads -------------------------------------------------------------------

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "isBusiness" BOOLEAN NOT NULL DEFAULT false,
    "isPropertyManager" BOOLEAN NOT NULL DEFAULT false,
    "companyName" TEXT,
    "contactName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "bestTimeToContact" TEXT,
    "howHeard" TEXT,
    "desiredTerm" TEXT,
    "desiredStartDate" TIMESTAMPTZ,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "addressLine1" TEXT,
    "city" TEXT,
    "zip" TEXT,
    "inServiceArea" BOOLEAN,
    "consentedAt" TIMESTAMPTZ,
    "score" INTEGER NOT NULL DEFAULT 0,
    "scoreReasons" JSONB NOT NULL DEFAULT '[]',
    "isHighValue" BOOLEAN NOT NULL DEFAULT false,
    "convertedCustomerId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "Lead_status_idx" ON "Lead"("status");
CREATE INDEX "Lead_score_idx" ON "Lead"("score");

CREATE TABLE "ApplianceType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "showOnWebsite" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX "ApplianceType_name_key" ON "ApplianceType"("name");
CREATE UNIQUE INDEX "ApplianceType_slug_key" ON "ApplianceType"("slug");

CREATE TABLE "LeadApplianceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "leadId" TEXT NOT NULL,
    "applianceTypeId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "LeadApplianceRequest_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE,
    CONSTRAINT "LeadApplianceRequest_applianceTypeId_fkey" FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id")
);

-- Inventory -----------------------------------------------------------------

CREATE TABLE "Appliance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetNumber" TEXT NOT NULL,
    "applianceTypeId" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "serialNumber" TEXT,
    "condition" TEXT,
    "purchaseDate" TIMESTAMPTZ,
    "acquisitionCostCents" INTEGER,
    "status" "ApplianceStatus" NOT NULL DEFAULT 'AVAILABLE',
    "currentLocation" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "archivedAt" TIMESTAMPTZ,
    CONSTRAINT "Appliance_applianceTypeId_fkey" FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id")
);
CREATE UNIQUE INDEX "Appliance_assetNumber_key" ON "Appliance"("assetNumber");
CREATE INDEX "Appliance_status_idx" ON "Appliance"("status");
CREATE INDEX "Appliance_applianceTypeId_idx" ON "Appliance"("applianceTypeId");

-- Rentals & pricing -----------------------------------------------------

CREATE TABLE "RentalAgreement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "serviceAddressId" TEXT NOT NULL,
    "status" "RentalAgreementStatus" NOT NULL DEFAULT 'DRAFT',
    "termMonths" INTEGER,
    "startDate" TIMESTAMPTZ,
    "endDate" TIMESTAMPTZ,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "damageWaiverCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 5,
    "lateFeeCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeePercent" INTEGER NOT NULL DEFAULT 0,
    "taxRatePermille" INTEGER NOT NULL DEFAULT 0,
    "fromLeadId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "RentalAgreement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id"),
    CONSTRAINT "RentalAgreement_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id")
);
CREATE INDEX "RentalAgreement_customerId_idx" ON "RentalAgreement"("customerId");
CREATE INDEX "RentalAgreement_status_idx" ON "RentalAgreement"("status");

CREATE TABLE "RentalLine" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "RentalLine_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id") ON DELETE CASCADE
);

CREATE TABLE "ApplianceAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rentalLineId" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    "assignedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "unassignedAt" TIMESTAMPTZ,
    "unassignReason" TEXT,
    CONSTRAINT "ApplianceAssignment_rentalLineId_fkey" FOREIGN KEY ("rentalLineId") REFERENCES "RentalLine"("id"),
    CONSTRAINT "ApplianceAssignment_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id")
);

CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "applianceTypeId" TEXT,
    "label" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER,
    "oneTimePriceCents" INTEGER,
    "changedBy" TEXT,
    "oldValueCents" INTEGER,
    "newValueCents" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "PricingRule_applianceTypeId_fkey" FOREIGN KEY ("applianceTypeId") REFERENCES "ApplianceType"("id")
);

CREATE TABLE "SignatureRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "signedPdfUrl" TEXT,
    "signedAt" TIMESTAMPTZ,
    "signerName" TEXT,
    "signerEmail" TEXT,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "SignatureRecord_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id")
);
CREATE UNIQUE INDEX "SignatureRecord_agreementId_key" ON "SignatureRecord"("agreementId");

CREATE TABLE "Deposit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "agreementId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "refundable" BOOLEAN NOT NULL DEFAULT true,
    "refundedAt" TIMESTAMPTZ,
    "refundedAmountCents" INTEGER,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "Deposit_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id")
);

-- Jobs ------------------------------------------------------------------

CREATE TABLE "Job" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" TIMESTAMPTZ,
    "customerId" TEXT,
    "serviceAddressId" TEXT,
    "agreementId" TEXT,
    "notes" TEXT,
    "completedAt" TIMESTAMPTZ,
    "completionNotes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Job_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id"),
    CONSTRAINT "Job_serviceAddressId_fkey" FOREIGN KEY ("serviceAddressId") REFERENCES "ServiceAddress"("id"),
    CONSTRAINT "Job_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id")
);
CREATE INDEX "Job_status_idx" ON "Job"("status");
CREATE INDEX "Job_scheduledAt_idx" ON "Job"("scheduledAt");

CREATE TABLE "JobAppliance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "jobId" TEXT NOT NULL,
    "applianceId" TEXT NOT NULL,
    CONSTRAINT "JobAppliance_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE,
    CONSTRAINT "JobAppliance_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id")
);

-- Maintenance -------------------------------------------------------------

CREATE TABLE "MaintenanceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "applianceId" TEXT,
    "problem" TEXT NOT NULL,
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'NORMAL',
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'SUBMITTED',
    "openedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "completedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "MaintenanceRequest_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id"),
    CONSTRAINT "MaintenanceRequest_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id")
);
CREATE INDEX "MaintenanceRequest_status_idx" ON "MaintenanceRequest"("status");

-- Billing -----------------------------------------------------------------

CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "agreementId" TEXT,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "amountDueCents" INTEGER NOT NULL,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "dueDate" TIMESTAMPTZ,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updatedAt" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id"),
    CONSTRAINT "Invoice_agreementId_fkey" FOREIGN KEY ("agreementId") REFERENCES "RentalAgreement"("id")
);
CREATE UNIQUE INDEX "Invoice_stripeInvoiceId_key" ON "Invoice"("stripeInvoiceId");
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");
CREATE INDEX "Invoice_customerId_idx" ON "Invoice"("customerId");

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT,
    "stripePaymentIntentId" TEXT,
    "status" TEXT NOT NULL,
    "failureReason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id")
);

-- Settings, content, media, compliance ------------------------------------

CREATE TABLE "BusinessSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "publicBusinessName" TEXT NOT NULL DEFAULT '[Company Name]',
    "publicPhone" TEXT NOT NULL DEFAULT '[Phone Number]',
    "publicEmail" TEXT NOT NULL DEFAULT '[Email Address]',
    "publicAddress" TEXT NOT NULL DEFAULT '[Business Address]',
    "serviceAreaCities" JSONB NOT NULL DEFAULT '[]',
    "serviceAreaZips" JSONB NOT NULL DEFAULT '[]',
    "hours" JSONB NOT NULL DEFAULT '{}',
    "holidayClosures" JSONB NOT NULL DEFAULT '[]',
    "socialLinks" JSONB NOT NULL DEFAULT '{}',
    "logoUrl" TEXT,
    "oneTimeDeliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
    "oneTimeRemovalFeeCents" INTEGER NOT NULL DEFAULT 0,
    "damageWaiverEnabled" BOOLEAN NOT NULL DEFAULT false,
    "depositEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lateFeeGraceDays" INTEGER NOT NULL DEFAULT 5,
    "lateFeeFlatCents" INTEGER NOT NULL DEFAULT 0,
    "lateFeePercent" INTEGER NOT NULL DEFAULT 0,
    "taxRatePermille" INTEGER NOT NULL DEFAULT 0,
    "taxRateConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "announcementBannerText" TEXT,
    "announcementBannerOn" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ NOT NULL
);

CREATE TABLE "SiteContent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX "SiteContent_key_key" ON "SiteContent"("key");

CREATE TABLE "Photo" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "applianceId" TEXT,
    "jobId" TEXT,
    "maintenanceRequestId" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "Photo_applianceId_fkey" FOREIGN KEY ("applianceId") REFERENCES "Appliance"("id"),
    CONSTRAINT "Photo_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id"),
    CONSTRAINT "Photo_maintenanceRequestId_fkey" FOREIGN KEY ("maintenanceRequestId") REFERENCES "MaintenanceRequest"("id")
);

CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT,
    "kind" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "ConsentRecord_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id")
);
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- Seed the one-row settings table so the app always has a row to read.
INSERT INTO "BusinessSettings" ("id", "updatedAt") VALUES ('singleton', now());
