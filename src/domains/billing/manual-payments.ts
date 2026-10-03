import type { InvoiceStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  createReceiptWithAllocations,
  lockCustomerLedger,
} from "./ledger";

export type ManualPaymentMethod = "check" | "cash" | "bank_transfer" | "other";

export type ManualPaymentInput = {
  amountCents: number;
  method: ManualPaymentMethod;
  reference?: string;
  notes?: string;
  /** Colorado business date the money was actually received. Defaults to
   * now only for older callers; the owner UI supplies this explicitly. */
  receivedOn?: Date;
  /** Apply the whole amount to one specific invoice instead of spreading
   * it across every open invoice oldest-first. */
  invoiceId?: string;
};

export type ManualPaymentResult = {
  totalAppliedCents: number;
  overpaymentCents: number;
  invoicesTouched: {
    invoiceId: string;
    invoiceNumber: number;
    appliedCents: number;
    newStatus: string;
  }[];
};

function nextInvoiceStatus(amountDueCents: number, amountPaidCents: number): InvoiceStatus {
  if (amountPaidCents <= 0) return "OPEN";
  if (amountPaidCents >= amountDueCents) return "PAID";
  return "PARTIALLY_PAID";
}

/**
 * Record one real offline cash event, then allocate that receipt across the
 * customer's open invoices. A combined property-manager check is therefore
 * one Receipt with several Payment allocation rows rather than several fake
 * independent cash events.
 */
export async function recordManualPayment(
  customerId: string,
  actingUserId: string,
  input: ManualPaymentInput,
): Promise<ManualPaymentResult> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error("Enter a payment amount greater than $0.");
  }
  const receivedOn = input.receivedOn ?? new Date();
  if (!Number.isFinite(receivedOn.getTime())) {
    throw new Error("Enter a valid date the payment was received.");
  }

  let result: ManualPaymentResult | undefined;

  await prisma.$transaction(async (tx) => {
    await lockCustomerLedger(tx, customerId);

    const targetInvoices = await tx.invoice.findMany({
      where: input.invoiceId
        ? {
            id: input.invoiceId,
            customerId,
            status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
          }
        : {
            customerId,
            status: { in: ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] },
          },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    if (input.invoiceId && targetInvoices.length === 0) {
      throw new Error(
        "That invoice isn't open — it may already be paid or written off, or belongs to a different customer.",
      );
    }

    let remainingCents = input.amountCents;
    const allocations: Array<{ invoiceId: string; amountCents: number }> = [];
    const invoicesTouched: ManualPaymentResult["invoicesTouched"] = [];

    for (const invoice of targetInvoices) {
      if (remainingCents <= 0) break;
      const owedCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
      if (owedCents <= 0) continue;

      const appliedCents = Math.min(owedCents, remainingCents);
      const newAmountPaidCents = invoice.amountPaidCents + appliedCents;
      const newStatus = nextInvoiceStatus(invoice.amountDueCents, newAmountPaidCents);
      allocations.push({ invoiceId: invoice.id, amountCents: appliedCents });
      invoicesTouched.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        appliedCents,
        newStatus,
      });
      remainingCents -= appliedCents;
    }

    const receiptNotes = [
      input.reference ? `Ref: ${input.reference}` : null,
      input.notes?.trim() || null,
    ]
      .filter(Boolean)
      .join(" — ") || undefined;

    await createReceiptWithAllocations(tx, {
      customerId,
      source: "MANUAL",
      amountCents: input.amountCents,
      method: input.method,
      receivedOn,
      recordedByUserId: actingUserId,
      notes: receiptNotes,
      allocations,
    });

    // Keep the existing per-invoice audit trail even though the receipt is now
    // the cash source of truth.
    for (const allocation of allocations) {
      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: "billing.manual_payment",
          entityType: "Invoice",
          entityId: allocation.invoiceId,
          newValue: {
            amountCents: allocation.amountCents,
            method: input.method,
            reference: input.reference ?? null,
            receivedOn: receivedOn.toISOString(),
          },
        },
      });
    }

    result = {
      totalAppliedCents: input.amountCents - remainingCents,
      overpaymentCents: remainingCents,
      invoicesTouched,
    };
  });

  return result!;
}

/**
 * Mark an invoice uncollectible only from a locked, current invoice snapshot.
 * A payment that reaches PAID first therefore cannot be overwritten by a
 * stale write-off decision (P8 H1).
 */
export async function writeOffInvoice(
  invoiceId: string,
  actingUserId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        status: InvoiceStatus;
        amountDueCents: number;
        amountPaidCents: number;
      }>
    >`
      SELECT "id", "status", "amountDueCents", "amountPaidCents"
      FROM "Invoice"
      WHERE "id" = ${invoiceId}
      FOR UPDATE
    `;
    const invoice = rows[0];
    if (!invoice) {
      throw new Error("Couldn't find that invoice.");
    }
    if (invoice.status === "PAID" || invoice.amountPaidCents >= invoice.amountDueCents) {
      throw new Error("This invoice is already fully paid — nothing to write off.");
    }
    if (invoice.status === "WRITTEN_OFF") {
      throw new Error("This invoice is already written off.");
    }

    await tx.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "WRITTEN_OFF",
        writtenOffAt: new Date(),
        writtenOffReason: reason,
        version: { increment: 1 },
      },
    });

    await tx.auditLog.create({
      data: {
        userId: actingUserId,
        action: "billing.invoice_written_off",
        entityType: "Invoice",
        entityId: invoiceId,
        newValue: { reason },
      },
    });
  });
}
