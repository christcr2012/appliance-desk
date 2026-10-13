-- Supports the exact newest-first owner billing page ordering. Additive,
-- with existing ID primary key and customer/period indexes preserved.
-- Rollback: DROP INDEX IF EXISTS "Invoice_createdAt_id_idx";
CREATE INDEX "Invoice_createdAt_id_idx" ON "Invoice" ("createdAt" DESC, "id" DESC);
