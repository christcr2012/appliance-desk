-- R06: preserve the immutable receipt that originally funded a deposit.
-- Renewal may move Deposit.agreementId, but sourceReceiptId never moves.

ALTER TABLE "Deposit"
  ADD COLUMN "sourceReceiptId" TEXT;

-- Historical backfill is deliberately conservative. A receipt is a candidate
-- only when its successful allocation to a deposit invoice can by itself cover
-- that invoice's deposit line amount. Then link only deposits with exactly one
-- distinct candidate receipt, owned by the same customer, and whose receipt is
-- not also claimed by another deposit in this backfill. Credit-assisted,
-- split-payment, duplicate-deposit-invoice, and otherwise ambiguous history
-- remains NULL for runtime/owner reconciliation rather than guessing a rail.
WITH "depositReceiptCandidates" AS (
  SELECT
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
  GROUP BY d."id", p."receiptId", i."id"
  HAVING (
    SELECT COALESCE(SUM(li."amountCents"), 0)
    FROM "InvoiceLineItem" li
    WHERE li."invoiceId" = i."id"
      AND li."kind" = 'DEPOSIT'
  ) > 0
  AND SUM(p."amountCents") >= (
    SELECT COALESCE(SUM(li."amountCents"), 0)
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
  HAVING COUNT(DISTINCT "receiptId") = 1
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
