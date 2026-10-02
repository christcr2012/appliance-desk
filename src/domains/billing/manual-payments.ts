import type { InvoiceStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ---------------------------------------------------------------------------
// Manual (offline) payments (Task #72 follow-on, docs/DECISIONS.md
// 2026-09-28) — for money that moved outside Stripe entirely: a check, cash,
// or a bank transfer Chris confirmed himself. A property manager with
// several properties who pays with one combined check for all of them is
// exactly the case this exists for — this is the other half of "formal B2B
// invoicing," alongside the read-only statement in statements.ts.
//
// Deliberately separate from Stripe's own webhook-driven Payment creation
// (src/domains/billing/webhooks.ts) — recordManualPayment is the only
// place a Payment row is ever created by a person instead of by Stripe
// telling us money actually moved. Every such row is auditable
// (recordedByUserId set, an AuditLog entry) and OWNER/ADMIN only; nothing
// here ever calls the Stripe API.
// ---------------------------------------------------------------------------

export type ManualPaymentMethod = "check" | "cash" | "bank_transfer" | "other";

export type ManualPaymentInput = {
  amountCents: number;
  method: ManualPaymentMethod;
  reference?: string;
  notes?: string;
  /** Apply the whole amount to one specific invoice instead of spreading
   * it across every open invoice oldest-first. Use this for the common
   * single-property case; leave it out for a property manager's combined
   * check covering several invoices at once. */
  invoiceId?: string;
};

export type ManualPaymentResult = {
  totalAppliedCents: number;
  overpaymentCents: number;
  invoicesTouched: { invoiceId: string; invoiceNumber: number; appliedCents: number; newStatus: string }[];
};

function nextInvoiceStatus(amountDueCents: number, amountPaidCents: number): InvoiceStatus {
  if (amountPaidCents <= 0) return "OPEN";
  if (amountPaidCents >= amountDueCents) return "PAID";
  return "PARTIALLY_PAID";
}

/**
 * Serialize every owner-entered financial mutation for one customer before
 * reading invoice balances. A customer row is the natural aggregate lock:
 * one combined offline payment can span several invoices, so locking only
 * one invoice would still allow two allocators to read different stale
 * snapshots of the same customer's open balance.
 *
 * All callers that compete with manual allocation (currently payment entry
 * and write-off below) take this lock first, then read/revalidate invoices.
 */
async function lockCustomerLedger(tx: Prisma.TransactionClient, customerId: string) {
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

/**
 * Records a payment Chris took outside Stripe and applies it to the
 * customer's open balance. With no invoiceId, spreads the amount across
 * every OPEN/PARTIALLY_PAID/DELINQUENT invoice for that customer,
 * oldest-due-first (the natural order to pay down first) — exactly the
 * "one check covers three properties' invoices" scenario. Any amount
 * left over once every open invoice is fully paid becomes a
 * CustomerCredit (the same model referral rewards already use), so an
 * overpayment is never silently lost or left unaccounted for.
 *
 * The customer ledger row is locked before invoice balances are read. Two
 * simultaneous manual-payment requests therefore cannot both calculate from
 * the same stale amountPaidCents and later overwrite each other's invoice
 * balance while still leaving two succeeded Payment rows.
 */
export async function recordManualPayment(
  customerId: string,
  actingUserId: string,
  input: ManualPaymentInput,
): Promise<ManualPaymentResult> {
  if (input.amountCents <= 0) {
    throw new Error("Enter a payment amount greater than $0.");
  }

  let remainingCents = input.amountCents;
  const invoicesTouched: ManualPaymentResult["invoicesTouched"] = [];

  await prisma.$transaction(async (tx) => {
    await lockCustomerLedger(tx, customerId);

    // Read only after the aggregate lock is held. The same open-invoice
    // statuses are required whether a specific invoice was picked or the
    // payment is spreading across everything open.
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

    for (const invoice of targetInvoices) {
      if (remainingCents <= 0) break;
      const owedCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
      if (owedCents <= 0) continue;

      const appliedCents = Math.min(owedCents, remainingCents);
      const newAmountPaidCents = invoice.amountPaidCents + appliedCents;
      const newStatus = nextInvoiceStatus(invoice.amountDueCents, newAmountPaidCents);

      await tx.payment.create({
        data: {
          invoiceId: invoice.id,
          amountCents: appliedCents,
          method: input.method,
          status: "succeeded",
          recordedByUserId: actingUserId,
          notes:
            [input.reference ? `Ref: ${input.reference}` : null, input.notes || null]
              .filter(Boolean)
              .join(" — ") || null,
        },
      });

      await tx.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidCents: newAmountPaidCents, status: newStatus },
      });

      await tx.auditLog.create({
        data: {
          userId: actingUserId,
          action: "billing.manual_payment",
          entityType: "Invoice",
          entityId: invoice.id,
          newValue: {
            amountCents: appliedCents,
            method: input.method,
            reference: input.reference ?? null,
          },
        },
      });

      invoicesTouched.push({
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        appliedCents,
        newStatus,
      });
      remainingCents -= appliedCents;
    }

    // Leftover beyond every open invoice — an overpayment, not an error.
    // Recorded as a CustomerCredit so it's visible on the customer's own
    // page and available to apply toward whatever they owe next.
    if (remainingCents > 0) {
      await tx.customerCredit.create({
        data: {
          customerId,
          amountCents: remainingCents,
          remainingCents,
          reason: "Overpayment",
          notes: `From a manual ${input.method} payment recorded ${new Date().toLocaleDateString("en-US")}${
            input.reference ? ` (ref: ${input.reference})` : ""
          } that exceeded the open balance.`,
          authorizedByUserId: actingUserId,
        },
      });
    }
  });

  return {
    totalAppliedCents: input.amountCents - remainingCents,
    overpaymentCents: Math.max(0, remainingCents),
    invoicesTouched,
  };
}

/**
 * Marks an invoice uncollectible. It uses the same customer-ledger lock as
 * manual payment allocation and re-reads the invoice after acquiring that
 * lock. Payment vs write-off therefore has a deterministic serialized order:
 * the second operation sees the first operation's committed balance/status
 * rather than acting on a stale pre-lock snapshot.
 */
export async function writeOffInvoice(
  invoiceId: string,
  actingUserId: string,
  reason: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const beforeLock = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { customerId: true },
    });
    if (!beforeLock) {
      throw new Error("Couldn't find that invoice.");
    }

    await lockCustomerLedger(tx, beforeLock.customerId);

    const invoice = await tx.invoice.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      throw new Error("Couldn't find that invoice.");
    }
    if (invoice.status === "PAID") {
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
