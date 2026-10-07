import type Stripe from "stripe";
import type {
  InvoiceLineItemKind,
  Prisma,
  TaxChargeCategory,
} from "@prisma/client";

import { categoryForLineKind } from "@/domains/tax/categories";
import { computeTax } from "@/domains/tax/engine";
import { getAgreementTaxContext } from "@/domains/tax/locations";

export type MirroredStripeChargeLine = {
  stripeLine: Stripe.InvoiceLineItem;
  invoiceLineItemId: string;
  kind: InvoiceLineItemKind;
  amountCents: number;
};

type StripeLineTax = NonNullable<Stripe.InvoiceLineItem["taxes"]>[number];

function stripeTaxRateId(tax: StripeLineTax): string {
  const raw = tax.tax_rate_details?.tax_rate as
    | string
    | { id: string }
    | null
    | undefined;
  const id = typeof raw === "string" ? raw : raw?.id;
  if (!id) {
    throw new Error(
      "Stripe invoice tax is missing its manual Tax Rate ID; tax evidence cannot be mapped safely.",
    );
  }
  return id;
}

function chargeCategory(
  kind: InvoiceLineItemKind,
  amountCents: number,
): TaxChargeCategory {
  const category = categoryForLineKind(kind, amountCents);
  if (category === "NOT_TAXABLE" || category === "FOLLOWS_PARENT") {
    throw new Error(
      `Stripe reported tax on a ${kind} line that the tax engine cannot map to a taxable charge category.`,
    );
  }
  return category;
}

function comparisonKey(lineId: string, rateVersionId: string): string {
  return `${lineId}:${rateVersionId}`;
}

/**
 * Persist the provider's actual per-jurisdiction tax evidence, then independently
 * recompute the same provider charge lines with Appliance Desk's tax engine.
 *
 * Taxable rows use source STRIPE because Stripe is the money authority for a
 * Stripe invoice. ENGINE rows are stored only for exempt portions that Stripe
 * correctly never sees. A one-cent-or-more difference is recorded once on the
 * invoice for the Today exception inbox; Stripe is never edited here.
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

  const providerPieces = input.chargeLines.flatMap((line) =>
    (line.stripeLine.taxes ?? []).map((tax) => ({
      line,
      tax,
      stripeTaxRateId: stripeTaxRateId(tax),
    })),
  );
  const providerRateIds = [...new Set(providerPieces.map((piece) => piece.stripeTaxRateId))];
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

  const stripeRows = providerPieces.map(({ line, tax, stripeTaxRateId: rateId }) => {
    const version = byStripeRateId.get(rateId);
    if (!version) {
      throw new Error(
        `Stripe Tax Rate ${rateId} is not linked to a TaxRateVersion; refusing to guess tax provenance.`,
      );
    }
    return {
      invoiceId: input.invoiceId,
      invoiceLineItemId: line.invoiceLineItemId,
      jurisdictionId: version.jurisdictionId,
      rateVersionId: version.id,
      category: chargeCategory(line.kind, line.amountCents),
      taxableCents: tax.taxable_amount,
      exemptCents: 0,
      exemptReason: null,
      taxCents: tax.amount,
      source: "STRIPE" as const,
    };
  });

  const taxDateSeconds = input.stripeInvoice.period_start ?? input.stripeInvoice.created;
  const taxDate = new Date(taxDateSeconds * 1000);
  const context = await getAgreementTaxContext(tx, input.agreementId, taxDate);
  const engine = computeTax({
    ...context,
    lines: input.chargeLines.map((line) => ({
      key: line.invoiceLineItemId,
      kind: line.kind,
      amountCents: line.amountCents,
    })),
  });
  if (!engine.ok) {
    throw new Error(
      `Tax engine could not verify Stripe invoice ${input.stripeInvoice.id}: ${engine.problems.join(" ")}`,
    );
  }

  const engineExemptRows = engine.lines
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
      source: "ENGINE" as const,
    }));

  if (stripeRows.length > 0 || engineExemptRows.length > 0) {
    await tx.invoiceTaxLine.createMany({
      data: [...stripeRows, ...engineExemptRows],
    });
  }

  const actualByKey = new Map<string, number>();
  for (const row of stripeRows) {
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
          stripeTaxCents: stripeRows.reduce((sum, row) => sum + row.taxCents, 0),
          engineTaxCents: engine.lines.reduce((sum, row) => sum + row.taxCents, 0),
          differences,
        },
      },
    });
  }
}
