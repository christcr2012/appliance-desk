-- CU-1 (AR-4c): Customers list data foundations.
-- 1. Customer.phoneDigits (digits-only search key, maintained by
--    customerContactKeys at every write that sets phone), backfilled here.
-- 2. Trigram GIN indexes for the list search (pg_trgm already created by
--    LD-1's leads migration; IF NOT EXISTS keeps this safe either way).
--    User.email is indexed on lower("email") — Prisma cannot declare an
--    expression index, so that one lives only in this SQL.
-- 3. Composite btrees the customer_list_v1 view's per-customer LATERALs use.
-- 4. The customer_list_v1 view: one row per live customer (archived and the
--    walk-in counter-sale customer excluded), facts computed live — the
--    CUSTOMERS spec section 1 design change (no stored summary table).

ALTER TABLE "Customer" ADD COLUMN "phoneDigits" TEXT;

UPDATE "Customer" SET "phoneDigits" = NULLIF(regexp_replace("phone", '\D', '', 'g'), '');

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Customer_phoneDigits_idx" ON "Customer"("phoneDigits");
CREATE INDEX IF NOT EXISTS "Customer_companyName_trgm" ON "Customer" USING gin ("companyName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ServiceAddress_line1_trgm" ON "ServiceAddress" USING gin ("line1" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "ServiceAddress_city_trgm" ON "ServiceAddress" USING gin ("city" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_name_trgm" ON "User" USING gin ("name" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "User_email_lower_trgm" ON "User" USING gin (lower("email") gin_trgm_ops);

CREATE INDEX "RentalAgreement_customerId_status_idx" ON "RentalAgreement"("customerId", "status");
CREATE INDEX "Invoice_customerId_status_dueDate_idx" ON "Invoice"("customerId", "status", "dueDate");
CREATE INDEX "Job_customerId_status_scheduledAt_idx" ON "Job"("customerId", "status", "scheduledAt");

CREATE OR REPLACE VIEW "customer_list_v1" AS
SELECT
  c."id" AS "id",
  COALESCE(a."activeCount", 0)::int AS "activeCount",
  COALESCE(a."pendingCount", 0)::int AS "pendingCount",
  COALESCE(a."endedCount", 0)::int AS "endedCount",
  COALESCE(r."monthlyRentCents", 0)::int AS "monthlyRentCents",
  a."nextBillOn" AS "nextBillOn",
  a."endingOn" AS "endingOn",
  COALESCE(i."owedCents", 0)::int AS "owedCents",
  i."oldestOpenDueDate" AS "oldestOpenDueDate",
  v."nextVisitAt" AS "nextVisitAt",
  v."nextVisitType" AS "nextVisitType",
  p."pickupAt" AS "pickupAt",
  (c."stripeDefaultPaymentMethodId" IS NOT NULL) AS "autopay",
  COALESCE(s."propertyCount", 0)::int AS "propertyCount",
  s."city" AS "city"
FROM "Customer" c
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) FILTER (WHERE ra."status" = 'ACTIVE') AS "activeCount",
    COUNT(*) FILTER (
      WHERE ra."status" IN ('DRAFT', 'AWAITING_SIGNATURE', 'SCHEDULED')
         OR (ra."status" = 'ACTIVE' AND ra."firstDeliveredOn" IS NULL)
    ) AS "pendingCount",
    COUNT(*) FILTER (WHERE ra."status" = 'ENDED') AS "endedCount",
    MIN(ra."nextBillingDate") FILTER (WHERE ra."status" = 'ACTIVE') AS "nextBillOn",
    MIN(ra."endDate") FILTER (
      WHERE ra."status" = 'ACTIVE' AND ra."termMonths" IS NOT NULL
        AND ra."terminationRequestedAt" IS NULL
    ) AS "endingOn"
  FROM "RentalAgreement" ra
  WHERE ra."customerId" = c."id"
) a ON true
LEFT JOIN LATERAL (
  SELECT COALESCE(SUM(rl."monthlyPriceCents"), 0) AS "monthlyRentCents"
  FROM "RentalLine" rl
  JOIN "RentalAgreement" ra2 ON ra2."id" = rl."agreementId"
  WHERE ra2."customerId" = c."id" AND ra2."status" = 'ACTIVE'
) r ON true
LEFT JOIN LATERAL (
  -- The Bills money rule (billOwedWhere / openRule in bill-status.ts): the
  -- four open statuses with more due than paid. GREATEST keeps an overpaid
  -- row at 0 in the sum; the due>paid predicate keeps its date out of the MIN.
  SELECT
    COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0) AS "owedCents",
    MIN(inv."dueDate") FILTER (WHERE inv."amountDueCents" > inv."amountPaidCents") AS "oldestOpenDueDate"
  FROM "Invoice" inv
  WHERE inv."customerId" = c."id"
    AND inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
) i ON true
LEFT JOIN LATERAL (
  SELECT j."scheduledAt" AS "nextVisitAt", j."type" AS "nextVisitType"
  FROM "Job" j
  WHERE j."customerId" = c."id"
    AND j."status" IN ('SCHEDULED', 'IN_PROGRESS')
    AND j."scheduledAt" >= now()
  ORDER BY j."scheduledAt" ASC, j."id" ASC
  LIMIT 1
) v ON true
LEFT JOIN LATERAL (
  SELECT MIN(j2."scheduledAt") AS "pickupAt"
  FROM "Job" j2
  WHERE j2."customerId" = c."id" AND j2."type" = 'REMOVAL' AND j2."status" = 'SCHEDULED'
) p ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*) AS "propertyCount",
    (SELECT sa."city" FROM "ServiceAddress" sa
      WHERE sa."customerId" = c."id"
      ORDER BY sa."createdAt" ASC, sa."id" ASC LIMIT 1) AS "city"
  FROM "ServiceAddress" sa2
  WHERE sa2."customerId" = c."id"
) s ON true
WHERE c."archivedAt" IS NULL AND NOT c."isWalkIn";
