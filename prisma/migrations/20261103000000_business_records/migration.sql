-- AlterTable
ALTER TABLE "BusinessSettings" ADD COLUMN     "paperworkAdminKinds" TEXT[] DEFAULT ARRAY['DOCUMENT', 'LICENSE', 'PERMIT', 'REGISTRATION', 'INSURANCE', 'VEHICLE', 'CONTRACT']::TEXT[];

-- AlterTable
ALTER TABLE "BusinessPaperwork" ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "credentialId" TEXT,
ADD COLUMN     "expiresOn" TIMESTAMP(3),
ADD COLUMN     "issuedOn" TIMESTAMP(3),
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'TASK',
ADD COLUMN     "linkedObligationKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "numberEncrypted" TEXT,
ADD COLUMN     "numberLabel" VARCHAR(60),
ADD COLUMN     "numberLast4" VARCHAR(4),
ADD COLUMN     "portalUrl" VARCHAR(500);

-- CreateTable
CREATE TABLE "BusinessRecordFile" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "fileName" VARCHAR(200) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "label" VARCHAR(120),
    "uploadedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "BusinessRecordFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessRecordFile_pathname_key" ON "BusinessRecordFile"("pathname");

-- CreateIndex
CREATE INDEX "BusinessRecordFile_recordId_deletedAt_idx" ON "BusinessRecordFile"("recordId", "deletedAt");

-- AddForeignKey
ALTER TABLE "BusinessRecordFile" ADD CONSTRAINT "BusinessRecordFile_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "BusinessPaperwork"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

