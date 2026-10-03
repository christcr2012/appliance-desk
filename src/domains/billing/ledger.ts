import type { InvoiceStatus, Prisma } from "@prisma/client";
import { HELD_PAYMENT_STATUS } from "./payment-status";

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
      const expected = [...input.allocations].sort((a, b) =>
        a.invoiceId.localeCompare(b.invoiceId),
      );
      const actual = [...existing.payments].sort((a, b) =>
        a.invoiceId.localeCompare(b.invoiceId),
      );
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

/**
 * Real money arrived (by card) for an invoice the owner had already written off
 * or voided. The cash is recorded as received, but it is NOT applied to the
 * closed invoice and it is NOT turned into spendable account credit: what to do
 * with it is the owner's decision (docs/OWNER-INPUTS.md IN-23). It is kept as
 * a receipt plus a `held` payment row, which counts for no balance, appears in
 * the drift workbench, and still lets a later Stripe refund find it.
 * Safe to call again for the same charge.
 */
export async function holdReceiptForClosedInvoice(
  tx: Prisma.TransactionClient,
  input: {
    customerId: string;
    invoiceId: string;
    amountCents: number;
    method: string;
    receivedOn: Date;
    stripeChargeId?: string | null;
    stripePaymentIntentId?: string | null;
  },
): Promise<{ receiptId: string; created: boolean }> {
  positiveInteger(input.amountCents, "Held payment amount");
  await lockCustomerLedger(tx, input.customerId);

  if (input.stripeChargeId) {
    const existing = await tx.receipt.findUnique({
      where: { stripeChargeId: input.stripeChargeId },
      select: { id: true, customerId: true, amountCents: true },
    });
    if (existing) {
      if (existing.customerId !== input.customerId || existing.amountCents !== input.amountCents) {
        throw new Error("Stripe charge is already recorded against different receipt data.");
      }
      return { receiptId: existing.id, created: false };
    }
  }

  const receipt = await tx.receipt.create({
    data: {
      customerId: input.customerId,
      source: "STRIPE",
      amountCents: input.amountCents,
      method: input.method,
      stripeChargeId: input.stripeChargeId ?? null,
      receivedOn: input.receivedOn,
      notes: "Held: the invoice was already written off or voided. Waiting for the owner's decision.",
    },
    select: { id: true },
  });
  await tx.payment.create({
    data: {
      invoiceId: input.invoiceId,
      receiptId: receipt.id,
      amountCents: input.amountCents,
      method: input.method,
      status: HELD_PAYMENT_STATUS,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      stripeChargeId: input.stripeChargeId ?? null,
      notes: "Held for the owner: payment arrived after the invoice was closed.",
    },
  });
  return { receiptId: receipt.id, created: true };
}

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

/**
 * Apply local credit exactly once to one invoice. The CustomerCredit row is
 * locked first. If a BALANCE_CREDIT provider intent already exists for this
 * credit, the credit is reserved for Stripe and cannot also be spent locally.
 * The provider intent is created while holding this same credit lock, so the
 * local-vs-provider race has one serialization point without a network call in
 * the transaction.
 */
export async function applyCreditToInvoice(
  tx: Prisma.TransactionClient,
  input: {
    creditId: string;
    invoiceId: string;
    amountCents: number;
    appliedByUserId: string;
  },
): Promise<void> {
  positiveInteger(input.amountCents, "Credit amount");

  const creditRows = await tx.$queryRaw<
    Array<{
      id: string;
      customerId: string;
      remainingCents: number;
      appliedViaStripeAt: Date | null;
      reason: string;
    }>
  >`
    SELECT "id", "customerId", "remainingCents", "appliedViaStripeAt", "reason"
    FROM "CustomerCredit"
    WHERE "id" = ${input.creditId}
    FOR UPDATE
  `;
  const credit = creditRows[0];
  if (!credit) throw new Error("Couldn't find that customer credit.");
  if (credit.appliedViaStripeAt) {
    throw new Error("This credit was already applied through Stripe and cannot be spent locally.");
  }

  const providerReservation = await tx.providerOperation.findFirst({
    where: {
      kind: "BALANCE_CREDIT",
      subjectType: "CustomerCredit",
      subjectId: credit.id,
    },
    select: { id: true, status: true },
  });
  if (providerReservation) {
    throw new Error(
      "This credit is reserved for Stripe settlement and cannot also be spent locally.",
    );
  }

  if (credit.remainingCents < input.amountCents) {
    throw new Error("That credit does not have enough remaining balance.");
  }

  const invoiceRows = await tx.$queryRaw<
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
    WHERE "id" = ${input.invoiceId}
    FOR UPDATE
  `;
  const invoice = invoiceRows[0];
  if (!invoice) throw new Error("Couldn't find that invoice.");
  if (invoice.customerId !== credit.customerId) {
    throw new Error("A customer credit cannot be applied to another customer's invoice.");
  }
  if (!OPEN_INVOICE_STATUSES.has(invoice.status)) {
    throw new Error("Credit can only be applied to an open invoice.");
  }

  const outstandingCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  if (input.amountCents > outstandingCents) {
    throw new Error("Credit amount exceeds the invoice's outstanding balance.");
  }

  const newAmountPaidCents = invoice.amountPaidCents + input.amountCents;
  const status = nextInvoiceStatus(invoice.amountDueCents, newAmountPaidCents);

  await tx.creditApplication.create({
    data: {
      creditId: credit.id,
      invoiceId: invoice.id,
      amountCents: input.amountCents,
      appliedByUserId: input.appliedByUserId,
    },
  });
  await tx.invoiceLineItem.create({
    data: {
      invoiceId: invoice.id,
      kind: "CREDIT",
      description: credit.reason || "Account credit",
      amountCents: -input.amountCents,
    },
  });
  await tx.customerCredit.update({
    where: { id: credit.id },
    data: { remainingCents: { decrement: input.amountCents } },
  });
  await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      amountPaidCents: newAmountPaidCents,
      status,
      version: { increment: 1 },
    },
  });
}
