import { Prisma, type AcquisitionTaxStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import {
  PurchaseTaxContextPendingError,
  recordUseTaxForPurchase,
} from "./use-tax";

export type PurchaseTaxChoice =
  | "SELLER_CHARGED"
  | "NONE_CHARGED"
  | "LESSOR_PERMISSION"
  | "LATER";

export type AcquisitionTaxInput = {
  applianceId: string;
  expectedRecordedAt: Date | null;
  choice: PurchaseTaxChoice;
  vendorTaxCents: number;
  sellerNote?: string;
  receiptPhotoId?: string;
};

export type AcquisitionTaxResult = {
  status: AcquisitionTaxStatus;
  useTaxDueCents: number | null;
  attentionReason?:
    | "PURCHASE_DATE_OR_COST_MISSING"
    | "ELECTION_UNDECIDED"
    | "BUSINESS_ADDRESS_UNVERIFIED"
    | "RATES_UNREVIEWED";
};

function cents(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error("Purchase tax must be a nonnegative integer number of cents.");
  }
}

/**
 * Save the tax evidence together with its appliance and audit record.
 *
 * The transaction caller owns commit/rollback. Acquiring the appliance row lock
 * serializes evidence revisions; no purchase-tax row is written until all
 * purchase context and the actor's rights have been checked.
 */
