-- Messages the customer is owed, kept exactly as written (first use: the renewal reminder
-- required before an automatic renewal). New table only; additive.
CREATE TABLE "CustomerNotice" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "agreementId" TEXT,
    "kind" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "sentByUserId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CustomerNotice_dedupeKey_key" ON "CustomerNotice"("dedupeKey");
CREATE INDEX "CustomerNotice_status_idx" ON "CustomerNotice"("status");
CREATE INDEX "CustomerNotice_customerId_idx" ON "CustomerNotice"("customerId");
CREATE INDEX "CustomerNotice_agreementId_idx" ON "CustomerNotice"("agreementId");

ALTER TABLE "CustomerNotice" ADD CONSTRAINT "CustomerNotice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
