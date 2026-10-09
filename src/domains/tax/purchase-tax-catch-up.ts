import { prisma } from "@/lib/prisma";
import { recordApplianceAcquisitionTaxInTx } from "./acquisition";

/** Revisit recorded purchase answers after previously missing tax context is supplied. */
export async function recalculatePendingPurchaseTax(
  now: Date, limit: number,
): Promise<{ checked: number; calculated: number; stillPending: number }> {
  if (!Number.isFinite(now.getTime()) || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Invalid catch-up date or limit.");
  const candidates = await prisma.appliance.findMany({
    where: {
      acquisitionTaxStatus: "UNKNOWN",
      acquisitionTaxChoice: { in: ["SELLER_CHARGED", "NONE_CHARGED"] },
      acquisitionTaxRecordedAt: { not: null, lte: now },
    },
    select: { id: true },
    orderBy: [{ acquisitionTaxRecordedAt: "asc" }, { id: "asc" }],
    take: limit,
  });
  let calculated = 0, stillPending = 0;
  for (const candidate of candidates) {
    try {
      const result = await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "Appliance" WHERE "id" = ${candidate.id} FOR UPDATE`;
        const a = await tx.appliance.findUnique({ where: { id: candidate.id } });
        if (!a || a.acquisitionTaxStatus !== "UNKNOWN" ||
            (a.acquisitionTaxChoice !== "SELLER_CHARGED" && a.acquisitionTaxChoice !== "NONE_CHARGED") ||
            !a.acquisitionTaxRecordedAt) return "SKIPPED" as const;
        let actor = a.acquisitionTaxRecordedByUserId ? await tx.user.findFirst({
          where: { id: a.acquisitionTaxRecordedByUserId, role: { in: ["OWNER", "ADMIN"] },
            archivedAt: null }, select: { id: true },
        }) : null;
        actor ??= await tx.user.findFirst({
          where: { role: "OWNER", archivedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true },
        });
        if (!actor) return "PENDING" as const;
        const recorded = await recordApplianceAcquisitionTaxInTx(tx, actor.id, {
          applianceId: a.id, expectedRecordedAt: a.acquisitionTaxRecordedAt,
          choice: a.acquisitionTaxChoice, vendorTaxCents: a.acquisitionTaxPaidCents ?? 0,
          sellerNote: a.acquisitionSellerNote ?? undefined,
          receiptPhotoId: a.acquisitionReceiptPhotoId ?? undefined,
        });
        return recorded.status === "UNKNOWN" ? "PENDING" as const : "CALCULATED" as const;
      });
      if (result === "CALCULATED") calculated++;
      else if (result === "PENDING") stillPending++;
    } catch (e) {
      stillPending++;
      console.error("[tax] purchase catch-up failed", candidate.id,
        e instanceof Error ? e.message : "unknown error");
    }
  }
  return { checked: candidates.length, calculated, stillPending };
}
