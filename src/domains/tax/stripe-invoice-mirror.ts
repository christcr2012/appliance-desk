import type Stripe from "stripe";
import type {
  InvoiceLineItemKind,
  Prisma,
  TaxChargeCategory,
} from "@prisma/client";

import { categoryForLineKind } from "@/domains/tax/categories";
import { computeTax } from "@/domains/tax/engine";
import { getAgreementTaxContext, loadRentalAcquisitionBasis } from "@/domains/tax/locations";

export type MirroredStripeChargeLine = {
  stripeLine: Stripe.InvoiceLineItem;
  invoiceLineItemId: string;
  kind: InvoiceLineItemKind;
  amountCents: number;
};

type StripeLineTax = NonNullable<Stripe.InvoiceLineItem["taxes"]>[number];

function stripeTaxRateId(tax: StripeLineTax): string | null {
  const raw = tax.tax_rate_details?.tax_rate as
    | string
    | { id: string }
    | null
    | undefined;
  return typeof raw === "string" ? raw : raw?.id ?? null;
}

function chargeCategory(
  kind: InvoiceLineItemKind,
  amountCents: number,
): TaxChargeCategory | null {
  const category = categoryForLineKind(kind, amountCents);
  return category === "NOT_TAXABLE" || category === "FOLLOWS_PARENT"
    ? null
    : category;
}

function comparisonKey(lineId: string, rateVersionId: string): string {
  return `${lineId}:${rateVersionId}`;
}

function stripeTotalTaxCents(invoice: Stripe.Invoice): number {
  return (invoice.total_taxes ?? []).reduce((sum, entry) => sum + entry.amount, 0);
}

/**
 * Persist Stripe's actual tax evidence when Appliance Desk can map and verify
 * it, then independently compare it with the jurisdiction engine.
 *
 * Stripe is the money authority for a Stripe invoice. Tax-verification trouble
 * must never roll back an already-issued provider invoice/payment: incomplete
 * mapping/readiness becomes a high-priority review audit instead. Stripe is
 * never edited here.
 */
