import type { InvoiceLineItemKind as PrismaInvoiceLineItemKind, Prisma } from "@prisma/client";

import { computeTax, type EngineResult } from "@/domains/tax/engine";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import type { InvoiceLineItemKind } from "@/domains/tax/categories";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { lockCustomerLedger } from "@/domains/billing/ledger";

export type AgreementInvoiceTaxLine = {
  key: string;
  kind: InvoiceLineItemKind;
  amountCents: number;
  parentKey?: string;
};

export async function computeAgreementInvoiceTax(
  tx: Prisma.TransactionClient,
  input: {
    agreementId: string;
    taxDate: Date;
    lines: AgreementInvoiceTaxLine[];
  },
): Promise<EngineResult> {
  const agreement = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: input.agreementId },
    select: { serviceAddressId: true },
  });
  const location = await tx.addressTaxLocation.findFirst({
    where: {
      serviceAddressId: agreement.serviceAddressId,
      isCurrent: true,
    },
    select: {
      status: true,
      jurisdictions: {
        select: {
          jurisdiction: {
            select: { name: true, reviewStatus: true },
          },
        },
      },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  const problems = new Set<string>();
  if (!location || location.status !== "VERIFIED") {
    problems.add("Confirm the tax areas for this service address before sending this bill.");
  }
  if (location?.status === "VERIFIED" && location.jurisdictions.length === 0) {
    problems.add("Choose at least one tax area for this service address before sending this bill.");
  }
  for (const row of location?.jurisdictions ?? []) {
    if (row.jurisdiction.reviewStatus !== "REVIEWED") {
      problems.add(`Review ${row.jurisdiction.name} before sending this bill.`);
    }
  }

  const context = await getAgreementTaxContext(
    tx,
    input.agreementId,
    input.taxDate,
  );
  const computed = computeTax({ ...context, lines: input.lines });
  if (!computed.ok) {
    for (const problem of computed.problems) problems.add(problem);
  }

  return problems.size > 0
    ? { ok: false, problems: [...problems] }
    : computed;
}


export async function replaceEngineInvoiceTaxLines(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    result: Extract<EngineResult, { ok: true }>;
    lineItemIdByKey: ReadonlyMap<string, string>;
  },
): Promise<void> {
  await tx.invoiceTaxLine.deleteMany({
    where: { invoiceId: input.invoiceId, source: "ENGINE" },
  });

  if (input.result.lines.length === 0) return;

  await tx.invoiceTaxLine.createMany({
    data: input.result.lines.map((line) => {
      const invoiceLineItemId = input.lineItemIdByKey.get(line.lineKey);
      if (!invoiceLineItemId) {
        throw new Error(
          `Couldn't match tax result line ${line.lineKey} to its invoice line.`,
        );
      }
      return {
        invoiceId: input.invoiceId,
        invoiceLineItemId,
        jurisdictionId: line.jurisdictionId,
        rateVersionId: line.rateVersionId,
        category: line.category,
        taxableCents: line.taxableCents,
        exemptCents: line.exemptCents,
        exemptReason: line.exemptReason,
        taxCents: line.taxCents,
        source: "ENGINE" as const,
      };
    }),
  });
}


type LocalTaxedInvoiceLine = {
  kind: PrismaInvoiceLineItemKind;
  description: string;
  amountCents: number;
  quantity?: number;
  rentalLineId?: string | null;
};

export async function createLocalTaxedInvoice(
  tx: Prisma.TransactionClient,
  input: {
    userId: string | null;
    agreementId: string;
    customerId: string;
    taxDate: Date;
    billingPeriodStart?: Date | null;
    billingPeriodEnd?: Date | null;
    dueDate?: Date | null;
    lines: LocalTaxedInvoiceLine[];
  },
) {
  const subtotalCents = input.lines.reduce(
    (sum, line) => sum + line.amountCents,
    0,
  );
  const invoice = await tx.invoice.create({
    data: {
      customerId: input.customerId,
      agreementId: input.agreementId,
      status: "DRAFT",
      billingPeriodStart: input.billingPeriodStart ?? null,
      billingPeriodEnd: input.billingPeriodEnd ?? null,
      subtotalCents,
      taxCents: 0,
      amountDueCents: subtotalCents,
      amountPaidCents: 0,
      dueDate: input.dueDate ?? null,
    },
  });

  const persistedLines = [];
  for (const line of input.lines) {
    persistedLines.push(
      await tx.invoiceLineItem.create({
        data: {
          invoiceId: invoice.id,
          kind: line.kind,
          description: line.description,
          amountCents: line.amountCents,
          quantity: line.quantity ?? 1,
          rentalLineId: line.rentalLineId ?? null,
        },
      }),
    );
  }

  const result = await computeAgreementInvoiceTax(tx, {
    agreementId: input.agreementId,
    taxDate: input.taxDate,
    lines: persistedLines.map((line) => ({
      key: line.id,
      kind: line.kind,
      amountCents: line.amountCents,
    })),
  });

  if (!result.ok) {
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.tax_decision_needed",
        entityType: "Invoice",
        entityId: invoice.id,
        newValue: {
          agreementId: input.agreementId,
          taxDate: businessDateKey(input.taxDate),
          problems: result.problems,
        },
      },
    });
    return { invoice, result };
  }

  await replaceEngineInvoiceTaxLines(tx, {
    invoiceId: invoice.id,
    result,
    lineItemIdByKey: new Map(
      persistedLines.map((line) => [line.id, line.id]),
    ),
  });
  if (result.totalTaxCents > 0) {
    await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        kind: "TAX",
        description: "Sales tax",
        amountCents: result.totalTaxCents,
        quantity: 1,
        rentalLineId: null,
      },
    });
  }
  const opened = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "OPEN",
      taxCents: result.totalTaxCents,
      amountDueCents: subtotalCents + result.totalTaxCents,
    },
  });
  return { invoice: opened, result };
}


