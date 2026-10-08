import type { Prisma } from "@prisma/client";

import { businessDateKey } from "@/lib/business-date";
import {
  applyLocalInvoiceTaxInTx,
  type LocalInvoiceTaxResult,
} from "./local-invoice";

const PREPAID_RENT_DESCRIPTION_PREFIX = "Prepaid rent —";

export type PrepaidRentInvoiceResult = {
  invoiceId: string;
  created: boolean;
  status: "DRAFT" | "OPEN";
  taxResult: LocalInvoiceTaxResult | null;
};

/**
 * Create the one local invoice that represents a full-term prepaid rental.
 *
 * The agreement row is locked here even when the caller already owns that lock.
 * That makes retries serialize on the same agreement and lets the deterministic
 * prepaid-rent line marker act as the idempotency claim without adding a second
 * money table just for this one workflow.
 */
export async function createPrepaidRentInvoiceInTx(
  tx: Prisma.TransactionClient,
  agreementId: string,
  signedAt: Date,
): Promise<PrepaidRentInvoiceResult | null> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "RentalAgreement"
    WHERE "id" = ${agreementId}
    FOR UPDATE
  `;
  if (locked.length !== 1) {
    throw new Error("Couldn't find that rental agreement.");
  }

  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      customerId: true,
      paidInFullInAdvance: true,
      termMonths: true,
      freeMonthGranted: true,
      lines: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          label: true,
          monthlyPriceCents: true,
        },
      },
    },
  });

  if (!agreement.paidInFullInAdvance) return null;
  if (agreement.termMonths !== 12) {
    throw new Error("A prepaid-in-full agreement must have a 12-month term.");
  }
  if (agreement.lines.length === 0) {
    throw new Error("A prepaid agreement needs at least one rental line before it can be invoiced.");
  }

  const existing = await tx.invoice.findFirst({
    where: {
      agreementId,
      lineItems: {
        some: {
          kind: "RENTAL",
          description: { startsWith: PREPAID_RENT_DESCRIPTION_PREFIX },
        },
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, status: true },
  });
  if (existing) {
    return {
      invoiceId: existing.id,
      created: false,
      status: existing.status === "DRAFT" ? "DRAFT" : "OPEN",
      taxResult: null,
    };
  }

  const monthsToBill = agreement.termMonths - (agreement.freeMonthGranted ? 1 : 0);
  const lines = agreement.lines.map((line) => ({
    rentalLineId: line.id,
    description: `${PREPAID_RENT_DESCRIPTION_PREFIX} ${line.label} (${monthsToBill} months)`,
    amountCents: line.monthlyPriceCents * monthsToBill,
  }));
  const subtotalCents = lines.reduce((sum, line) => sum + line.amountCents, 0);

  const invoice = await tx.invoice.create({
    data: {
      customerId: agreement.customerId,
      agreementId,
      status: "DRAFT",
      subtotalCents,
      discountCents: 0,
      taxCents: 0,
      lateFeeCents: 0,
      amountDueCents: subtotalCents,
      dueDate: signedAt,
      billingPeriodStart: signedAt,
      lineItems: {
        create: lines.map((line) => ({
          kind: "RENTAL",
          description: line.description,
          amountCents: line.amountCents,
          quantity: 1,
          rentalLineId: line.rentalLineId,
        })),
      },
    },
    select: { id: true },
  });

  const taxResult = await applyLocalInvoiceTaxInTx(tx, {
    invoiceId: invoice.id,
    agreementId,
    taxDate: signedAt,
    actorUserId: null,
  });

  await tx.auditLog.create({
    data: {
      userId: null,
      action: "billing.prepaid_rent_invoice_created",
      entityType: "Invoice",
      entityId: invoice.id,
      newValue: {
        agreementId,
        idempotencyKey: `prepaid-rent-${agreementId}`,
        issuedOn: businessDateKey(signedAt),
        monthsBilled: monthsToBill,
        subtotalCents,
        taxReady: taxResult.ok,
      },
    },
  });

  return {
    invoiceId: invoice.id,
    created: true,
    status: taxResult.ok ? "OPEN" : "DRAFT",
    taxResult,
  };
}
