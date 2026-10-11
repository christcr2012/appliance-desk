CREATE TABLE "ExceptionSnooze" (
    "key" VARCHAR(64) NOT NULL,
    "category" VARCHAR(80) NOT NULL,
    "href" VARCHAR(400) NOT NULL,
    "snoozedUntil" TIMESTAMP(3) NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExceptionSnooze_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "ExceptionSnooze_snoozedUntil_idx" ON "ExceptionSnooze"("snoozedUntil");
ALTER TABLE "ExceptionSnooze" ADD CONSTRAINT "ExceptionSnooze_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