function taxDateFromAudit(
  value: Prisma.JsonValue | null,
  fallback: Date,
): Date {
  if (!value || Array.isArray(value) || typeof value !== "object") return fallback;
  const taxDate = (value as Prisma.JsonObject).taxDate;
  return typeof taxDate === "string"
    ? (businessDateFromKey(taxDate) ?? fallback)
    : fallback;
}

export async function recalculateDraftInvoiceTax(
  tx: Prisma.TransactionClient,
  input: { invoiceId: string; userId: string },
) {
  const summary = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    select: { customerId: true },
  });
  await lockCustomerLedger(tx, summary.customerId);
  await tx.$queryRaw`
    SELECT "id" FROM "Invoice" WHERE "id" = ${input.invoiceId} FOR UPDATE
  `;

  const invoice = await tx.invoice.findUniqueOrThrow({
    where: { id: input.invoiceId },
    include: { lineItems: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (invoice.status !== "DRAFT" || !invoice.agreementId) {
    throw new Error("Only a draft agreement bill can have tax recalculated.");
  }

  const marker = await tx.auditLog.findFirst({
    where: {
      entityType: "Invoice",
      entityId: invoice.id,
      action: "billing.tax_decision_needed",
    },
    select: { newValue: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const fallbackTaxDate =
    invoice.dueDate ?? invoice.billingPeriodStart ?? invoice.createdAt;
  const taxDate = taxDateFromAudit(marker?.newValue ?? null, fallbackTaxDate);
  const taxableLines = invoice.lineItems.filter((line) => line.kind !== "TAX");
  const result = await computeAgreementInvoiceTax(tx, {
    agreementId: invoice.agreementId,
    taxDate,
    lines: taxableLines.map((line) => ({
      key: line.id,
      kind: line.kind,
      amountCents: line.amountCents,
    })),
  });

  if (!result.ok) {
    await tx.auditLog.create({
      data: {
        userId: input.userId,
        action: "billing.tax_decision_needed",
        entityType: "Invoice",
        entityId: invoice.id,
        newValue: {
          agreementId: invoice.agreementId,
          taxDate: businessDateKey(taxDate),
          problems: result.problems,
        },
      },
    });
    return { invoice, result };
  }

  await tx.invoiceLineItem.deleteMany({
    where: { invoiceId: invoice.id, kind: "TAX" },
  });
  await replaceEngineInvoiceTaxLines(tx, {
    invoiceId: invoice.id,
    result,
    lineItemIdByKey: new Map(taxableLines.map((line) => [line.id, line.id])),
  });
  if (result.totalTaxCents > 0) {
    await tx.invoiceLineItem.create({
      data: {
        invoiceId: invoice.id,
        kind: "TAX",
        description: "Sales tax",
        amountCents: result.totalTaxCents,
        quantity: 1,
        rentalLineId: null,
      },
    });
  }

  const opened = await tx.invoice.update({
    where: { id: invoice.id },
    data: {
      status: "OPEN",
      version: { increment: 1 },
      taxCents: result.totalTaxCents,
      amountDueCents:
        invoice.subtotalCents -
        invoice.discountCents +
        invoice.lateFeeCents +
        result.totalTaxCents,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: input.userId,
      action: "billing.tax_recalculated",
      entityType: "Invoice",
      entityId: invoice.id,
      oldValue: { status: "DRAFT", taxCents: invoice.taxCents },
      newValue: { status: "OPEN", taxCents: result.totalTaxCents },
    },
  });
  return { invoice: opened, result };
}
