import type { Prisma } from "@prisma/client";
import { addBusinessDays, businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { taxCentsForLine } from "@/domains/billing/tax";
import { allocateAcrossLines } from "./allocate";

export type UseTaxPurchase = {
  sourceType: "APPLIANCE" | "PURCHASE_ORDER_LINE" | "EXPENSE";
  sourceId: string;
  purchasedOn: Date;
  amountCents: number;
  vendorTaxCents: number;
  isRentalInventory: boolean;
};

function requireCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(label + " must be a nonnegative whole number of cents.");
  }
}

/** Use inside the same database transaction that records the purchase. */
export async function recordUseTaxForPurchase(
  tx: Prisma.TransactionClient,
  input: UseTaxPurchase,
): Promise<void> {
  if (!input.sourceId.trim()) throw new Error("A purchase source is required.");
  if (!Number.isFinite(input.purchasedOn.getTime())) throw new Error("Invalid purchase date.");
  requireCents(input.amountCents, "Purchase amount");
  requireCents(input.vendorTaxCents, "Vendor tax");

  // Serialize concurrent updates for the same purchase.
  await tx.$queryRaw\`SELECT pg_advisory_xact_lock(hashtext(\${input.sourceType + ":" + input.sourceId}))\`;
  const settings = await tx.businessSettings.findUnique({
    where: { id: "singleton" },
    select: { shortTermLeaseElection: true },
  });
  if (input.isRentalInventory && (!settings || settings.shortTermLeaseElection === "UNDECIDED")) {
    throw new Error("Choose the rental purchase tax election before recording use tax.");
  }
  const location = await tx.addressTaxLocation.findFirst({
    where: { forBusinessLocation: true, isCurrent: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      jurisdictions: {
        include: {
          jurisdiction: {
            include: {
              rates: {
                where: { effectiveFrom: { lte: input.purchasedOn }, autoAppliedUndoneAt: null },
                orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!location || location.status !== "VERIFIED" || !location.jurisdictions.length) {
    throw new Error("Verify the business purchase-tax address and its tax areas first.");
  }
  const jurisdictions = location.jurisdictions
    .map(row => row.jurisdiction)
    .sort((a, b) => a.code.localeCompare(b.code));
  if (jurisdictions.some(j => j.reviewStatus !== "REVIEWED" || j.rates.length !== 1)) {
    throw new Error("Review each business tax jurisdiction and its applicable rate first.");
  }
  const rates = jurisdictions.map(j => j.rates[0]!);
  const expected = rates.map(r => taxCentsForLine(input.amountCents, r.rateMilliPercent));
  const vendor = allocateAcrossLines(input.vendorTaxCents, rates.map(r => r.rateMilliPercent));
  const date = businessDateFromKey(businessDateKey(input.purchasedOn));
  if (!date) throw new Error("Invalid local purchase date.");

  for (const [index, jurisdiction] of jurisdictions.entries()) {
    const due = Math.max(0, expected[index]! - vendor[index]!);
    const status =
      due === 0 || (input.isRentalInventory && settings!.shortTermLeaseElection === "COLLECT_ON_RENTALS")
        ? "NOT_DUE" as const : "DUE" as const;
    const existing = await tx.purchaseUseTax.findUnique({
      where: { sourceType_sourceId_jurisdictionId: {
        sourceType: input.sourceType, sourceId: input.sourceId, jurisdictionId: jurisdiction.id,
      } },
    });
    const data = {
      purchasedOn: input.purchasedOn,
      purchaseAmountCents: input.amountCents,
      vendorTaxCents: vendor[index]!,
      rateVersionId: rates[index]!.id,
      useTaxDueCents: due,
      status,
    };
    if (existing?.status === "FILED") {
      const changed =
        existing.purchasedOn.getTime() !== data.purchasedOn.getTime() ||
        existing.purchaseAmountCents !== data.purchaseAmountCents ||
        existing.vendorTaxCents !== data.vendorTaxCents ||
        existing.rateVersionId !== data.rateVersionId ||
        existing.useTaxDueCents !== data.useTaxDueCents;
      if (changed) throw new Error("This filed purchase changed; an amended return requires review.");
      continue;
    }
    if (existing?.filingPeriodId) {
      const previous = await tx.taxFilingPeriod.findUnique({
        where: { id: existing.filingPeriodId }, select: { status: true },
      });
      if (previous?.status === "FILED") {
        throw new Error("A purchase assigned to a filed period requires amendment review.");
      }
    }
    const period = jurisdiction.useTaxFilingAccountId
      ? await tx.taxFilingPeriod.findFirst({
          where: {
            filingAccountId: jurisdiction.useTaxFilingAccountId, status: "OPEN",
            periodStart: { lte: date }, periodEnd: { gte: date },
            filingAccount: { kind: "USE_TAX_RETURN" },
          },
          select: { id: true }, orderBy: [{ periodStart: "desc" }],
        })
      : null;
    const filingPeriodId = period?.id ?? existing?.filingPeriodId ?? null;
    if (existing) {
      await tx.purchaseUseTax.update({ where: { id: existing.id }, data: { ...data, filingPeriodId } });
    } else {
      await tx.purchaseUseTax.create({
        data: {
          sourceType: input.sourceType, sourceId: input.sourceId,
          jurisdictionId: jurisdiction.id, ...data, filingPeriodId,
        },
      });
    }
  }
}

/** Catch up unassigned DUE purchases when a use-tax period is first opened. */
export async function assignDueUseTaxRowsToPeriod(
  tx: Prisma.TransactionClient,
  filingPeriodId: string,
): Promise<number> {
  const locked = await tx.$queryRaw<Array<{ id: string }>>\`
    SELECT "id" FROM "TaxFilingPeriod" WHERE "id" = \${filingPeriodId} FOR UPDATE
  \`;
  if (!locked.length) throw new Error("Tax filing period not found.");
  const period = await tx.taxFilingPeriod.findUniqueOrThrow({
    where: { id: filingPeriodId },
    include: { filingAccount: { select: { kind: true } } },
  });
  if (period.filingAccount.kind !== "USE_TAX_RETURN" || period.status !== "OPEN") {
    throw new Error("Only an open use-tax period accepts new purchase rows.");
  }
  return (await tx.purchaseUseTax.updateMany({
    where: {
      filingPeriodId: null, status: "DUE",
      purchasedOn: { gte: period.periodStart, lt: addBusinessDays(period.periodEnd, 1) },
      jurisdiction: { useTaxFilingAccountId: period.filingAccountId },
    },
    data: { filingPeriodId },
  })).count;
}
