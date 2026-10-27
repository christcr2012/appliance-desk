-- OPS-5: card and bank disputes. Additive only.

-- CreateEnum
CREATE TYPE "DisputeState" AS ENUM ('NEEDS_RESPONSE', 'UNDER_REVIEW', 'WON', 'LOST', 'CLOSED');

-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN "achDisputeWindowDays" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "Customer" ADD COLUMN "bankDebitBlockedAt" TIMESTAMP(3);
ALTER TABLE "Customer" ADD COLUMN "bankDebitBlockedReason" TEXT;

-- CreateTable
CREATE TABLE "PaymentDispute" (
    "id" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "paymentId" TEXT,
    "invoiceId" TEXT,
    "customerId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "stripeStatus" TEXT NOT NULL,
    "state" "DisputeState" NOT NULL DEFAULT 'NEEDS_RESPONSE',
    "isBank" BOOLEAN NOT NULL DEFAULT false,
    "dueBy" TIMESTAMP(3),
    "outcome" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "lastEventAt" TIMESTAMP(3) NOT NULL,
    "lastEventId" TEXT NOT NULL,
    "evidenceSubmittedAt" TIMESTAMP(3),
    "evidenceSubmittedByUserId" TEXT,
    "evidenceFileId" TEXT,
    "evidencePacketBytes" INTEGER,
    "evidenceSummary" JSONB,
    "handledAt" TIMESTAMP(3),
    "handledByUserId" TEXT,
    "handledNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentDispute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDispute_stripeDisputeId_key" ON "PaymentDispute"("stripeDisputeId");
CREATE INDEX "PaymentDispute_state_idx" ON "PaymentDispute"("state");
CREATE INDEX "PaymentDispute_customerId_idx" ON "PaymentDispute"("customerId");
CREATE INDEX "PaymentDispute_invoiceId_idx" ON "PaymentDispute"("invoiceId");
CREATE INDEX "PaymentDispute_paymentId_idx" ON "PaymentDispute"("paymentId");

-- AddForeignKey
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentDispute" ADD CONSTRAINT "PaymentDispute_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