export async function recordApplianceAcquisitionTaxInTx(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: AcquisitionTaxInput,
): Promise<AcquisitionTaxResult> {
  const actor = await assertActiveTeamActor(tx, actorId, ["OWNER", "ADMIN"]);
  cents(input.vendorTaxCents);
  if (!["SELLER_CHARGED", "NONE_CHARGED", "LESSOR_PERMISSION", "LATER"].includes(input.choice)) {
    throw new Error("Choose a valid purchase-tax answer.");
  }
  if ((input.choice === "NONE_CHARGED" || input.choice === "LESSOR_PERMISSION" || input.choice === "LATER") &&
      input.vendorTaxCents !== 0) {
    throw new Error("Only seller-charged purchases can include vendor tax.");
  }
  if (input.sellerNote && input.sellerNote.trim().length > 500) {
    throw new Error("Seller note must be 500 characters or fewer.");
  }
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "Appliance" WHERE "id" = ${input.applianceId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("Appliance not found.");
  const appliance = await tx.appliance.findUniqueOrThrow({ where: { id: input.applianceId } });
  const currentRevision = appliance.acquisitionTaxRecordedAt?.getTime() ?? null;
  const expectedRevision = input.expectedRecordedAt?.getTime() ?? null;
  const note = input.sellerNote?.trim() || null;
  const photoId = input.receiptPhotoId || null;
  if (photoId) {
    const photo = await tx.photo.findUnique({ where: { id: photoId } });
    if (!photo || (photo.applianceId && photo.applianceId !== appliance.id) ||
        photo.jobId || photo.maintenanceRequestId) {
      throw new Error("The receipt does not belong to this appliance.");
    }
    if (photo.applianceId === null) {
      await tx.photo.update({ where: { id: photoId }, data: { applianceId: appliance.id } });
    }
  }

  const relatedTax = await tx.purchaseUseTax.findMany({
    where: { sourceType: "APPLIANCE", sourceId: appliance.id },
    select: { status: true, useTaxDueCents: true },
  });
  if (input.choice === "LATER" && relatedTax.length) {
    throw new Error("Review existing tax rows before clearing a recorded purchase-tax answer.");
  }

  const equivalentChoice =
    (input.choice === "LATER" && appliance.acquisitionTaxStatus === "UNKNOWN") ||
    (appliance.acquisitionTaxStatus === "UNKNOWN" && input.choice !== "SELLER_CHARGED" &&
      input.choice !== "NONE_CHARGED" && appliance.acquisitionTaxChoice === input.choice &&
      appliance.acquisitionTaxPaidCents === input.vendorTaxCents) ||
    (input.choice === "LESSOR_PERMISSION" && appliance.acquisitionTaxStatus === "BOUGHT_TAX_FREE_FOR_LEASE") ||
    (input.choice === "SELLER_CHARGED" &&
      ["SALES_TAX_PAID", "USE_TAX_PAID"].includes(appliance.acquisitionTaxStatus) &&
      appliance.acquisitionTaxPaidCents === input.vendorTaxCents) ||
    (input.choice === "NONE_CHARGED" &&
      ["USE_TAX_DUE", "USE_TAX_PAID"].includes(appliance.acquisitionTaxStatus) &&
      appliance.acquisitionTaxPaidCents === 0);
  if (appliance.acquisitionTaxRecordedAt && equivalentChoice && appliance.acquisitionSellerNote === note &&
      appliance.acquisitionReceiptPhotoId === photoId) {
    return {
      status: appliance.acquisitionTaxStatus,
      useTaxDueCents: relatedTax.reduce((sum, row) => sum + ((row.status === "DUE" || row.status === "FILED") ? row.useTaxDueCents : 0), 0),
    };
  }

  if (currentRevision !== expectedRevision) {
    throw new Error("Someone updated this appliance's purchase tax. Reload before saving.");
  }

  let status: AcquisitionTaxStatus = "UNKNOWN";
  let attentionReason: AcquisitionTaxResult["attentionReason"];
  let taxDue: number | null = null;
  if (input.choice === "LESSOR_PERMISSION") {
    const settings = await tx.businessSettings.findUnique({
      where: { id: "singleton" }, select: { shortTermLeaseElection: true },
    });
    if (actor.role !== "OWNER" || settings?.shortTermLeaseElection !== "COLLECT_ON_RENTALS") {
      throw new Error("Only the owner may confirm the configured lessor purchase permission.");
    }
    if (relatedTax.length) {
      throw new Error("Review existing purchase-tax rows before switching to lessor permission.");
    }
    status = "BOUGHT_TAX_FREE_FOR_LEASE";
  } else if (input.choice !== "LATER") {
    if (!appliance.purchaseDate || appliance.acquisitionCostCents === null) {
      attentionReason = "PURCHASE_DATE_OR_COST_MISSING";
    } else if (!Number.isSafeInteger(appliance.acquisitionCostCents) ||
        appliance.acquisitionCostCents < 0) {
      throw new Error("Correct the acquisition cost before calculating purchase tax.");
    } else {
      const election = await tx.businessSettings.findUnique({
        where: { id: "singleton" }, select: { shortTermLeaseElection: true },
      });
      if (input.choice === "NONE_CHARGED" && election?.shortTermLeaseElection === "COLLECT_ON_RENTALS") {
        throw new Error("Confirm lessor permission for untaxed units under the rental-collection election.");
      }
      try {
        await recordUseTaxForPurchase(tx, {
          sourceType: "APPLIANCE",
          sourceId: appliance.id,
          purchasedOn: appliance.purchaseDate,
          amountCents: appliance.acquisitionCostCents,
          vendorTaxCents: input.vendorTaxCents,
          isRentalInventory: true,
        }, { allowAuditedFiledCorrection: true });
        const rows = await tx.purchaseUseTax.findMany({
          where: { sourceType: "APPLIANCE", sourceId: appliance.id },
          select: { useTaxDueCents: true, status: true },
        });
        const priorFiled = relatedTax.filter(row => row.status === "FILED").reduce((sum, row) => sum + row.useTaxDueCents, 0);
        const correctedFiled = rows.filter(row => row.status === "FILED").reduce((sum, row) => sum + row.useTaxDueCents, 0);
        taxDue = rows.filter(row => row.status === "DUE").reduce((sum, row) => sum + row.useTaxDueCents, 0)
          + Math.max(0, correctedFiled - priorFiled);
        status = taxDue > 0 ? "USE_TAX_DUE" : input.choice === "SELLER_CHARGED" && input.vendorTaxCents > 0
          ? "SALES_TAX_PAID" : "USE_TAX_PAID";
      } catch (error) {
        // The purchase helper validates ALL jurisdiction/rate context before
        // writing rows. Do not reclassify operational/DB errors as "unknown".
        if (!(error instanceof PurchaseTaxContextPendingError)) throw error;
        attentionReason = error.reason;
      }
    }
  }

  // A monotonic revision avoids equal millisecond timestamps after a rapid
  // update, so the next edit always detects a stale read.
  const recordedAt = new Date(Math.max(Date.now(), (currentRevision ?? 0) + 1));
  await tx.appliance.update({
    where: { id: appliance.id },
    data: {
      acquisitionTaxStatus: status,
      acquisitionTaxChoice: input.choice,
      acquisitionTaxPaidCents: input.choice === "LATER" ? null : input.vendorTaxCents,
      acquisitionSellerNote: note,
      acquisitionReceiptPhotoId: photoId,
      acquisitionTaxRecordedAt: recordedAt,
      acquisitionTaxRecordedByUserId: actorId,
    },
  });
  await tx.auditLog.create({
    data: {
      userId: actorId, action: "appliance.acquisition_tax.record",
      entityType: "Appliance", entityId: appliance.id,
      oldValue: {
        status: appliance.acquisitionTaxStatus,
        vendorTaxCents: appliance.acquisitionTaxPaidCents,
        recordedAt: appliance.acquisitionTaxRecordedAt?.toISOString() ?? null,
      },
      newValue: {
        choice: input.choice, status, vendorTaxCents: input.vendorTaxCents,
        receiptPhotoId: photoId, attentionReason: attentionReason ?? null,
        recordedAt: recordedAt.toISOString(),
      },
    },
  });
  return { status, useTaxDueCents: taxDue, ...(attentionReason ? { attentionReason } : {}) };
}

/** Authoritative non-UI entry point; caller cannot skip the actor guard. */
export function recordApplianceAcquisitionTax(actorId: string, input: AcquisitionTaxInput) {
  return prisma.$transaction(tx => recordApplianceAcquisitionTaxInTx(tx, actorId, input));
}
