import type { InvoiceLineItemKind as PrismaInvoiceLineItemKind, Prisma } from "@prisma/client";

import { computeTax, type EngineResult } from "@/domains/tax/engine";
import { getAgreementTaxContext } from "@/domains/tax/locations";
import {
  categoryForLineKind,
  type InvoiceLineItemKind,
  type TaxChargeCategory,
} from "@/domains/tax/categories";
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

export type StripeTaxTotal = {
  taxRateId: string | null;
  amountCents: number;
  taxableCents: number | null;
};

export async function mirrorStripeInvoiceTax(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    agreementId: string;
    taxDate: Date;
    lines: AgreementInvoiceTaxLine[];
    stripeTaxes: StripeTaxTotal[];
  },
): Promise<{
  expectedTaxCents: number | null;
  stripeTaxCents: number;
  problems: string[];
}> {
  await tx.invoiceTaxLine.deleteMany({
    where: { invoiceId: input.invoiceId, source: { in: ["STRIPE", "ENGINE"] } },
  });

  const stripeTaxCents = input.stripeTaxes.reduce(
    (sum, line) => sum + line.amountCents,
    0,
  );
  const result = await computeAgreementInvoiceTax(tx, {
    agreementId: input.agreementId,
    taxDate: input.taxDate,
    lines: input.lines,
  });
  const problems: string[] = [];

  if (!result.ok) {
    problems.push(...result.problems.map((problem) => `Engine check: ${problem}`));
  }

  const rateIds = [
    ...new Set(
      input.stripeTaxes
        .map((line) => line.taxRateId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const versions =
    rateIds.length > 0
      ? await tx.taxRateVersion.findMany({
          where: { stripeTaxRateId: { in: rateIds } },
          select: {
            id: true,
            stripeTaxRateId: true,
            jurisdictionId: true,
          },
        })
      : [];
  const versionByStripeId = new Map(
    versions
      .filter((version) => version.stripeTaxRateId)
      .map((version) => [version.stripeTaxRateId!, version]),
  );

  const engineByJurisdiction = new Map<
    string,
    Extract<EngineResult, { ok: true }>["lines"]
  >();
  if (result.ok) {
    for (const line of result.lines) {
      const rows = engineByJurisdiction.get(line.jurisdictionId) ?? [];
      rows.push(line);
      engineByJurisdiction.set(line.jurisdictionId, rows);
    }

    const exemptRows = result.lines.filter((line) => line.exemptCents !== 0);
    if (exemptRows.length > 0) {
      await tx.invoiceTaxLine.createMany({
        data: exemptRows.map((line) => ({
          invoiceId: input.invoiceId,
          invoiceLineItemId: null,
          jurisdictionId: line.jurisdictionId,
          rateVersionId: line.rateVersionId,
          category: line.category,
          taxableCents: 0,
          exemptCents: line.exemptCents,
          exemptReason: line.exemptReason,
          taxCents: 0,
          source: "ENGINE" as const,
        })),
      });
    }
  }

  const stripeRows: Array<{
    invoiceId: string;
    invoiceLineItemId: null;
    jurisdictionId: string;
    rateVersionId: string;
    category: TaxChargeCategory;
    taxableCents: number;
    exemptCents: number;
    exemptReason: null;
    taxCents: number;
    source: "STRIPE";
  }> = [];
  const stripeByJurisdiction = new Map<string, number>();

  for (const stripeTax of input.stripeTaxes) {
    if (!stripeTax.taxRateId) {
      problems.push(
        `Stripe tax of ${stripeTax.amountCents} cents did not identify a tax rate.`,
      );
      continue;
    }
    const version = versionByStripeId.get(stripeTax.taxRateId);
    if (!version) {
      problems.push(
        `Stripe tax rate ${stripeTax.taxRateId} is not linked to a local tax-rate version.`,
      );
      continue;
    }

    const engineRows = engineByJurisdiction.get(version.jurisdictionId) ?? [];
    const categories = [
      ...new Set(
        engineRows
          .filter((line) => line.taxableCents !== 0 || line.taxCents !== 0)
          .map((line) => line.category),
      ),
    ];
    let category: TaxChargeCategory | null =
      categories.length === 1 ? categories[0]! : null;
    if (!category) {
      const directCategories = [
        ...new Set(
          input.lines
            .map((line) => categoryForLineKind(line.kind, line.amountCents))
            .filter(
              (value): value is TaxChargeCategory =>
                value !== "NOT_TAXABLE" && value !== "FOLLOWS_PARENT",
            ),
        ),
      ];
      if (directCategories.length === 1) category = directCategories[0]!;
    }
    if (!category) {
      problems.push(
        `Stripe tax rate ${stripeTax.taxRateId} covers more than one local tax category, so the jurisdiction detail could not be classified safely.`,
      );
      continue;
    }

    const expectedTaxableCents = engineRows.reduce(
      (sum, line) => sum + line.taxableCents,
      0,
    );
    stripeRows.push({
      invoiceId: input.invoiceId,
      invoiceLineItemId: null,
      jurisdictionId: version.jurisdictionId,
      rateVersionId: version.id,
      category,
      taxableCents: stripeTax.taxableCents ?? expectedTaxableCents,
      exemptCents: 0,
      exemptReason: null,
      taxCents: stripeTax.amountCents,
      source: "STRIPE",
    });
    stripeByJurisdiction.set(
      version.jurisdictionId,
      (stripeByJurisdiction.get(version.jurisdictionId) ?? 0) +
        stripeTax.amountCents,
    );
  }

  if (stripeRows.length > 0) {
    await tx.invoiceTaxLine.createMany({ data: stripeRows });
  }

  if (result.ok) {
    const jurisdictionIds = new Set([
      ...engineByJurisdiction.keys(),
      ...stripeByJurisdiction.keys(),
    ]);
    for (const jurisdictionId of jurisdictionIds) {
      const expected = (engineByJurisdiction.get(jurisdictionId) ?? []).reduce(
        (sum, line) => sum + line.taxCents,
        0,
      );
      const stripe = stripeByJurisdiction.get(jurisdictionId) ?? 0;
      if (Math.abs(expected - stripe) >= 1) {
        problems.push(
          `Jurisdiction ${jurisdictionId}: Stripe charged ${stripe} cents; the engine expected ${expected} cents.`,
        );
      }
    }
  }

  if (problems.length > 0) {
    const existing = await tx.auditLog.findFirst({
      where: {
        entityType: "Invoice",
        entityId: input.invoiceId,
        action: "billing.tax_mismatch",
      },
      select: { id: true },
    });
    if (!existing) {
      await tx.auditLog.create({
        data: {
          userId: null,
          action: "billing.tax_mismatch",
          entityType: "Invoice",
          entityId: input.invoiceId,
          newValue: {
            stripeTaxCents,
            expectedTaxCents: result.ok ? result.totalTaxCents : null,
            problems,
          },
        },
      });
    }
  }

  return {
    expectedTaxCents: result.ok ? result.totalTaxCents : null,
    stripeTaxCents,
    problems,
  };
}


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
