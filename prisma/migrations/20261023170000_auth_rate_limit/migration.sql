-- Additive: the sign-in attempt counter now lives in the database (shared by every server copy)
-- instead of each server's own memory, so the limit holds however many copies are running.
CREATE TABLE IF NOT EXISTS "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,
    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RateLimit_key_key" ON "RateLimit"("key");
