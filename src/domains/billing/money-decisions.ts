import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { applyCreditToInvoice, lockCustomerLedger } from "./ledger";

/**
 * Owner/admin decision: spend a customer's account credit on one of their open invoices (docs/archive/designs-completed/BATCH-D.md D5).
 * The actor is checked again inside the transaction, the customer's ledger is locked first (lock order: customer
 * ledger, then the credit and invoice rows inside `applyCreditToInvoice`), and an audit row is written.
 * No money moves outside the database: this only changes what the customer owes.
 */
export async function applyCreditDecision(
  userId: string,
  input: { creditId: string; invoiceId: string; amountCents: number },
): Promise<void> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Credit amount must be a positive whole number of cents.");
  }
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const invoice = await tx.invoice.findUnique({ where: { id: input.invoiceId }, select: { customerId: true } });
    if (!invoice) throw new Error("Couldn't find that invoice.");
    await lockCustomerLedger(tx, invoice.customerId);
    await applyCreditToInvoice(tx, { ...input, appliedByUserId: userId });
    await tx.auditLog.create({
      data: {
        userId,
        action: "credit.applied_to_invoice",
        entityType: "Invoice",
        entityId: input.invoiceId,
        newValue: { creditId: input.creditId, amountCents: input.amountCents },
      },
    });
  });
}

/** Credits a customer can still spend locally (not already given through Stripe). */
export async function getSpendableCredits(customerId: string) {
  return prisma.customerCredit.findMany({
    where: { customerId, remainingCents: { gt: 0 }, appliedViaStripeAt: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, remainingCents: true, reason: true, createdAt: true },
    take: 50,
  });
}
