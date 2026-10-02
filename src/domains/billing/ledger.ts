import type { InvoiceStatus, Prisma } from "@prisma/client";

const OPEN_INVOICE_STATUSES = new Set<InvoiceStatus>([
  "OPEN",
  "PARTIALLY_PAID",
  "DELINQUENT",
]);

function positiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive whole number of cents.`);
  }
}

function nextInvoiceStatus(amountDueCents: number, amountPaidCents: number): InvoiceStatus {
  if (amountPaidCents <= 0) return "OPEN";
  if (amountPaidCents >= amountDueCents) return "PAID";
  return "PARTIALLY_PAID";
}

/**
 * Aggregate lock for all customer-ledger mutations. Receipt allocation,
 * write-off and credit application all start here so two financial writers
 * cannot calculate from different stale snapshots of the same account.
 */
export async function lockCustomerLedger(
  tx: Prisma.TransactionClient,
  customerId: string,
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "Customer"
    WHERE "id" = ${customerId}
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error("Couldn't find that customer.");
  }
}

type ReceiptAllocation = { invoiceId: string; amountCents: number };

export type CreateReceiptInput = {
  customerId: string;
  source: "STRIPE" | "MANUAL";
  amountCents: number;
  method: string;
  receivedOn: Date;
  stripeChargeId?: string;
  recordedByUserId?: string;
  notes?: string;
  allocations: ReceiptAllocation[];
};

/**
 * One real-world payment event plus its invoice allocations. The customer and
 * every target invoice are locked before any money projection is changed.
 * Invoice locks are acquired in id order so multi-invoice receipts have a
 * deterministic lock order and cannot deadlock each other.
 */
export async function createReceiptWithAllocations(
  tx: Prisma.TransactionClient,
  input: CreateReceiptInput,
): Promise<{ receiptId: string; overpaymentCreditId: string | null }> {
  positiveInteger(input.amountCents, "Receipt amount");
  if (!input.method.trim()) throw new Error("Receipt method is required.");
  if (!Number.isFinite(input.receivedOn.getTime())) {
    throw new Error("Receipt received date is invalid.");
  }

  const seen = new Set<string>();
  let allocatedCents = 0;
  for (const allocation of input.allocations) {
    positiveInteger(allocation.amountCents, "Allocation amount");
    if (seen.has(allocation.invoiceId)) {
      throw new Error("A receipt cannot allocate to the same invoice twice.");
    }
    seen.add(allocation.invoiceId);
    allocatedCents += allocation.amountCents;
  }
  if (allocatedCents > input.amountCents) {
    throw new Error("Receipt allocations cannot exceed the money received.");
  }

  await lockCustomerLedger(tx, input.customerId);

  // Stripe retries and different webhook types can describe the same charge.
  // A unique charge id makes the receipt itself idempotent, independent of the
  // WebhookEvent idempotency record.
  if (input.stripeChargeId) {
    const existing = await tx.receipt.findUnique({
      where: { stripeChargeId: input.stripeChargeId },
      select: {
        id: true,
        customerId: true,
        source: true,
        amountCents: true,
        payments: { select: { invoiceId: true, amountCents: true } },
      },
    });
    if (existing) {
      if (
        existing.customerId !== input.customerId ||
        existing.source !== input.source ||
        existing.amountCents !== input.amountCents
      ) {
        throw new Error("Stripe charge is already recorded against different receipt data.");
      }
      const expected = [...input.allocations].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
      const actual = [...existing.payments].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId));
      if (
        expected.length !== actual.length ||
        expected.some(
          (allocation, index) =>
            allocation.invoiceId !== actual[index]?.invoiceId ||
            allocation.amountCents !== actual[index]?.amountCents,
        )
      ) {
        throw new Error("Stripe charge is already recorded with different invoice allocations.");
      }
      const credit = await tx.customerCredit.findFirst({
        where: {
          sourceType: "RECEIPT_OVERPAYMENT",
          sourceId: existing.id,
          side: null,
        },
        select: { id: true },
      });
      return { receiptId: existing.id, overpaymentCreditId: credit?.id ?? null };
    }
  }

  const lockedInvoices = new Map<
    string,
    {
      id: string;
      customerId: string;
      status: InvoiceStatus;
      amountDueCents: number;
      amountPaidCents: number;
    }
  >();
  for (const invoiceId of [...seen].sort()) {
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        customerId: string;
        status: InvoiceStatus;
        amountDueCents: number;
        amountPaidCents: number;
      }>
    >`
      SELECT "id", "customerId", "status", "amountDueCents", "amountPaidCents"
      FROM "Invoice"
      WHERE "id" = ${invoiceId}
      FOR UPDATE
    `;
    const invoice = rows[0];
    if (!invoice) throw new Error("Couldn't find an invoice selected for this payment.");
    if (invoice.customerId !== input.customerId) {
      throw new Error("A receipt cannot allocate money to another customer's invoice.");
    }
    if (!OPEN_INVOICE_STATUSES.has(invoice.status)) {
      throw new Error("A receipt can only be allocated to an open invoice.");
    }
    lockedInvoices.set(invoiceId, invoice);
  }

  for (const allocation of input.allocations) {
    const invoice = lockedInvoices.get(allocation.invoiceId)!;
    const outstandingCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
    if (allocation.amountCents > outstandingCents) {
      throw new Error("Receipt allocation exceeds the invoice's outstanding balance.");
    }
  }

  const receipt = await tx.receipt.create({
    data: {
      customerId: input.customerId,
      source: input.source,
      amountCents: input.amountCents,
      method: input.method,
      stripeChargeId: input.stripeChargeId ?? null,
      receivedOn: input.receivedOn,
      recordedByUserId: input.recordedByUserId ?? null,
      notes: input.notes?.trim() || null,
    },
    select: { id: true },
  });

  for (const allocation of input.allocations) {
    const invoice = lockedInvoices.get(allocation.invoiceId)!;
    const newAmountPaidCents = invoice.amountPaidCents + allocation.amountCents;
    const status = nextInvoiceStatus(invoice.amountDueCents, newAmountPaidCents);

    await tx.payment.create({
      data: {
        invoiceId: invoice.id,
        receiptId: receipt.id,
        amountCents: allocation.amountCents,
        method: input.method,
        status: "succeeded",
        recordedByUserId: input.recordedByUserId ?? null,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.invoice.update({
      where: { id: invoice.id },
      data: { amountPaidCents: newAmountPaidCents, status },
    });
  }

  const overpaymentCents = input.amountCents - allocatedCents;
  let overpaymentCreditId: string | null = null;
  if (overpaymentCents > 0) {
    const credit = await tx.customerCredit.create({
      data: {
        customerId: input.customerId,
        amountCents: overpaymentCents,
        remainingCents: overpaymentCents,
        reason: "Overpayment",
        notes: `Unallocated remainder from receipt ${receipt.id}.`,
        authorizedByUserId: input.recordedByUserId ?? null,
        sourceType: "RECEIPT_OVERPAYMENT",
        sourceId: receipt.id,
        side: null,
      },
      select: { id: true },
    });
    overpaymentCreditId = credit.id;
  }

  return { receiptId: receipt.id, overpaymentCreditId };
}

/** Failed provider attempts are not receipts because no money moved. Keeping
 * their Payment rows here preserves attempt/failure history while ensuring
 * every successful Payment allocation is created by the receipt primitive. */
export async function recordFailedPaymentAttempt(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    amountCents: number;
    stripePaymentIntentId?: string | null;
    stripeChargeId?: string | null;
    failureReason: string;
  },
): Promise<void> {
  await tx.payment.create({
    data: {
      invoiceId: input.invoiceId,
      amountCents: input.amountCents,
      status: "failed",
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeChargeId: input.stripeChargeId ?? null,
      failureReason: input.failureReason,
    },
  });
}

/** Preserve provider identifiers on the allocation rows for existing refund
 * and troubleshooting paths while Receipt remains the source of cash truth. */
export async function attachProviderIdsToReceiptPayments(
  tx: Prisma.TransactionClient,
  input: {
    receiptId: string;
    stripePaymentIntentId: string;
    stripeChargeId?: string | null;
  },
): Promise<void> {
  await tx.payment.updateMany({
    where: { receiptId: input.receiptId },
    data: {
      stripePaymentIntentId: input.stripePaymentIntentId,
      stripeChargeId: input.stripeChargeId ?? null,
    },
  });
}
