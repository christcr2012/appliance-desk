import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { getDraftSigningTaxReviewInTx } from "./signing-charge-tax-review";
import { buildFrozenSigningEvidence } from "./signing-frozen-evidence";

/**
 * W-22C5: trusted owner-only frozen evidence. This DOES NOT send an agreement,
 * sign for a customer, create an invoice or call a payment provider.
 * Subsequent guarded send/sign paths must independently verify this evidence.
 */
export async function freezeReviewedSigningOrder(userId: string, agreementId: string) {
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const target = await tx.rentalAgreement.findUnique({
      where: { id: agreementId },
      select: { id: true, customerId: true, sourceEstimateId: true, status: true },
    });
    if (!target || target.status !== "DRAFT")
      throw new Error("Only an eligible draft order can be frozen.");
    const where = { customerId: target.customerId,
      ...(target.sourceEstimateId ? { sourceEstimateId: target.sourceEstimateId } : { id: agreementId }) };
    const scope = await tx.rentalAgreement.findMany({
      where, orderBy: { id: "asc" },
      select: { id: true, status: true },
    });
    if (!scope.length || scope.length > 500 || scope.some(row => row.status !== "DRAFT"))
      throw new Error("Every order agreement must remain a draft.");
    const ids = scope.map(row => row.id);
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement"
      WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`;
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR SHARE`;
    const existing = await tx.agreementSigningCharge.findMany({
      where: { agreementId: { in: ids } }, orderBy: { agreementId: "asc" },
    });
    if (existing.length !== ids.length)
      throw new Error("Every draft agreement needs reviewed signing charges.");
    const populated = await tx.rentalLine.groupBy({
      by: ["agreementId"], where: { agreementId: { in: ids } },
      _count: { _all: true },
    });
    if (populated.length !== ids.length || populated.some(row => row._count._all < 1))
      throw new Error("Each agreement needs at least one appliance before freezing.");
    if (existing.some(row => row.frozenAt !== null)) {
      if (new Set(existing.map(row => row.frozenOrderFingerprint)).size === 1 &&
          existing.every(row => row.frozenAt && row.frozenOrderFingerprint &&
          row.frozenChargeEvidence && row.frozenAllInCents !== null &&
          row.frozenSetupTaxCents !== null))
        return { status: "ALREADY_FROZEN" as const,
          orderFingerprint: existing[0].frozenOrderFingerprint!,
          agreements: ids.length };
      throw new Error("Incomplete frozen evidence requires owner review.");
    }
    const review = await getDraftSigningTaxReviewInTx(tx, agreementId, new Date());
    if (!review.orderReady || !review.orderDraft)
      throw new Error("Independent CPA-confirmed tax and all-in review is required.");
    const evidence = buildFrozenSigningEvidence(review.orderDraft);
    if (evidence.length !== ids.length ||
        ids.some((id, i) => evidence[i].agreementId !== id))
      throw new Error("Order agreement ownership changed during review.");
    const frozenAt = new Date();
    for (const line of evidence) {
      const result = await tx.agreementSigningCharge.updateMany({
        where: { agreementId: line.agreementId, serviceAddressId: line.serviceAddressId,
          version: line.agreementVersion, frozenAt: null,
          sourceFingerprint: existing.find(row => row.agreementId === line.agreementId)!.sourceFingerprint },
        data: {
          frozenAt, frozenOrderFingerprint: line.orderFingerprint,
          frozenAllInCents: line.allInCents, frozenSetupTaxCents: line.setupTaxCents,
          frozenChargeEvidence: JSON.parse(JSON.stringify(line)) as Prisma.InputJsonValue,
        },
      });
      if (result.count !== 1) throw new Error("Signing evidence changed; retry review.");
    }
    await tx.auditLog.create({ data: {
      userId, action: "signing_charge.freeze_reviewed_order",
      entityType: "RentalAgreement", entityId: agreementId,
      newValue: { orderFingerprint: evidence[0].orderFingerprint,
        agreementCount: evidence.length, frozenAt: frozenAt.toISOString() },
    } });
    return { status: "FROZEN" as const,
      orderFingerprint: evidence[0].orderFingerprint, agreements: ids.length };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20_000 });
}
