-- R06: preserve the immutable receipt that originally funded a deposit.
-- Renewal may move Deposit.agreementId, but sourceReceiptId never moves.

ALTER TABLE "Deposit"
  ADD COLUMN "sourceReceiptId" TEXT;

-- Historical backfill is deliberately conservative. Link only deposits whose
-- current agreement has exactly one distinct successful deposit receipt, whose
-- receipt belongs to the same customer, and whose receipt cannot be claimed by
-- another deposit in this same backfill. Ambiguous rows remain NULL for the
-- runtime reconciliation path rather than guessing a refund rail.
WITH "depositReceiptCandidates" AS (
  SELECT DISTINCT
    d."id" AS "depositId",
    p."receiptId" AS "receiptId"
  FROM "Deposit" d
  JOIN "RentalAgreement" a
    ON a."id" = d."agreementId"
  JOIN "Invoice" i
    ON i."agreementId" = d."agreementId"
   AND i."customerId" = a."customerId"
  JOIN "Payment" p
    ON p."invoiceId" = i."id"
   AND p."receiptId" IS NOT NULL
   AND p."status" IN ('succeeded', 'SUCCEEDED')
  JOIN "Receipt" r
    ON r."id" = p."receiptId"
   AND r."customerId" = a."customerId"
  WHERE EXISTS (
    SELECT 1
    FROM "InvoiceLineItem" li
    WHERE li."invoiceId" = i."id"
      AND li."kind" = 'DEPOSIT'
  )
),
"singleReceiptPerDeposit" AS (
  SELECT
    "depositId",
    MIN("receiptId") AS "receiptId"
  FROM "depositReceiptCandidates"
  GROUP BY "depositId"
  HAVING COUNT(*) = 1
),
"safeLinks" AS (
  SELECT s."depositId", s."receiptId"
  FROM "singleReceiptPerDeposit" s
  WHERE NOT EXISTS (
    SELECT 1
    FROM "singleReceiptPerDeposit" other
    WHERE other."receiptId" = s."receiptId"
      AND other."depositId" <> s."depositId"
  )
)
UPDATE "Deposit" d
SET "sourceReceiptId" = s."receiptId"
FROM "safeLinks" s
WHERE d."id" = s."depositId"
  AND d."sourceReceiptId" IS NULL;

CREATE UNIQUE INDEX "Deposit_sourceReceiptId_key"
  ON "Deposit"("sourceReceiptId");

ALTER TABLE "Deposit"
  ADD CONSTRAINT "Deposit_sourceReceiptId_fkey"
  FOREIGN KEY ("sourceReceiptId")
  REFERENCES "Receipt"("id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
