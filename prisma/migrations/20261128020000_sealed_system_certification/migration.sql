-- OPS-2: refrigerant certification per team member, and the sealed-system flag on visits (additive).
ALTER TABLE "Job" ADD COLUMN "sealedSystem" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "TeamCertification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'EPA_608_TYPE_I',
    "certificationNumber" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TeamCertification_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamCertification_userId_kind_key" ON "TeamCertification"("userId", "kind");
ALTER TABLE "TeamCertification" ADD CONSTRAINT "TeamCertification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