export async function recordStripeInvoiceTaxEvidenceInTx(
  tx: Prisma.TransactionClient,
  input: {
    invoiceId: string;
    agreementId: string;
    stripeInvoice: Stripe.Invoice;
    chargeLines: MirroredStripeChargeLine[];
  },
): Promise<void> {
  const alreadyRecorded = await tx.invoiceTaxLine.count({
    where: { invoiceId: input.invoiceId },
  });
  if (alreadyRecorded > 0) return;

  const problems: string[] = [];
  const providerPieces: Array<{
    line: MirroredStripeChargeLine;
    tax: StripeLineTax;
    stripeTaxRateId: string;
  }> = [];

  for (const line of input.chargeLines) {
    for (const tax of line.stripeLine.taxes ?? []) {
      const rateId = stripeTaxRateId(tax);
      if (!rateId) {
        problems.push(
          "Stripe invoice tax is missing its manual Tax Rate ID, so jurisdiction evidence could not be verified.",
        );
        continue;
      }
      providerPieces.push({ line, tax, stripeTaxRateId: rateId });
    }
  }

  const providerRateIds = [
    ...new Set(providerPieces.map((piece) => piece.stripeTaxRateId)),
  ];
  const rateVersions =
    providerRateIds.length === 0
      ? []
      : await tx.taxRateVersion.findMany({
          where: { stripeTaxRateId: { in: providerRateIds } },
          select: {
            id: true,
            jurisdictionId: true,
            stripeTaxRateId: true,
          },
        });
  const byStripeRateId = new Map(
    rateVersions
      .filter((row) => row.stripeTaxRateId)
      .map((row) => [row.stripeTaxRateId!, row]),
  );

  const stripeRows: Prisma.InvoiceTaxLineCreateManyInput[] = [];
  for (const { line, tax, stripeTaxRateId: rateId } of providerPieces) {
    const version = byStripeRateId.get(rateId);
    if (!version) {
      problems.push(
        `Stripe Tax Rate ${rateId} is not linked to a TaxRateVersion.`,
      );
      continue;
    }
    if (tax.taxable_amount === null) {
      problems.push(
        `Stripe Tax Rate ${rateId} is missing its taxable amount.`,
      );
      continue;
    }
    const category = chargeCategory(line.kind, line.amountCents);
    if (!category) {
      problems.push(
        `Stripe reported tax on a ${line.kind} line that cannot be mapped to a taxable charge category.`,
      );
      continue;
    }
    stripeRows.push({
      invoiceId: input.invoiceId,
      invoiceLineItemId: line.invoiceLineItemId,
      jurisdictionId: version.jurisdictionId,
      rateVersionId: version.id,
      category,
      taxableCents: tax.taxable_amount,
      exemptCents: 0,
      exemptReason: null,
      taxCents: tax.amount,
      source: "STRIPE",
    });
  }

  const providerDateSeconds =
    typeof input.stripeInvoice.period_start === "number"
      ? input.stripeInvoice.period_start
      : typeof input.stripeInvoice.created === "number"
        ? input.stripeInvoice.created
        : null;

  let engine:
    | ReturnType<typeof computeTax>
    | null = null;
  if (providerDateSeconds === null || !Number.isFinite(providerDateSeconds)) {
    problems.push(
      "Stripe invoice date evidence is missing, so Appliance Desk could not verify which tax rates applied.",
    );
  } else {
    const taxDate = new Date(providerDateSeconds * 1000);
    const context = await getAgreementTaxContext(
      tx,
      input.agreementId,
      taxDate,
    );
    const invoiceLines = await tx.invoiceLineItem.findMany({
      where: { id: { in: input.chargeLines.map(line => line.invoiceLineItemId) }, invoiceId: input.invoiceId },
      select: { id: true, kind: true, rentalLineId: true },
    });
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: input.invoiceId }, select: { billingPeriodStart: true } });
    const acquisitionBasis = await loadRentalAcquisitionBasis(tx, input.agreementId, invoice.billingPeriodStart, invoiceLines.map(line => ({ key: line.id, kind: line.kind, rentalLineId: line.rentalLineId })));
    engine = computeTax({
      ...context,
      lines: input.chargeLines.map((line) => ({
        key: line.invoiceLineItemId,
        kind: line.kind,
        amountCents: line.amountCents,
        acquisitionBasis: acquisitionBasis.get(line.invoiceLineItemId),
      })),
    });
    if (!engine.ok) {
      problems.push(...engine.problems);
    }
  }

  if (problems.length > 0 || !engine || !engine.ok) {
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "billing.stripe_tax_unverified",
        entityType: "Invoice",
        entityId: input.invoiceId,
        newValue: {
          stripeInvoiceId: input.stripeInvoice.id,
          stripeTaxCents: stripeTotalTaxCents(input.stripeInvoice),
          problems: [...new Set(problems)],
        },
      },
    });
    return;
  }

  const engineExemptRows: Prisma.InvoiceTaxLineCreateManyInput[] = engine.lines
    .filter((line) => line.exemptCents > 0)
    .map((line) => ({
      invoiceId: input.invoiceId,
      invoiceLineItemId: line.lineKey,
      jurisdictionId: line.jurisdictionId,
      rateVersionId: line.rateVersionId,
      category: line.category,
      taxableCents: line.taxableCents,
      exemptCents: line.exemptCents,
      exemptReason: line.exemptReason,
      taxCents: line.taxCents,
      source: "ENGINE",
    }));

  if (stripeRows.length > 0 || engineExemptRows.length > 0) {
    await tx.invoiceTaxLine.createMany({
      data: [...stripeRows, ...engineExemptRows],
    });
  }

  const actualByKey = new Map<string, number>();
  for (const row of stripeRows) {
    if (!row.invoiceLineItemId) continue;
    const key = comparisonKey(row.invoiceLineItemId, row.rateVersionId);
    actualByKey.set(key, (actualByKey.get(key) ?? 0) + row.taxCents);
  }
  const expectedByKey = new Map<string, number>();
  for (const row of engine.lines) {
    if (row.taxCents <= 0) continue;
    const key = comparisonKey(row.lineKey, row.rateVersionId);
    expectedByKey.set(key, (expectedByKey.get(key) ?? 0) + row.taxCents);
  }

  const keys = new Set([...actualByKey.keys(), ...expectedByKey.keys()]);
  const differences = [...keys]
    .map((key) => {
      const stripeTaxCents = actualByKey.get(key) ?? 0;
      const engineTaxCents = expectedByKey.get(key) ?? 0;
      return {
        key,
        stripeTaxCents,
        engineTaxCents,
        differenceCents: stripeTaxCents - engineTaxCents,
      };
    })
    .filter((row) => Math.abs(row.differenceCents) >= 1);

  if (differences.length > 0) {
    await tx.auditLog.create({
      data: {
        userId: null,
        action: "billing.stripe_tax_mismatch",
        entityType: "Invoice",
        entityId: input.invoiceId,
        newValue: {
          stripeInvoiceId: input.stripeInvoice.id,
          stripeTaxCents: stripeRows.reduce(
            (sum, row) => sum + row.taxCents,
            0,
          ),
          engineTaxCents: engine.lines.reduce(
            (sum, row) => sum + row.taxCents,
            0,
          ),
          differences,
        },
      },
    });
  }
}
