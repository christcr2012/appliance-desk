import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { MAX_TAX_RATE_MILLI_PERCENT } from "@/domains/billing/tax";
import { claimProviderOperation, completeProviderOperation, runProviderCall } from "@/domains/billing/provider-ops";

export function stripePercentageText(rateMilliPercent: number): string {
  if (!Number.isSafeInteger(rateMilliPercent) || rateMilliPercent < 0 || rateMilliPercent > MAX_TAX_RATE_MILLI_PERCENT) {
    throw new Error("Tax rate must be a valid integer milli-percent.");
  }
  const whole = Math.floor(rateMilliPercent / 1000);
  const fraction = String(rateMilliPercent % 1000).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

export async function ensureStripeTaxRate(rateVersionId: string): Promise<string> {
  const claimed = await prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "TaxRateVersion" WHERE "id" = ${rateVersionId} FOR UPDATE
    `;
    if (rows.length !== 1) throw new Error("Tax rate version not found.");

    const version = await tx.taxRateVersion.findUniqueOrThrow({
      where: { id: rateVersionId },
      include: { jurisdiction: true },
    });
    if (version.stripeTaxRateId) {
      return { done: true as const, providerObjectId: version.stripeTaxRateId };
    }

    const operation = await claimProviderOperation(tx, {
      kind: "TAX_RATE_CREATE",
      subjectType: "TaxRateVersion",
      subjectId: rateVersionId,
      idempotencyKey: `tax-rate-${rateVersionId}`,
    });
    if (operation.done) {
      await tx.taxRateVersion.update({
        where: { id: rateVersionId },
        data: { stripeTaxRateId: operation.providerObjectId },
      });
      return { done: true as const, providerObjectId: operation.providerObjectId };
    }

    return {
      done: false as const,
      opId: operation.opId,
      idempotencyKey: operation.idempotencyKey,
      jurisdictionName: version.jurisdiction.name,
      jurisdictionCode: version.jurisdiction.code,
      percentage: stripePercentageText(version.rateMilliPercent),
    };
  });

  if (claimed.done) return claimed.providerObjectId;

  const stripe = getStripeClient();
  const providerResult = await runProviderCall(() =>
    stripe.taxRates.create(
      {
        display_name: "Sales tax",
        jurisdiction: claimed.jurisdictionName,
        percentage: claimed.percentage as unknown as number,
        inclusive: false,
        country: "US",
        state: "CO",
        tax_type: "sales_tax",
        metadata: {
          rateVersionId,
          jurisdictionCode: claimed.jurisdictionCode,
        },
      },
      { idempotencyKey: claimed.idempotencyKey },
    ),
  );

  if (!providerResult.ok) {
    await prisma.$transaction((tx) =>
      completeProviderOperation(
        tx,
        claimed.opId,
        providerResult.outcome === "UNKNOWN"
          ? { status: "UNKNOWN", error: providerResult.error }
          : { status: "FAILED", error: providerResult.error },
      ),
    );
    throw new Error("Couldn\'t create the Stripe sales-tax rate.");
  }

  const stripeTaxRateId = providerResult.value.id;
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "TaxRateVersion" WHERE "id" = ${rateVersionId} FOR UPDATE
    `;
    if (rows.length !== 1) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "DRIFT",
        providerObjectId: stripeTaxRateId,
        note: "Stripe tax rate was created after the local rate version disappeared.",
      });
      throw new Error("Tax rate version disappeared while Stripe was being updated.");
    }

    const current = await tx.taxRateVersion.findUniqueOrThrow({ where: { id: rateVersionId } });
    if (current.stripeTaxRateId && current.stripeTaxRateId !== stripeTaxRateId) {
      await completeProviderOperation(tx, claimed.opId, {
        status: "DRIFT",
        providerObjectId: stripeTaxRateId,
        note: `Stripe returned ${stripeTaxRateId}, but the local rate is already linked to ${current.stripeTaxRateId}.`,
      });
      return current.stripeTaxRateId;
    }

    await tx.taxRateVersion.update({
      where: { id: rateVersionId },
      data: { stripeTaxRateId },
    });
    await completeProviderOperation(tx, claimed.opId, {
      status: "SUCCEEDED",
      providerObjectId: stripeTaxRateId,
    });
    return stripeTaxRateId;
  });
}
