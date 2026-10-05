import type { Prisma } from "@prisma/client";
import * as base from "./ledger-base";

export * from "./ledger-base";

/**
 * R06: if one receipt unambiguously and completely funds one deposit invoice,
 * persist that receipt as the deposit's immutable funding source. Ambiguous
 * multi-receipt or multi-deposit payments deliberately remain unlinked for
 * reconciliation rather than inventing provenance.
 */
async function attachUnambiguousDepositSource(
  tx: Prisma.TransactionClient,
  receiptId: string,
  allocations: Array<{ invoiceId: string; amountCents: number }>,
): Promise<void> {
  const candidates = new Map<string, string | null>();

  for (const allocation of allocations) {
    const rows = await tx.$queryRaw<
      Array<{ depositId: string; sourceReceiptId: string | null }>
    >`
      SELECT DISTINCT
        d."id" AS "depositId",
        d."sourceReceiptId" AS "sourceReceiptId"
      FROM "Deposit" d
      JOIN "Invoice" i ON i."agreementId" = d."agreementId"
      JOIN "InvoiceLineItem" li ON li."invoiceId" = i."id"
      WHERE i."id" = ${allocation.invoiceId}
        AND i."status" = 'PAID'::"InvoiceStatus"
        AND li."kind" = 'DEPOSIT'::"InvoiceLineItemKind"
        AND NOT EXISTS (
          SELECT 1
          FROM "Payment" p
          WHERE p."invoiceId" = i."id"
            AND p."status" IN ('succeeded', 'SUCCEEDED')
            AND p."receiptId" IS NOT NULL
            AND p."receiptId" <> ${receiptId}
        )
    `;
    for (const row of rows) candidates.set(row.depositId, row.sourceReceiptId);
  }

  if (candidates.size !== 1) return;
  const [depositId, existingSourceReceiptId] = [...candidates.entries()][0]!;
  if (existingSourceReceiptId) {
    if (existingSourceReceiptId !== receiptId) {
      // Real money has already been recorded by the base ledger at this point.
      // Never roll that cash record back merely because this later receipt is
      // not the deposit's original funding source. Preserve the immutable link
      // and leave durable owner-visible evidence of the conflict instead.
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "billing.deposit_source_conflict",
          entityType: "Deposit",
          entityId: depositId,
          newValue: {
            existingSourceReceiptId,
            candidateReceiptId: receiptId,
            handling:
              "Original deposit funding provenance was preserved; the later receipt remains recorded and requires owner review if it represents duplicate deposit money.",
          },
        },
      });
    }
    return;
  }

  const usedByAnother = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Deposit"
    WHERE "sourceReceiptId" = ${receiptId}
      AND "id" <> ${depositId}
    FOR UPDATE
  `;
  if (usedByAnother.length > 0) return;

  await tx.$executeRaw`
    UPDATE "Deposit"
    SET "sourceReceiptId" = ${receiptId}
    WHERE "id" = ${depositId}
      AND "sourceReceiptId" IS NULL
  `;
}

export async function createReceiptWithAllocations(
  tx: Prisma.TransactionClient,
  input: base.CreateReceiptInput,
): Promise<{ receiptId: string; overpaymentCreditId: string | null }> {
  const result = await base.createReceiptWithAllocations(tx, input);
  if (input.allocations.length > 0) {
    await attachUnambiguousDepositSource(tx, result.receiptId, input.allocations);
  }
  return result;
}
