import type { Prisma } from "@prisma/client";

/**
 * Attach a newly recorded manual receipt to the one deposit it funded.
 *
 * The caller already holds the customer-ledger lock. We deliberately refuse
 * to guess when one receipt covers more than one deposit because
 * Deposit.sourceReceiptId is a one-to-one immutable funding identity.
 */
export async function attachManualDepositSourceReceipt(
  tx: Prisma.TransactionClient,
  input: { customerId: string; receiptId: string },
): Promise<void> {
  const candidates = await tx.$queryRaw<Array<{ depositId: string }>>`
    SELECT d."id" AS "depositId"
    FROM "Payment" p
    JOIN "Invoice" i ON i."id" = p."invoiceId"
    JOIN "InvoiceLineItem" li
      ON li."invoiceId" = i."id"
     AND li."kind" = 'DEPOSIT'
    JOIN "Deposit" d ON d."agreementId" = i."agreementId"
    JOIN "RentalAgreement" a ON a."id" = d."agreementId"
    WHERE p."receiptId" = ${input.receiptId}
      AND i."customerId" = ${input.customerId}
      AND a."customerId" = ${input.customerId}
  `;

  const depositIds = [...new Set(candidates.map((row) => row.depositId))];
  if (depositIds.length === 0) return;
  if (depositIds.length > 1) {
    throw new Error(
      "This manual payment would fund more than one security deposit. Record those deposit payments separately so each deposit keeps a clear original payment source.",
    );
  }

  const depositId = depositIds[0]!;
  const locked = await tx.$queryRaw<
    Array<{ id: string; customerId: string; sourceReceiptId: string | null }>
  >`
    SELECT d."id", a."customerId", d."sourceReceiptId"
    FROM "Deposit" d
    JOIN "RentalAgreement" a ON a."id" = d."agreementId"
    WHERE d."id" = ${depositId}
    FOR UPDATE OF d
  `;
  const deposit = locked[0];
  if (!deposit) {
    throw new Error("The deposit funded by this payment no longer exists.");
  }
  if (deposit.customerId !== input.customerId) {
    throw new Error("A receipt cannot fund another customer's deposit.");
  }
  if (deposit.sourceReceiptId) {
    if (deposit.sourceReceiptId !== input.receiptId) {
      throw new Error(
        "This deposit is already linked to a different original payment receipt. Review the deposit before recording another payment.",
      );
    }
    return;
  }

  const receipt = await tx.receipt.findUnique({
    where: { id: input.receiptId },
    select: { customerId: true, source: true },
  });
  if (!receipt || receipt.customerId !== input.customerId || receipt.source !== "MANUAL") {
    throw new Error("The manual deposit receipt could not be verified.");
  }

  await tx.$executeRaw`
    UPDATE "Deposit"
    SET "sourceReceiptId" = ${input.receiptId}
    WHERE "id" = ${depositId}
      AND "sourceReceiptId" IS NULL
  `;
}
